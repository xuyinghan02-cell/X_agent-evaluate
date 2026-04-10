"""Orchestrates multi-turn conversations with tool call loops."""
import json
from typing import AsyncGenerator, List, Dict, Any, Optional, Callable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from ..models.conversation import Conversation, Message
from ..models.agent import Agent
from .llm_service import stream_chat
from .workspace_service import WorkspaceService


async def get_or_create_conversation(
    db: AsyncSession,
    agent_id: int,
    user_id: int,
    conversation_id: Optional[int] = None,
) -> Conversation:
    if conversation_id:
        result = await db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.agent_id == agent_id,
            )
        )
        conv = result.scalar_one_or_none()
        if conv:
            return conv

    conv = Conversation(agent_id=agent_id, user_id=user_id)
    db.add(conv)
    await db.flush()
    return conv


async def load_history(
    db: AsyncSession, conversation_id: int, limit: int
) -> List[Dict]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(desc(Message.id))
        .limit(limit)
    )
    messages = list(reversed(result.scalars().all()))

    history = []
    for msg in messages:
        if msg.role == "user":
            history.append({"role": "user", "content": msg.content or ""})
        elif msg.role == "assistant":
            content_blocks = []
            if msg.content:
                content_blocks.append({"type": "text", "text": msg.content})
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc["input"],
                    })
            if content_blocks:
                history.append({"role": "assistant", "content": content_blocks})
        elif msg.role == "tool":
            if msg.tool_calls:
                tool_results = [
                    {
                        "type": "tool_result",
                        "tool_use_id": tc["id"],
                        "content": tc.get("result", ""),
                    }
                    for tc in msg.tool_calls
                ]
                history.append({"role": "user", "content": tool_results})
    return history


async def save_message(
    db: AsyncSession,
    conversation_id: int,
    role: str,
    content: Optional[str] = None,
    tool_calls: Optional[List[Dict]] = None,
    thinking: Optional[str] = None,
) -> Message:
    msg = Message(
        conversation_id=conversation_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        thinking=thinking,
    )
    db.add(msg)
    await db.flush()
    return msg


async def run_conversation(
    *,
    db: AsyncSession,
    agent: Agent,
    conversation_id: int,
    user_message: str,
    tool_executor: Optional[Callable] = None,
    provider_override: Optional[str] = None,
    model_override: Optional[str] = None,
    selected_skills: Optional[List[str]] = None,
) -> AsyncGenerator[Dict, None]:
    """
    Yields SSE events for streaming to the client.
    Handles multi-turn tool call loops.
    provider_override/model_override: per-message overrides from the client.
    selected_skills: list of skill filenames to include (None = all skills).
    """
    ws = WorkspaceService(agent.workspace_path)
    system_prompt = await ws.build_system_prompt(agent, selected_skills=selected_skills)

    # Per-message overrides take priority; fall back to DB settings, then agent defaults
    provider = provider_override or agent.provider
    model = model_override or agent.primary_model
    try:
        from ..models.settings import SystemSettings
        from sqlalchemy import select as sa_select
        keys_to_fetch = [
            "active_provider",
            "anthropic_model", "openai_model", "deepseek_model", "minimax_model", "volce_model",
        ]
        res = await db.execute(sa_select(SystemSettings).where(
            SystemSettings.key.in_(keys_to_fetch)
        ))
        db_settings = {r.key: r.value for r in res.scalars().all()}
        if not provider_override and db_settings.get("active_provider"):
            provider = db_settings["active_provider"]
        # Use per-provider model if not overridden by client
        if not model_override:
            per_provider_key = f"{provider}_model"
            if db_settings.get(per_provider_key):
                model = db_settings[per_provider_key]
    except Exception:
        pass

    # Save user message
    await save_message(db, conversation_id, "user", content=user_message)
    await db.commit()

    # Load history (includes the message just saved)
    history = await load_history(db, conversation_id, agent.history_count)

    round_count = 0
    max_rounds = agent.max_tool_rounds or 50

    while round_count < max_rounds:
        round_count += 1
        accumulated_text = ""
        accumulated_thinking = ""
        pending_tool_uses: List[Dict] = []

        async for event in stream_chat(
            provider=provider,
            model=model,
            system_prompt=system_prompt,
            messages=history,
        ):
            yield event  # Forward to client

            if event["type"] == "text_delta":
                accumulated_text += event["content"]
            elif event["type"] == "thinking":
                accumulated_thinking += event["content"]
            elif event["type"] == "tool_use":
                pending_tool_uses.append(event)
            elif event["type"] == "done":
                stop_reason = event.get("stop_reason", "end_turn")

                # Save assistant message
                tool_calls_data = [
                    {"id": t["id"], "name": t["name"], "input": t["input"]}
                    for t in pending_tool_uses
                ] if pending_tool_uses else None

                await save_message(
                    db,
                    conversation_id,
                    "assistant",
                    content=accumulated_text or None,
                    tool_calls=tool_calls_data,
                    thinking=accumulated_thinking or None,
                )
                await db.commit()

                if stop_reason != "tool_use" or not pending_tool_uses:
                    return  # Done

                # Execute tools
                if tool_executor:
                    tool_results = []
                    for tool_call in pending_tool_uses:
                        yield {
                            "type": "tool_executing",
                            "id": tool_call["id"],
                            "name": tool_call["name"],
                        }
                        try:
                            result = await tool_executor(
                                tool_call["name"], tool_call["input"]
                            )
                            result_str = json.dumps(result) if not isinstance(result, str) else result
                            yield {
                                "type": "tool_result",
                                "id": tool_call["id"],
                                "name": tool_call["name"],
                                "result": result_str,
                            }
                        except Exception as e:
                            result_str = f"Error: {e}"
                            yield {
                                "type": "tool_result",
                                "id": tool_call["id"],
                                "name": tool_call["name"],
                                "result": result_str,
                                "is_error": True,
                            }
                        tool_results.append({
                            "id": tool_call["id"],
                            "result": result_str,
                        })

                    # Save tool results message
                    await save_message(
                        db,
                        conversation_id,
                        "tool",
                        tool_calls=[
                            {"id": tr["id"], "result": tr["result"]}
                            for tr in tool_results
                        ],
                    )
                    await db.commit()

                    # Rebuild history for next round
                    history = await load_history(db, conversation_id, agent.history_count)
                else:
                    return  # No tool executor, stop
            elif event["type"] == "error":
                return

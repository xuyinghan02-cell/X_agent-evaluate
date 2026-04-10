"""LLM service: streams responses from Anthropic/OpenAI/DeepSeek/MiniMax/VolcEngine."""
import json
from typing import AsyncGenerator, List, Dict, Any, Optional
from ..core.config import settings


async def _get_api_key(provider: str) -> str:
    """Read API key from DB settings first, fall back to config/env."""
    try:
        from ..core.database import AsyncSessionLocal
        from ..models.settings import SystemSettings
        from sqlalchemy import select

        key_map = {
            "anthropic": "anthropic_api_key",
            "openai": "openai_api_key",
            "deepseek": "deepseek_api_key",
            "minimax": "minimax_api_key",
            "volce": "volce_api_key",
        }
        db_key = key_map.get(provider)
        if db_key:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(SystemSettings).where(SystemSettings.key == db_key)
                )
                row = result.scalar_one_or_none()
                if row and row.value:
                    return row.value
    except Exception:
        pass

    fallbacks = {
        "anthropic": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "deepseek": settings.deepseek_api_key,
        "minimax": settings.minimax_api_key,
        "volce": settings.volce_api_key,
    }
    return fallbacks.get(provider, "")


async def stream_chat(
    *,
    provider: str,
    model: str,
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict]] = None,
) -> AsyncGenerator[Dict, None]:
    """
    Unified streaming interface. Yields dicts:
      {"type": "thinking", "content": "..."}
      {"type": "text_delta", "content": "..."}
      {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
      {"type": "done", "stop_reason": "end_turn"|"tool_use"|"max_tokens"}
      {"type": "error", "content": "..."}
    """
    if provider == "anthropic":
        async for event in _stream_anthropic(model, system_prompt, messages, tools):
            yield event
    elif provider == "openai":
        async for event in _stream_openai(model, system_prompt, messages, tools):
            yield event
    elif provider == "deepseek":
        async for event in _stream_deepseek(model, system_prompt, messages, tools):
            yield event
    elif provider == "minimax":
        async for event in _stream_minimax(model, system_prompt, messages, tools):
            yield event
    elif provider == "volce":
        async for event in _stream_volce(model, system_prompt, messages, tools):
            yield event
    else:
        yield {"type": "error", "content": f"Unknown provider: {provider}"}


# ── Anthropic ──────────────────────────────────────────────────────────────────

async def _stream_anthropic(
    model: str,
    system_prompt: str,
    messages: List[Dict],
    tools: Optional[List[Dict]],
) -> AsyncGenerator[Dict, None]:
    try:
        import anthropic

        api_key = await _get_api_key("anthropic")
        client = anthropic.AsyncAnthropic(api_key=api_key)
        kwargs: Dict[str, Any] = {
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        async with client.messages.stream(**kwargs) as stream:
            current_tool_id = None
            current_tool_name = None
            current_tool_input_str = ""

            async for event in stream:
                etype = event.type

                if etype == "content_block_start":
                    block = event.content_block
                    if block.type == "tool_use":
                        current_tool_id = block.id
                        current_tool_name = block.name
                        current_tool_input_str = ""

                elif etype == "content_block_delta":
                    delta = event.delta
                    if delta.type == "text_delta":
                        yield {"type": "text_delta", "content": delta.text}
                    elif delta.type == "thinking_delta":
                        yield {"type": "thinking", "content": delta.thinking}
                    elif delta.type == "input_json_delta":
                        current_tool_input_str += delta.partial_json

                elif etype == "content_block_stop":
                    if current_tool_id:
                        try:
                            tool_input = json.loads(current_tool_input_str) if current_tool_input_str else {}
                        except json.JSONDecodeError:
                            tool_input = {}
                        yield {
                            "type": "tool_use",
                            "id": current_tool_id,
                            "name": current_tool_name,
                            "input": tool_input,
                        }
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_input_str = ""

                elif etype == "message_stop":
                    final = await stream.get_final_message()
                    yield {"type": "done", "stop_reason": final.stop_reason}

    except Exception as e:
        yield {"type": "error", "content": str(e)}


# ── OpenAI-compatible (shared) ─────────────────────────────────────────────────

async def _stream_openai_compatible(
    model: str,
    system_prompt: str,
    messages: List[Dict],
    tools: Optional[List[Dict]],
    api_key: str,
    base_url: Optional[str] = None,
) -> AsyncGenerator[Dict, None]:
    try:
        from openai import AsyncOpenAI

        client_kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        client = AsyncOpenAI(**client_kwargs)
        oai_messages = [{"role": "system", "content": system_prompt}] + messages

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": oai_messages,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = [{"type": "function", "function": t} for t in tools]
            kwargs["tool_choice"] = "auto"

        stream = await client.chat.completions.create(**kwargs)
        pending_calls: Dict[int, Dict] = {}

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue

            delta = choice.delta
            if delta.content:
                yield {"type": "text_delta", "content": delta.content}

            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in pending_calls:
                        pending_calls[idx] = {
                            "id": tc.id or "",
                            "name": tc.function.name if tc.function else "",
                            "input_str": "",
                        }
                    if tc.id:
                        pending_calls[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            pending_calls[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            pending_calls[idx]["input_str"] += tc.function.arguments

            if choice.finish_reason:
                for call in pending_calls.values():
                    try:
                        tool_input = json.loads(call["input_str"]) if call["input_str"] else {}
                    except json.JSONDecodeError:
                        tool_input = {}
                    yield {
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["name"],
                        "input": tool_input,
                    }
                stop_reason = "tool_use" if pending_calls else "end_turn"
                yield {"type": "done", "stop_reason": stop_reason}

    except Exception as e:
        yield {"type": "error", "content": str(e)}


async def _stream_openai(model, system_prompt, messages, tools):
    api_key = await _get_api_key("openai")
    async for e in _stream_openai_compatible(model, system_prompt, messages, tools, api_key):
        yield e


async def _stream_deepseek(model, system_prompt, messages, tools):
    api_key = await _get_api_key("deepseek")
    async for e in _stream_openai_compatible(
        model, system_prompt, messages, tools,
        api_key=api_key, base_url="https://api.deepseek.com",
    ):
        yield e


async def _stream_minimax(model, system_prompt, messages, tools):
    api_key = await _get_api_key("minimax")
    async for e in _stream_openai_compatible(
        model, system_prompt, messages, tools,
        api_key=api_key, base_url="https://api.minimax.chat/v1",
    ):
        yield e


# ── Volcano Engine (火山引擎 Ark) ───────────────────────────────────────────────

async def _stream_volce(
    model: str,
    system_prompt: str,
    messages: List[Dict],
    tools: Optional[List[Dict]],
) -> AsyncGenerator[Dict, None]:
    """
    Volcano Engine Ark /api/v3/responses (Responses API).
    Input format: {"model", "stream", "input": [{role, content: [{type, text}]}]}
    SSE events carry event type in both the 'event:' line and data['type'].
    Text delta is in data['delta'] as a plain string.
    """
    import httpx

    api_key = await _get_api_key("volce")
    if not api_key:
        yield {"type": "error", "content": "火山引擎 API Key 未配置，请在「设置」页面填写"}
        return

    # Build input array in Ark Responses API format
    volce_input: List[Dict] = []

    if system_prompt:
        volce_input.append({
            "role": "system",
            "content": [{"type": "input_text", "text": system_prompt}],
        })

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, str):
            if content:
                volce_input.append({
                    "role": role,
                    "content": [{"type": "input_text", "text": content}],
                })
        elif isinstance(content, list):
            text_parts = []
            for block in content:
                if not isinstance(block, dict):
                    text_parts.append(str(block))
                    continue
                btype = block.get("type", "")
                if btype in ("text", "input_text"):
                    text_parts.append(block.get("text", ""))
                elif btype == "tool_result":
                    text_parts.append(f"[工具结果] {block.get('content', '')}")
                elif btype == "tool_use":
                    text_parts.append(
                        f"[调用工具 {block.get('name', '')}] 参数: "
                        + json.dumps(block.get("input", {}), ensure_ascii=False)
                    )
            combined = "\n".join(filter(None, text_parts))
            if combined:
                volce_input.append({
                    "role": role,
                    "content": [{"type": "input_text", "text": combined}],
                })

    payload: Dict[str, Any] = {
        "model": model,
        "stream": True,
        "input": volce_input,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            async with client.stream(
                "POST",
                "https://ark.cn-beijing.volces.com/api/v3/responses",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    yield {
                        "type": "error",
                        "content": f"HTTP {response.status_code}: {body.decode('utf-8', errors='replace')}",
                    }
                    return

                # SSE parsing: track current event type across lines
                current_event = ""
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        current_event = ""
                        continue

                    if line.startswith("event:"):
                        current_event = line[6:].strip()
                        continue

                    if not line.startswith("data:"):
                        continue

                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        yield {"type": "done", "stop_reason": "end_turn"}
                        return

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # Event type: prefer SSE 'event:' header, fall back to data fields
                    etype = current_event or data.get("type", "") or data.get("object", "")

                    if "output_text.delta" in etype:
                        # delta is a plain string in the Responses API
                        delta = data.get("delta", "")
                        if isinstance(delta, str) and delta:
                            yield {"type": "text_delta", "content": delta}
                        elif isinstance(delta, dict):
                            text = delta.get("text", "") or delta.get("output_text", "")
                            if text:
                                yield {"type": "text_delta", "content": text}

                    elif "completed" in etype or "done" in etype or "message_stop" in etype:
                        yield {"type": "done", "stop_reason": "end_turn"}
                        return

                yield {"type": "done", "stop_reason": "end_turn"}

    except Exception as e:
        yield {"type": "error", "content": str(e)}

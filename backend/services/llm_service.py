"""LLM service: streams responses from Anthropic/OpenAI and yields SSE-style events."""
import json
from typing import AsyncGenerator, List, Dict, Any, Optional
from ..core.config import settings


async def stream_chat(
    *,
    provider: str,
    model: str,
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict]] = None,
) -> AsyncGenerator[Dict, None]:
    """
    Yields dicts:
      {"type": "thinking", "content": "..."}
      {"type": "text_delta", "content": "..."}
      {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
      {"type": "tool_result", "tool_use_id": "...", "content": "..."}
      {"type": "done", "stop_reason": "end_turn"|"tool_use"|"max_tokens"}
      {"type": "error", "content": "..."}
    """
    if provider == "anthropic":
        async for event in _stream_anthropic(model, system_prompt, messages, tools):
            yield event
    elif provider == "openai":
        async for event in _stream_openai(model, system_prompt, messages, tools):
            yield event
    else:
        yield {"type": "error", "content": f"Unknown provider: {provider}"}


async def _stream_anthropic(
    model: str,
    system_prompt: str,
    messages: List[Dict],
    tools: Optional[List[Dict]],
) -> AsyncGenerator[Dict, None]:
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
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


async def _stream_openai(
    model: str,
    system_prompt: str,
    messages: List[Dict],
    tools: Optional[List[Dict]],
) -> AsyncGenerator[Dict, None]:
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
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

import json
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional, List
from ..core.database import get_db, AsyncSessionLocal
from ..core.auth import get_current_user
from ..core.config import settings
from ..models.agent import Agent
from ..models.conversation import Conversation, Message
from ..services.conversation_service import (
    get_or_create_conversation,
    run_conversation,
    load_history,
)

router = APIRouter(prefix="/agents/{agent_id}/conversations", tags=["conversations"])


class ConversationOut(BaseModel):
    id: int
    agent_id: int
    user_id: int
    title: Optional[str]

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: int
    role: str
    content: Optional[str]
    tool_calls: Optional[list]
    thinking: Optional[str]

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[int] = None


@router.get("", response_model=List[ConversationOut])
async def list_conversations(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.agent_id == agent_id, Conversation.user_id == current_user.id)
        .order_by(desc(Conversation.id))
    )
    return result.scalars().all()


@router.get("/{conversation_id}/messages", response_model=List[MessageOut])
async def get_messages(
    agent_id: int,
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.id)
    )
    return result.scalars().all()


@router.delete("/{conversation_id}")
async def delete_conversation(
    agent_id: int,
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == current_user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete messages first
    msgs = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id)
    )
    for msg in msgs.scalars().all():
        await db.delete(msg)
    await db.delete(conv)
    return {"ok": True}


@router.websocket("/ws")
async def chat_websocket(
    agent_id: int,
    websocket: WebSocket,
):
    """
    WebSocket chat endpoint.
    Client sends: {"message": "...", "conversation_id": null, "token": "..."}
    Server streams events as JSON lines.
    """
    await websocket.accept()

    try:
        # First message must contain auth token
        raw = await websocket.receive_text()
        data = json.loads(raw)
        token = data.get("token", "")

        # Validate token
        from jose import JWTError, jwt
        from ..models.user import User

        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
            user_id = int(payload.get("sub"))
        except (JWTError, TypeError, ValueError):
            await websocket.send_json({"type": "error", "content": "Unauthorized"})
            await websocket.close()
            return

        async with AsyncSessionLocal() as db:
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if not user or not user.is_active:
                await websocket.send_json({"type": "error", "content": "Unauthorized"})
                await websocket.close()
                return

            agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            if not agent:
                await websocket.send_json({"type": "error", "content": "Agent not found"})
                await websocket.close()
                return

            conv = await get_or_create_conversation(
                db, agent_id, user.id, data.get("conversation_id")
            )
            await db.commit()

            # Send conversation_id back
            await websocket.send_json({"type": "conversation_id", "id": conv.id})

            user_message = data.get("message", "")
            if not user_message.strip():
                await websocket.send_json({"type": "error", "content": "Empty message"})
                return

            async for event in run_conversation(
                db=db,
                agent=agent,
                conversation_id=conv.id,
                user_message=user_message,
            ):
                await websocket.send_json(event)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass

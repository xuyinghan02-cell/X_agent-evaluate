from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.agent import Agent
from ..services.workspace_service import WorkspaceService

router = APIRouter(prefix="/agents", tags=["agents"])
single_router = APIRouter(prefix="/agent", tags=["agent"])


class AgentOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    role_description: Optional[str]
    primary_model: str
    fallback_model: Optional[str]
    provider: str
    history_count: int
    context_window: int
    max_tool_rounds: int
    workspace_path: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    role_description: Optional[str] = None
    primary_model: str = "claude-sonnet-4-6"
    fallback_model: Optional[str] = None
    provider: str = "anthropic"
    history_count: int = 20
    context_window: int = 8000
    max_tool_rounds: int = 50


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role_description: Optional[str] = None
    primary_model: Optional[str] = None
    fallback_model: Optional[str] = None
    provider: Optional[str] = None
    history_count: Optional[int] = None
    context_window: Optional[int] = None
    max_tool_rounds: Optional[int] = None
    is_active: Optional[bool] = None


@router.get("", response_model=List[AgentOut])
async def list_agents(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Agent).where(Agent.is_active == True).order_by(Agent.id))
    return result.scalars().all()


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.post("", response_model=AgentOut)
async def create_agent(
    data: AgentCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    agent = Agent(**data.model_dump())
    db.add(agent)
    await db.flush()

    workspace_path = WorkspaceService.create_workspace()
    agent.workspace_path = workspace_path
    await db.flush()
    return agent


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: int,
    data: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    return agent


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.is_active = False
    return {"ok": True}


@single_router.get("", response_model=AgentOut)
async def get_single_agent(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Returns the single evaluation agent."""
    result = await db.execute(
        select(Agent).where(Agent.is_active == True).order_by(Agent.id).limit(1)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="No agent configured")
    return agent

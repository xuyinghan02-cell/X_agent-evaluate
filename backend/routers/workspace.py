import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List
from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.agent import Agent
from ..services.workspace_service import WorkspaceService

router = APIRouter(prefix="/agents/{agent_id}/workspace", tags=["workspace"])


async def get_workspace(agent_id: int, db: AsyncSession, _) -> WorkspaceService:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.workspace_path:
        raise HTTPException(status_code=404, detail="Agent workspace not found")
    return WorkspaceService(agent.workspace_path)


class FileItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int | None = None


class WriteRequest(BaseModel):
    path: str
    content: str


@router.get("/files", response_model=List[FileItem])
async def list_files(
    agent_id: int,
    sub_dir: str = "",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    return ws.list_files(sub_dir)


@router.get("/files/content")
async def read_file(
    agent_id: int,
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    try:
        content = await ws.read_file(path)
        return PlainTextResponse(content)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")


@router.put("/files")
async def write_file(
    agent_id: int,
    req: WriteRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    await ws.write_file(req.path, req.content)
    return {"ok": True}


@router.delete("/files")
async def delete_file(
    agent_id: int,
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    await ws.delete_file(path)
    return {"ok": True}


@router.post("/upload")
async def upload_file(
    agent_id: int,
    sub_dir: str = "uploads",
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    data = await file.read()
    saved_path = await ws.save_upload(sub_dir, file.filename, data)
    return {"path": saved_path}


@router.get("/skills")
async def list_skills(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ws = await get_workspace(agent_id, db, current_user)
    return {"skills": ws.list_skills()}

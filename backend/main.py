from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.database import init_db
from .core.auth import hash_password
from .routers import auth, users, workspace, conversations
from .routers.agents import router as agents_router, single_router as agent_router
from .routers.settings_router import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_admin()
    await seed_agent()
    yield


async def seed_admin():
    """Create default admin user if none exists."""
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.user import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "admin"))
        if not result.scalar_one_or_none():
            admin = User(
                username="admin",
                hashed_password=hash_password("admin123"),
                display_name="Administrator",
                role="admin",
            )
            db.add(admin)
            await db.commit()


async def seed_agent():
    """Create the single evaluation agent if it doesn't exist, and ensure its workspace is valid."""
    from pathlib import Path
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.agent import Agent
    from .services.workspace_service import WorkspaceService

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Agent).where(Agent.is_active == True))
        agent = result.scalar_one_or_none()
        if not agent:
            agent = Agent(
                name="评估智能体",
                description="智能体评估平台内置助手",
                primary_model="claude-sonnet-4-6",
                provider="anthropic",
                history_count=20,
                context_window=8000,
                max_tool_rounds=50,
            )
            db.add(agent)
            await db.flush()
            agent.workspace_path = WorkspaceService.create_workspace()
            await db.commit()
        else:
            from .core.config import settings
            # Always resolve to an absolute native path for the current OS.
            # This fixes stale paths written by a different OS (e.g. /mnt/d/... on Windows).
            canonical = str(Path(settings.workspaces_dir).resolve())
            if agent.workspace_path != canonical:
                agent.workspace_path = canonical
                await db.commit()

            # Ensure workspace directory and default files exist
            canonical_path = Path(canonical)
            canonical_path.mkdir(parents=True, exist_ok=True)
            WorkspaceService._write_default_files(canonical_path)


app = FastAPI(
    title="Agent Evaluate API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(settings_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

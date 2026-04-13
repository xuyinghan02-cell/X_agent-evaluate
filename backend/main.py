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
            agent.workspace_path = WorkspaceService.create_workspace(agent.id)
            await db.commit()
        else:
            from .core.config import settings
            import shutil
            canonical = Path(settings.workspaces_dir)

            # Migrate old layout: workspaces/{id}/ → workspaces/
            if agent.workspace_path and Path(agent.workspace_path) != canonical:
                old = Path(agent.workspace_path)
                if old.exists() and old.is_dir():
                    canonical.mkdir(parents=True, exist_ok=True)
                    for item in old.iterdir():
                        dest = canonical / item.name
                        if dest.exists():
                            if dest.is_dir():
                                # Merge: move contents into existing dir
                                for sub in item.iterdir():
                                    sub_dest = dest / sub.name
                                    if not sub_dest.exists():
                                        shutil.move(str(sub), str(dest))
                            # else: keep existing file (don't overwrite)
                        else:
                            shutil.move(str(item), str(canonical))
                    # Remove now-empty old dir
                    try:
                        old.rmdir()
                    except OSError:
                        pass
                agent.workspace_path = str(canonical)
                await db.commit()

            # Ensure workspace exists and default files are present
            if not agent.workspace_path or not Path(agent.workspace_path).exists():
                agent.workspace_path = WorkspaceService.create_workspace(agent.id)
                await db.commit()
            else:
                WorkspaceService._write_default_files(Path(agent.workspace_path))


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

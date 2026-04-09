import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.database import init_db
from .core.config import settings
from .core.auth import hash_password
from .routers import auth, users, agents, workspace, conversations


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_admin()
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
app.include_router(agents.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

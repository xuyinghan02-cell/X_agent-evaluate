from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from ..core.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    role_description = Column(Text, nullable=True)

    # AI model config
    primary_model = Column(String(128), default="claude-sonnet-4-6")
    fallback_model = Column(String(128), nullable=True)
    provider = Column(String(32), default="anthropic")  # anthropic | openai

    # Context management
    history_count = Column(Integer, default=20)
    context_window = Column(Integer, default=8000)
    max_tool_rounds = Column(Integer, default=50)

    # Workspace
    workspace_path = Column(String(512), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

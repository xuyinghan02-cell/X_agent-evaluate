from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "Agent Evaluate"
    secret_key: str = "change-me-in-production-super-secret-key-32chars"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    database_url: str = "sqlite+aiosqlite:///./agent_evaluate.db"
    workspaces_dir: str = str(Path(__file__).parent.parent / "workspaces")

    # Default LLM settings
    default_model: str = "claude-sonnet-4-6"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    minimax_api_key: str = ""

    max_tool_call_rounds: int = 50
    default_history_count: int = 20

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

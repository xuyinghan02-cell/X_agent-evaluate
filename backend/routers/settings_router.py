from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Dict, Optional
from ..core.database import get_db
from ..core.auth import get_current_user, require_admin
from ..models.settings import SystemSettings

router = APIRouter(prefix="/settings", tags=["settings"])

# Keys visible to all authenticated users
PUBLIC_KEYS = {
    "active_provider",
    "anthropic_model", "openai_model", "deepseek_model", "minimax_model", "volce_model",
    "history_count", "max_tool_rounds",
}
# Keys that are API keys (masked for non-admin, writable by admin only)
API_KEY_KEYS = {"anthropic_api_key", "openai_api_key", "minimax_api_key", "deepseek_api_key", "volce_api_key"}

ALL_KEYS = PUBLIC_KEYS | API_KEY_KEYS


class SettingsUpdate(BaseModel):
    settings: Dict[str, Optional[str]]


async def get_setting(db: AsyncSession, key: str) -> Optional[str]:
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def set_setting(db: AsyncSession, key: str, value: Optional[str]):
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(SystemSettings(key=key, value=value))


@router.get("")
async def read_settings(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(SystemSettings))
    rows = {r.key: r.value for r in result.scalars().all()}

    out = {}
    for key in ALL_KEYS:
        val = rows.get(key, "")
        if key in API_KEY_KEYS:
            if current_user.role == "admin":
                # Mask all but last 4 chars for display
                out[key] = ("*" * (len(val) - 4) + val[-4:]) if val and len(val) > 4 else ("****" if val else "")
            # Non-admin: don't include API keys at all
        else:
            out[key] = val or ""
    return out


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    for key, value in body.settings.items():
        if key in ALL_KEYS:
            # Don't overwrite API key if the value is masked (contains ***)
            if key in API_KEY_KEYS and value and "***" in value:
                continue
            await set_setting(db, key, value)
    await db.commit()
    return {"ok": True}


@router.get("/raw/{key}")
async def get_raw_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """Internal endpoint — returns the raw (unmasked) value of a setting."""
    value = await get_setting(db, key)
    return {"key": key, "value": value}

import os
import shutil
import aiofiles
from pathlib import Path
from typing import List, Optional
from ..core.config import settings


class WorkspaceService:
    def __init__(self, workspace_path: str):
        self.base = Path(workspace_path)

    @staticmethod
    def create_workspace(agent_id: int) -> str:
        base = Path(settings.workspaces_dir) / str(agent_id)
        dirs = [base, base / "skills", base / "uploads", base / "outputs"]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)

        # Create default identity files
        WorkspaceService._write_default_files(base)
        return str(base)

    @staticmethod
    def _write_default_files(base: Path):
        agent_md = base / "agent.md"
        if not agent_md.exists():
            agent_md.write_text(
                "# Agent Instructions\n\n"
                "## Session Startup\n"
                "1. Load memory.md and review accumulated knowledge\n"
                "2. Note the current date/time from runtime context\n\n"
                "## Memory Rules\n"
                "- Write important facts, user preferences, and task outcomes to memory.md\n"
                "- Do NOT write temporary session data or one-time instructions\n\n"
                "## System Context\n"
                "Your system prompt is assembled from:\n"
                "- <agent>: This file — meta instructions\n"
                "- <soul>: Your personality and behavior guidelines\n"
                "- <memory>: Your accumulated long-term knowledge\n"
                "- <skills>: Enabled skill modules for this session\n"
                "- <runtime>: Current time, workspace path, and environment info\n\n"
                "## Work Guidelines\n"
                "- Prefer available tools over guessing\n"
                "- When uncertain, ask for clarification before acting\n"
                "- Always confirm destructive actions with the user\n"
            )

        soul_md = base / "soul.md"
        if not soul_md.exists():
            soul_md.write_text(
                "# Soul\n\n"
                "## Personality\n"
                "I am a professional, helpful, and thoughtful digital assistant.\n\n"
                "## Communication Style\n"
                "- Clear and concise\n"
                "- Friendly but professional\n"
                "- Proactive in offering relevant information\n\n"
                "## Professional Boundaries\n"
                "- I focus on tasks within my defined role\n"
                "- I decline requests that are harmful or unethical\n\n"
                "## Core Values\n"
                "- Accuracy over speed\n"
                "- Transparency in reasoning\n"
                "- Respect for user autonomy\n"
            )

        memory_md = base / "memory.md"
        if not memory_md.exists():
            memory_md.write_text("# Memory\n\n_No memories recorded yet._\n")

    async def read_file(self, relative_path: str) -> str:
        file_path = self.base / relative_path
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {relative_path}")
        async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
            return await f.read()

    async def write_file(self, relative_path: str, content: str):
        file_path = self.base / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(content)

    async def delete_file(self, relative_path: str):
        file_path = self.base / relative_path
        if file_path.is_dir():
            shutil.rmtree(file_path)
        else:
            file_path.unlink(missing_ok=True)

    def list_files(self, sub_dir: str = "") -> List[dict]:
        target = self.base / sub_dir if sub_dir else self.base
        if not target.exists():
            return []
        result = []
        for entry in sorted(target.iterdir()):
            rel = str(entry.relative_to(self.base))
            result.append({
                "name": entry.name,
                "path": rel,
                "is_dir": entry.is_dir(),
                "size": entry.stat().st_size if entry.is_file() else None,
            })
        return result

    async def save_upload(self, sub_dir: str, filename: str, data: bytes) -> str:
        target_dir = self.base / sub_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / filename
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(data)
        return str(file_path.relative_to(self.base))

    def list_skills(self) -> List[str]:
        skills_dir = self.base / "skills"
        if not skills_dir.exists():
            return []
        return [f.name for f in skills_dir.iterdir() if f.is_file()]

    async def build_system_prompt(self, agent) -> str:
        parts = []

        try:
            agent_content = await self.read_file("agent.md")
            parts.append(f"<agent>\n{agent_content}\n</agent>")
        except FileNotFoundError:
            pass

        try:
            soul_content = await self.read_file("soul.md")
            parts.append(f"<soul>\n{soul_content}\n</soul>")
        except FileNotFoundError:
            pass

        try:
            memory_content = await self.read_file("memory.md")
            parts.append(f"<memory>\n{memory_content}\n</memory>")
        except FileNotFoundError:
            pass

        # Load skills
        skills_dir = self.base / "skills"
        if skills_dir.exists():
            skill_contents = []
            for skill_file in sorted(skills_dir.iterdir()):
                if skill_file.is_file():
                    try:
                        async with aiofiles.open(skill_file, "r", encoding="utf-8") as f:
                            content = await f.read()
                        skill_contents.append(f"### {skill_file.stem}\n{content}")
                    except Exception:
                        pass
            if skill_contents:
                parts.append("<skills>\n" + "\n\n".join(skill_contents) + "\n</skills>")

        from datetime import datetime
        runtime = (
            f"<runtime>\n"
            f"Current time: {datetime.now().isoformat()}\n"
            f"Workspace: {self.base}\n"
            f"Agent: {agent.name}\n"
            f"</runtime>"
        )
        parts.append(runtime)

        return "\n\n".join(parts)

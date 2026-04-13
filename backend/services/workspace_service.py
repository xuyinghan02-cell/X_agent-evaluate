import shutil
import aiofiles
from pathlib import Path
from typing import List, Optional
from ..core.config import settings


class WorkspaceService:
    def __init__(self, workspace_path: str):
        self.base = Path(workspace_path).resolve()

    @staticmethod
    def create_workspace() -> str:
        base = Path(settings.workspaces_dir).resolve()
        dirs = [base, base / "skills", base / "uploads", base / "outputs", base / "testcase"]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)
        WorkspaceService._write_default_files(base)
        return str(base)

    @staticmethod
    def _write_default_files(base: Path):
        # Ensure all standard subdirectories exist (safe to call on existing workspaces)
        for sub in ("skills", "uploads", "outputs", "testcase"):
            (base / sub).mkdir(parents=True, exist_ok=True)

        agent_md = base / "agent.md"
        if not agent_md.exists():
            agent_md.write_text(
                "# Agent Instructions\n\n"
                "## Session Startup\n"
                "1. Load memory.md and focus.md, review accumulated knowledge\n"
                "2. Note the current date/time from runtime context\n\n"
                "## Memory Rules\n"
                "- **memory.md** (长期记忆): Write important facts, user preferences, and task outcomes that should persist across sessions\n"
                "- **focus.md** (短期记忆): Write current session goals, in-progress context, and temporary notes. Clear when a task is complete.\n"
                "- Do NOT write trivial or one-time data to memory.md\n\n"
                "## System Context\n"
                "Your system prompt is assembled from:\n"
                "- <agent>: This file — meta instructions\n"
                "- <soul>: Your personality and behavior guidelines\n"
                "- <memory>: Long-term accumulated knowledge\n"
                "- <focus>: Short-term session memory (focus.md)\n"
                "- <skills>: Enabled skill modules for this session\n"
                "- <runtime>: Current time, workspace path, and environment info\n\n"
                "## Workspace Layout\n"
                "- **skills/**: Skill module files loaded into the system prompt\n"
                "- **uploads/**: User-uploaded files for reference or processing\n"
                "- **outputs/**: Generated results, reports, and artifacts\n"
                "- **testcase/**: Versioned test cases for evaluation. Organize by version subdirectory, e.g. `testcase/v1/`, `testcase/v2/`. Each test case file should include inputs, expected outputs, and evaluation criteria.\n\n"
                "## Work Guidelines\n"
                "- Prefer available tools over guessing\n"
                "- When uncertain, ask for clarification before acting\n"
                "- Always confirm destructive actions with the user\n",
                encoding="utf-8",
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
                "- Respect for user autonomy\n",
                encoding="utf-8",
            )

        memory_md = base / "memory.md"
        if not memory_md.exists():
            memory_md.write_text(
                "# 长期记忆 (Memory)\n\n_No memories recorded yet._\n",
                encoding="utf-8",
            )

        focus_md = base / "focus.md"
        if not focus_md.exists():
            focus_md.write_text(
                "# 短期记忆 (Focus)\n\n_Current session focus. Clear after task completion._\n",
                encoding="utf-8",
            )

    def _safe_path(self, relative_path: str) -> Path:
        """Normalize path separators and resolve safely within workspace."""
        normalized = relative_path.replace("\\", "/").lstrip("/")
        resolved = (self.base / normalized).resolve()
        base_resolved = self.base.resolve()
        try:
            resolved.relative_to(base_resolved)
        except ValueError:
            raise ValueError(f"Path escapes workspace: {relative_path}")
        return resolved

    async def read_file(self, relative_path: str) -> str:
        file_path = self._safe_path(relative_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {relative_path}")
        if not file_path.is_file():
            raise IsADirectoryError(f"Path is a directory: {relative_path}")
        async with aiofiles.open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return await f.read()

    async def write_file(self, relative_path: str, content: str):
        file_path = self._safe_path(relative_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(content)

    async def delete_file(self, relative_path: str):
        file_path = self._safe_path(relative_path)
        if file_path.is_dir():
            shutil.rmtree(file_path)
        else:
            file_path.unlink(missing_ok=True)

    def list_files(self, sub_dir: str = "") -> List[dict]:
        if sub_dir:
            target = self._safe_path(sub_dir)
        else:
            target = self.base
        if not target.exists():
            return []
        result = []
        for entry in sorted(target.iterdir()):
            # Always use forward slashes for cross-platform compatibility
            rel = entry.relative_to(self.base).as_posix()
            result.append({
                "name": entry.name,
                "path": rel,
                "is_dir": entry.is_dir(),
                "size": entry.stat().st_size if entry.is_file() else None,
            })
        return result

    async def save_upload(self, sub_dir: str, filename: str, data: bytes) -> str:
        target_dir = self._safe_path(sub_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        # Sanitize filename
        safe_name = Path(filename).name
        file_path = target_dir / safe_name
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(data)
        return file_path.relative_to(self.base).as_posix()

    def list_skills(self) -> List[str]:
        skills_dir = self.base / "skills"
        if not skills_dir.exists():
            return []
        return [f.name for f in sorted(skills_dir.iterdir()) if f.is_file()]

    async def build_system_prompt(self, agent, selected_skills: Optional[List[str]] = None) -> str:
        """
        Assemble system prompt from identity files.
        selected_skills: if None, load all skills; if list, load only listed skill filenames.
        """
        parts = []

        for filename, tag in [("agent.md", "agent"), ("soul.md", "soul"), ("memory.md", "memory")]:
            try:
                content = await self.read_file(filename)
                parts.append(f"<{tag}>\n{content}\n</{tag}>")
            except (FileNotFoundError, IsADirectoryError):
                pass

        # Short-term memory (focus.md)
        try:
            focus_content = await self.read_file("focus.md")
            parts.append(f"<focus>\n{focus_content}\n</focus>")
        except (FileNotFoundError, IsADirectoryError):
            pass

        # Skills (filtered if selected_skills is provided)
        skills_dir = self.base / "skills"
        if skills_dir.exists():
            skill_contents = []
            for skill_file in sorted(skills_dir.iterdir()):
                if not skill_file.is_file():
                    continue
                if selected_skills is not None:
                    # Match by filename or stem
                    if skill_file.name not in selected_skills and skill_file.stem not in selected_skills:
                        continue
                try:
                    async with aiofiles.open(skill_file, "r", encoding="utf-8", errors="replace") as f:
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
            f"Agent: {agent.name}\n"
            f"Workspace directories: outputs/, testcase/, skills/, uploads/\n"
            f"IMPORTANT: When calling file tools (read_file, write_file, list_files), "
            f"always use relative paths such as 'outputs/result.md' or 'testcase/v1/case1.json'. "
            f"Do NOT use absolute paths.\n"
            f"</runtime>"
        )
        parts.append(runtime)

        return "\n\n".join(parts)

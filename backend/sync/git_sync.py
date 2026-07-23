import asyncio
import hashlib
import os


async def _run_cmd(cmd: list[str], cwd: str | None = None) -> str:
    """Run a shell command and return stdout. Raises on non-zero exit."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"git command failed: {stderr.decode()}")
    return stdout.decode()


async def clone(url: str, dest: str, branch: str = "main") -> None:
    """Clone a git repository to local path."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    await _run_cmd(["git", "clone", "--branch", branch, "--depth", "1", url, dest])


async def pull(dest: str) -> list[str]:
    """Pull latest changes, return list of changed file paths (relative)."""
    # Fetch + reset to handle force pushes and rebases
    await _run_cmd(["git", "fetch", "origin"], cwd=dest)
    await _run_cmd(["git", "reset", "--hard", "origin/HEAD"], cwd=dest)
    # Get list of changed files
    output = await _run_cmd(["git", "diff", "--name-only", "HEAD@{1}", "HEAD"], cwd=dest)
    return [f.strip() for f in output.split("\n") if f.strip()]


async def list_files(repo_path: str) -> dict[str, str]:
    """Walk repo path and return {relative_path: sha256} for supported files."""
    supported = {".md", ".txt", ".pdf", ".docx"}
    files: dict[str, str] = {}
    for root, _dirs, filenames in os.walk(repo_path):
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in supported:
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, repo_path)
            # Compute sha256
            sha = hashlib.sha256()
            with open(full, "rb") as f:
                while chunk := f.read(8192):
                    sha.update(chunk)
            files[rel] = sha.hexdigest()
    return files

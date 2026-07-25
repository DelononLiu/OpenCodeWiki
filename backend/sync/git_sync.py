import asyncio
import hashlib
import os
import urllib.parse


class GITAuthError(RuntimeError):
    """Raised when Git operations fail due to authentication."""
    pass


_GIT_AUTH_SIGNATURES = [
    "Authentication failed",
    "could not read Username",
    "could not read Password",
    "fatal: Authentication failed",
    "fatal: could not read",
    "access denied",
    "403: Forbidden",
    "401: Unauthorized",
]


def is_auth_error(stderr: str) -> bool:
    return any(sig in stderr for sig in _GIT_AUTH_SIGNATURES)


def _embed_credentials(url: str, username: str, password: str) -> str:
    """Embed username:password into an HTTPS URL for Git auth."""
    if not username or not url.startswith(("http://", "https://")):
        return url
    prefix = "https://" if url.startswith("https://") else "http://"
    rest = url[len(prefix):]
    encoded_u = urllib.parse.quote(username, safe="")
    encoded_p = urllib.parse.quote(password, safe="")
    return f"{prefix}{encoded_u}:{encoded_p}@{rest}"


async def _run_cmd(cmd: list[str], cwd: str | None = None) -> str:
    """Run a shell command and return stdout. Raises on non-zero exit."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    stderr_str = stderr.decode()
    if proc.returncode != 0:
        if is_auth_error(stderr_str):
            raise GITAuthError(stderr_str)
        raise RuntimeError(f"git command failed: {stderr_str}")
    return stdout.decode()


async def clone(url: str, dest: str, branch: str = "main",
                username: str | None = None, password: str | None = None) -> None:
    """Clone a git repository to local path. Falls back to default branch if specified branch doesn't exist."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    git_url = _embed_credentials(url, username or "", password or "") if (username or password) else url
    try:
        await _run_cmd(["git", "clone", "--branch", branch, "--depth", "1", git_url, dest])
    except RuntimeError as e:
        if "Could not find remote branch" in str(e) or "not found in upstream" in str(e):
            await _run_cmd(["git", "clone", "--depth", "1", git_url, dest])
        else:
            raise


async def pull(dest: str) -> list[str]:
    """Pull latest changes, return list of changed file paths (relative)."""
    await _run_cmd(["git", "fetch", "origin"], cwd=dest)
    await _run_cmd(["git", "reset", "--hard", "origin/HEAD"], cwd=dest)
    output = await _run_cmd(["git", "diff", "--name-only", "HEAD@{1}", "HEAD"], cwd=dest)
    return [f.strip() for f in output.split("\n") if f.strip()]


async def get_remote_head_commit(url: str, branch: str = "main") -> str:
    """Fetch the latest commit hash from a remote git URL without cloning."""
    try:
        out = await _run_cmd(["git", "ls-remote", url, branch])
        if out:
            return out.split()[0][:7]
    except GITAuthError:
        raise
    except Exception:
        pass
    return ""


async def get_head_commit(repo_path: str) -> str:
    """Return the short hash (7 chars) of HEAD."""
    try:
        out = await _run_cmd(["git", "rev-parse", "--short", "HEAD"], cwd=repo_path)
        return out.strip()
    except Exception:
        return ""


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
            sha = hashlib.sha256()
            with open(full, "rb") as f:
                while chunk := f.read(8192):
                    sha.update(chunk)
            files[rel] = sha.hexdigest()
    return files

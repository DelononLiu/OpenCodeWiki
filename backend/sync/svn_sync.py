import asyncio
import hashlib
import os

_AUTH_ERROR_SIGNATURES = [
    "认证失败",
    "Authentication failed",
    "认证已取消",
    "authorization failed",
    "svn: E215004",
    "svn: E170001",
    "Could not authenticate to server",
    "svn: E200014",
]


class SVNAuthError(RuntimeError):
    """Raised when SVN operations fail because authentication is needed."""
    pass


def is_auth_error(stderr: str) -> bool:
    return any(sig in stderr for sig in _AUTH_ERROR_SIGNATURES)


async def _run_cmd(cmd: list[str], cwd: str | None = None, timeout: int = 300) -> tuple[str, str, int]:
    """Run a command, return (stdout, stderr, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"Command timed out after {timeout}s: {' '.join(cmd)}")
    return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode


def _build_svn_url(url: str, branch: str) -> str:
    """Build the full SVN URL by appending the branch if not already present."""
    url = url.rstrip("/")
    branch = branch.strip() if branch else ""
    if branch and branch != "/" and not url.endswith(f"/{branch}"):
        url = url + "/" + branch
    return url


def _build_auth_args(username: str | None, password: str | None) -> list[str]:
    args = ["--non-interactive", "--trust-server-cert-fail-unknown-ca"]
    if username:
        args.extend(["--username", username])
    if password:
        args.extend(["--password", password])
    return args


async def checkout(url: str, dest: str, branch: str = "trunk", username: str | None = None, password: str | None = None) -> None:
    """SVN checkout. Equivalent of git clone."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    svn_url = _build_svn_url(url, branch)
    cmd = ["svn", "checkout"] + _build_auth_args(username, password) + [svn_url, dest]
    stdout, stderr, rc = await _run_cmd(cmd)
    if rc != 0:
        if is_auth_error(stderr):
            raise SVNAuthError(stderr)
        raise RuntimeError(f"svn checkout failed: {stderr}")


async def update(dest: str, username: str | None = None, password: str | None = None) -> list[str]:
    """Update working copy and return list of changed file paths (relative)."""
    cmd = ["svn", "update"] + _build_auth_args(username, password)
    stdout, stderr, rc = await _run_cmd(cmd, cwd=dest)
    if rc != 0:
        if is_auth_error(stderr):
            raise SVNAuthError(stderr)
        raise RuntimeError(f"svn update failed: {stderr}")

    changed = []
    for line in stdout.split("\n"):
        line = line.rstrip()
        # Format: "U   path/to/file" or "UU  path" (one or two status chars, then space(s), then path)
        if len(line) >= 4 and line[0] in "UADMRCGE!":
            n = 2 if len(line) > 1 and line[1] in "UADMRCGE!" else 1
            path = line[n:].lstrip()
            if path:
                changed.append(path)
        elif len(line) >= 4 and line[0] == " " and line[1] in "UADMRCGE!":
            path = line[2:].lstrip()
            if path:
                changed.append(path)
    return changed


async def get_head_revision(url: str, branch: str = "trunk", username: str | None = None, password: str | None = None) -> str:
    """Return the latest revision number (short string)."""
    svn_url = _build_svn_url(url, branch)
    cmd = ["svn", "info", "--show-item", "revision"] + _build_auth_args(username, password) + [svn_url]
    stdout, stderr, rc = await _run_cmd(cmd)
    if rc == 0:
        return stdout.strip()[:7]
    return ""


async def get_revision(repo_path: str) -> str:
    """Return the current revision of the working copy."""
    cmd = ["svn", "info", "--show-item", "revision"]
    stdout, stderr, rc = await _run_cmd(cmd, cwd=repo_path)
    if rc == 0:
        return stdout.strip()
    return ""


async def list_files(repo_path: str) -> dict[str, str]:
    """Walk repo path and return {relative_path: sha256} for supported files, skipping .svn dirs."""
    supported = {".md", ".txt", ".pdf", ".docx"}
    files: dict[str, str] = {}
    for root, dirs, filenames in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d != ".svn"]
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

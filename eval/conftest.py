"""pytest fixtures for QA eval tests."""
import subprocess
import time
import pytest

BACKEND_URL = "http://localhost:8000"

@pytest.fixture(scope="session")
def backend():
    """Start the FastAPI backend, yield, then stop."""
    import os, signal
    proc = subprocess.Popen(
        ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=os.path.join(os.path.dirname(__file__), "..", "backend"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if hasattr(os, 'setsid') else None,
    )
    time.sleep(3)  # Wait for startup

    # Health check
    import requests
    for _ in range(10):
        try:
            requests.get(f"{BACKEND_URL}/api/repos", timeout=2)
            break
        except Exception:
            time.sleep(1)

    yield BACKEND_URL

    # Cleanup
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def api(backend):
    """Return a requests session configured for the backend."""
    import requests
    s = requests.Session()
    s.base_url = backend
    return s

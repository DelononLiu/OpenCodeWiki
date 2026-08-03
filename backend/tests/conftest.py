import tempfile
import pytest
from backend.config import Config
from backend.database import init_databases


@pytest.fixture(autouse=True)
def _isolated_db():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)
    yield

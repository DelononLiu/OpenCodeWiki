import tempfile
from backend.database import init_databases
from backend.config import Config
from backend.auth import hash_password, verify_password, create_token, verify_token, get_secret
from backend.stores.users import create_user, get_user, get_user_by_username, list_users, set_user_active


def setup_module():
    cfg = Config()
    cfg.database.path = tempfile.mkdtemp()
    init_databases(cfg)

def test_hash_and_verify_password():
    stored = hash_password("secret123")
    assert stored.startswith("pbkdf2_sha256$")
    assert verify_password("secret123", stored)
    assert not verify_password("wrong", stored)

def test_password_hashes_are_salted():
    assert hash_password("same") != hash_password("same")

def test_token_roundtrip():
    secret = "test-secret"
    token = create_token("usr-1", secret)
    assert verify_token(token, secret) == "usr-1"
    assert verify_token(token, "other-secret") is None
    assert verify_token("garbage", secret) is None

def test_get_secret_persists(tmp_path):
    cfg = Config()
    cfg.database.path = str(tmp_path)
    s1 = get_secret(cfg)
    s2 = get_secret(cfg)
    assert s1 == s2 and len(s1) >= 32

def test_first_user_is_admin():
    admin = create_user("alice", "pw1")
    assert admin["role"] == "admin"
    user = create_user("bob", "pw2")
    assert user["role"] == "user"

def test_duplicate_username_rejected():
    create_user("carol", "pw3")
    try:
        create_user("carol", "pw4")
        assert False, "should raise"
    except ValueError:
        pass

def test_get_user_and_list():
    u = create_user("dave", "pw5")
    assert get_user(u["id"])["username"] == "dave"
    assert get_user(u["id"])["password_hash"] is None  # 不泄漏哈希
    assert any(x["username"] == "dave" for x in list_users())

def test_login_lookup_includes_hash():
    u = create_user("eve", "pw6")
    found = get_user_by_username("eve")
    assert found["password_hash"] and found["password_hash"].startswith("pbkdf2_sha256$")

def test_deactivate_user():
    u = create_user("frank", "pw7")
    set_user_active(u["id"], False)
    assert get_user(u["id"])["active"] is False

"""密码哈希与会话令牌（仅标准库）。"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

_ITERATIONS = 200_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != _ALGO:
            return False
        salt = base64.b64decode(salt_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except Exception:
        return False


def get_secret(cfg) -> str:
    """会话签名密钥：env SECRET_KEY 优先，否则在数据目录持久化随机密钥。"""
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    key_path = os.path.join(os.path.expanduser(cfg.database.path), ".session_secret")
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    os.makedirs(os.path.dirname(key_path), exist_ok=True)
    secret = secrets.token_hex(32)
    with open(key_path, "w") as f:
        f.write(secret)
    return secret


def create_token(user_id: str, secret: str, ttl_hours: int = 168) -> str:
    payload = {"uid": user_id, "exp": time.time() + ttl_hours * 3600}
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_token(token: str, secret: str) -> str | None:
    try:
        payload_b64, sig = token.split(".")
        expected = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        if payload["exp"] < time.time():
            return None
        return payload["uid"]
    except Exception:
        return None

"""
crypto.py — Fernet 凭证加解密工具。

密钥来源：
1. 环境变量 OCW_FERNET_KEY（优先）
2. 自动生成并持久化到 ~/.opencodewiki/.fernet_key
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet

_KEY_FILE = Path.home() / ".opencodewiki" / ".fernet_key"
_ENV_VAR = "OCW_FERNET_KEY"


def _get_or_create_key() -> bytes:
    """获取 Fernet 密钥。环境变量优先，不存在则自动生成并落盘。"""
    env_key = os.environ.get(_ENV_VAR)
    if env_key:
        return env_key.encode() if isinstance(env_key, str) else env_key

    _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes()

    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    return key


def encrypt_credential(plaintext: str) -> str:
    """加密凭证，返回 base64 密文字符串。"""
    f = Fernet(_get_or_create_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_credential(ciphertext: str) -> str:
    """解密凭证，返回明文字符串。"""
    f = Fernet(_get_or_create_key())
    return f.decrypt(ciphertext.encode()).decode()

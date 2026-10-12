"""
Byte-for-byte port of the legacy `svtCrypto` class (vTemple7.exe):

    DES.Key = MD5(ASCII(passkey))          # MD5 -> 16 bytes -> used as 2-key (112-bit) 3DES
    DES.Mode = ECB, PKCS7 padding, ASCII plaintext, Base64 ciphertext

We MUST stay wire-compatible with this while the legacy EXE and this app
share the same `MstUser.LoginPwd` column (see CLAUDE.md rule 9 / §8).
Default passkey used everywhere in the old app except the licence file is
"svt$$12@#" (svtModule / svtCrypto default argument).
"""
from __future__ import annotations

import base64
import hashlib

from Crypto.Cipher import DES3
from Crypto.Util.Padding import pad, unpad

from app.core.config import get_settings

DEFAULT_PASSKEY = "svt$$12@#"


def _key24(passkey: str) -> bytes:
    k16 = hashlib.md5(passkey.encode("ascii")).digest()  # nosec B324 - legacy compat, not new security boundary
    return k16 + k16[:8]  # 2-key (K1,K2,K1) 3DES, same as .NET TripleDES with a 16-byte key


def encrypt(plaintext: str, passkey: str | None = None) -> str:
    key = _key24(passkey or get_settings().legacy_crypto_key or DEFAULT_PASSKEY)
    cipher = DES3.new(key, DES3.MODE_ECB)
    data = pad(plaintext.encode("ascii"), 8)
    return base64.b64encode(cipher.encrypt(data)).decode("ascii")


def decrypt(ciphertext_b64: str, passkey: str | None = None) -> str:
    if not ciphertext_b64:
        return ""
    key = _key24(passkey or get_settings().legacy_crypto_key or DEFAULT_PASSKEY)
    cipher = DES3.new(key, DES3.MODE_ECB)
    raw = base64.b64decode(ciphertext_b64)
    data = unpad(cipher.decrypt(raw), 8)
    return data.decode("ascii")

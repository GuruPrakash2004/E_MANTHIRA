"""
The legacy 3DES password format must stay wire-compatible with `svtCrypto`
while the old EXE and this app share the same MstUser table (CLAUDE.md §8).
Never print/log the decrypted values — that's why this test only checks
round-trip stability, not the plaintext content.
"""
from __future__ import annotations

from sqlalchemy import text

from app.core.legacy_crypto import decrypt, encrypt


def test_decrypts_every_real_user_password_and_round_trips(conn):
    rows = conn.execute(text("SELECT UserCode, LoginPwd FROM MstUser WHERE LoginPwd IS NOT NULL AND LoginPwd <> ''")).mappings().all()
    assert rows, "expected at least one real user in MstUser"
    for r in rows:
        plain = decrypt(r["LoginPwd"])
        assert isinstance(plain, str) and plain != ""
        assert decrypt(encrypt(plain)) == plain, f"round-trip failed for {r['UserCode']}"

"""Small text normalisers shared by the entry services."""
from __future__ import annotations

import re


def normalise_name(value: str | None) -> str:
    """Trim, collapse repeated spaces and Title Case a person's name ("oscar  fernandas" / "MALIKARJUN" -> "Oscar Fernandas").
    Non-Latin text (e.g. Kannada) has no case and is left exactly as typed, apart from trimming."""
    text = re.sub(r"\s+", " ", (value or "").strip())
    return re.sub(r"(^|[\s.'-])([A-Za-z])", lambda m: m.group(1) + m.group(2).upper(), text.lower()) if text.isascii() else text

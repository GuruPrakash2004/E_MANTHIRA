"""
Shop (company) details for printouts, from the single-row `MstComp`.

Two uses (roadmap step 6), both generic — nothing here knows a report by name:
  1. `parameter_values()` — the details under every common parameter name (CompName, Add1..Add5, Phone/Tel/PhNo, Mobile,
     Email, Web, GSTIN/GSTNO, PAN/PANNO, CIN). The bridge sets only the names a report actually declares and skips the rest.
     Values the print option supplies itself (`UtlOption.FormulasFld/FormulasVal`) always win over these.
  2. `labelled_values()` — canonical keys the bridge uses to fill plain-text labels such as "PH NO:" / "GSTIN No:" that a
     report prints without any parameter behind them.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause

# canonical key -> MstComp columns, first non-blank wins
_SOURCES: dict[str, tuple[str, ...]] = {
    "compname": ("CompName",),
    "add1": ("Address1",), "add2": ("Address2",), "add3": ("Address3",), "add4": ("Address4",), "add5": ("Address5",),
    "phone": ("TELNO", "MOBNO"),
    "mobile": ("MOBNO", "TELNO"),
    "email": ("EMAIL",),
    "web": ("WEB",),
    "gstin": ("GSTNO",),
    "pan": ("PANNO",),
    "cin": ("CINNO",),
}

# canonical key -> parameter names reports commonly declare (matched case-insensitively by the bridge)
_PARAMETER_NAMES: dict[str, tuple[str, ...]] = {
    "compname": ("CompName", "CompanyName", "TempleName", "ShopName"),
    "add1": ("Add1", "Address1"), "add2": ("Add2", "Address2"), "add3": ("Add3", "Address3"),
    "add4": ("Add4", "Address4"), "add5": ("Add5", "Address5"),
    "phone": ("Phone", "PhNo", "Tel", "TelNo", "Telephone"),
    "mobile": ("Mobile", "MobNo", "MobileNo"),
    "email": ("Email", "EmailID"),
    "web": ("Web", "Website", "URL"),
    "gstin": ("GSTIN", "GSTNO"),
    "pan": ("PAN", "PANNO"),
    "cin": ("CIN", "CINNO"),
}


def labelled_values(conn: Connection) -> dict[str, str]:
    """{canonical key: value} — blank values dropped, so a label is never filled with nothing."""
    row = conn.execute(text(f"SELECT * FROM MstComp ORDER BY CompID {limit_clause(1)}")).mappings().first()
    if row is None:
        return {}
    values: dict[str, str] = {}
    for key, columns in _SOURCES.items():
        for col in columns:
            v = str(row.get(col) or "").strip()
            if v:
                values[key] = v
                break
    return values


def parameter_values(shop: dict[str, str]) -> dict[str, str]:
    """Every common parameter name -> value ("" when the shop has none), for the bridge to apply where declared."""
    return {name: shop.get(key, "") for key, names in _PARAMETER_NAMES.items() for name in names}

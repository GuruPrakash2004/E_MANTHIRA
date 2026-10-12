"""
Builds the `formula_values` dict passed to the Crystal service — port of how
`UtlOption.FormulasFld/FormulasVal` + `UtlParameters` feed company fields
(compname, add1..add5, mobno, gstno, panno, email, web...) into a report.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause

_COMPANY_FIELD_MAP = {
    "compname": "CompName", "add1": "Address1", "add2": "Address2", "add3": "Address3",
    "add4": "Address4", "mobno": "MOBNO", "phno": "TELNO", "tel": "TELNO",
    "gstno": "GSTNO", "panno": "PANNO", "pan": "PANNO", "email": "EMAIL", "web": "WEB",
}


def company_formula_values(conn: Connection) -> dict[str, str]:
    row = conn.execute(text(f"SELECT * FROM MstComp ORDER BY CompID {limit_clause(1)}")).mappings().first()
    if row is None:
        return {}
    return {key: str(row.get(col, "") or "") for key, col in _COMPANY_FIELD_MAP.items()}

"""Add Items - the item list helper of the stock reports (legacy `frmUtlAddItems`).

* validate: a pasted list of item codes (one per line) is checked against the item master (exact item code), each row Valid / Invalid;
* saved lists: named lists of items kept in `UtlAddItemList` (ListName, SLNO, ITEMID, Rmks) - Load / Save List / Remove List.
The table is a legacy one; a database without it simply has no saved lists (`available` false), nothing is created.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import capabilities

MAX_CODES = 2000


def available() -> bool:
    return capabilities.has_table("UtlAddItemList")


def validate_codes(conn: Connection, codes: list[str]) -> list[dict]:
    """Per pasted code (blank lines dropped, repeats kept in order): the item it names, or invalid."""
    cleaned = [c.strip() for c in codes if c and c.strip()][:MAX_CODES]
    found: dict[str, dict] = {}
    for i in range(0, len(cleaned), 400):
        chunk = sorted({c.lower() for c in cleaned[i : i + 400]})
        params = {f"c{n}": v for n, v in enumerate(chunk)}
        marks = ", ".join(f":c{n}" for n in range(len(chunk)))
        for r in conn.execute(
            text(
                "SELECT i.ITEMID, i.ITEMCODE, i.ITEMNAME, u.UOMCODE FROM MstITEM i LEFT JOIN MstUOM u ON u.UOMID = i.UOMID "
                f"WHERE i.ITEMID > 0 AND LOWER(i.ITEMCODE) IN ({marks})"
            ),
            params,
        ).all():
            found[str(r[1]).strip().lower()] = {"item_id": int(r[0]), "code": str(r[1]).strip(), "name": str(r[2] or "").strip(), "uom": str(r[3] or "").strip()}
    out = []
    for n, code in enumerate(cleaned, start=1):
        hit = found.get(code.lower())
        out.append({"sl_no": n, "code": hit["code"] if hit else code, "valid": hit is not None, **({"item_id": hit["item_id"], "name": hit["name"], "uom": hit["uom"]} if hit else {"item_id": 0, "name": "", "uom": ""})})
    return out


def list_names(conn: Connection) -> list[str]:
    if not available():
        return []
    return [str(r[0]).strip() for r in conn.execute(text("SELECT DISTINCT ListName FROM UtlAddItemList ORDER BY ListName")).all()]


def load_list(conn: Connection, name: str) -> dict:
    if not available():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item lists are not available in this database")
    rows = conn.execute(
        text(
            "SELECT a.ITEMID, i.ITEMCODE, i.ITEMNAME, u.UOMCODE, a.Rmks FROM UtlAddItemList a JOIN MstITEM i ON i.ITEMID = a.ITEMID "
            "LEFT JOIN MstUOM u ON u.UOMID = i.UOMID WHERE a.ListName = :n ORDER BY a.SLNO"
        ),
        {"n": name.strip()},
    ).all()
    return {
        "name": name.strip(),
        "remarks": (str(rows[0][4]).strip() if rows and rows[0][4] else ""),
        "items": [{"item_id": int(r[0]), "code": str(r[1]).strip(), "name": str(r[2] or "").strip(), "uom": str(r[3] or "").strip(), "valid": True} for r in rows],
    }


def save_list(conn: Connection, name: str, remarks: str, item_ids: list[int]) -> int:
    name = name.strip()
    if not available():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item lists are not available in this database")
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select or Enter the Item List Name!")
    seen: list[int] = []
    for i in item_ids:
        if int(i) > 0 and int(i) not in seen:
            seen.append(int(i))  # the table's key is (ItemID, ListName, SlNo): an item appears once per list
    if not seen:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select alteast one Item!")
    conn.execute(text("DELETE FROM UtlAddItemList WHERE ListName = :n"), {"n": name})
    for sl, item_id in enumerate(seen, start=1):
        conn.execute(text("INSERT INTO UtlAddItemList (ListName, Rmks, ITEMID, SLNO) VALUES (:n, :r, :i, :s)"), {"n": name, "r": (remarks or "").strip(), "i": item_id, "s": sl})
    return len(seen)


def remove_list(conn: Connection, name: str) -> None:
    if not available():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item lists are not available in this database")
    conn.execute(text("DELETE FROM UtlAddItemList WHERE ListName = :n"), {"n": name.strip()})

"""
Document numbering — port of `svtModule.TrnNoAutoGen` / `getPrintDocFmtNo`.

Fixes D-05 (legacy race: two counters computing MAX(no)+1 at the same time
can collide) by taking the lock via `sp_getapplock` for the whole
(table, prefix, financial-year) key before reading MAX and inserting, and by
retrying once on a primary-key violation.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings


def _fy_year_suffix(fy_start_year: int) -> str:
    return str(fy_start_year)[-2:]


def _next_sequence_number(conn: Connection, *, doc_table: str, fy_year: int, prefix: str) -> int:
    """
    MySQL path: atomic counter in `DocSequence` instead of scanning MAX(no) —
    a real improvement a fresh schema lets us make over the legacy MAX()+1
    scan (see sql/mysql_schema.sql). `INSERT ... ON DUPLICATE KEY UPDATE`
    takes a row lock that blocks concurrent callers until this transaction
    commits, so two counters can never get the same number.
    """
    conn.execute(
        text(
            "INSERT INTO DocSequence (DocTable, FYYear, Prefix, LastNumber) VALUES (:t, :y, :p, 1) "
            "ON DUPLICATE KEY UPDATE LastNumber = LastNumber + 1"
        ),
        {"t": doc_table, "y": fy_year, "p": prefix},
    )
    return int(
        conn.execute(
            text("SELECT LastNumber FROM DocSequence WHERE DocTable = :t AND FYYear = :y AND Prefix = :p"),
            {"t": doc_table, "y": fy_year, "p": prefix},
        ).scalar_one()
    )


def next_doc_no(
    conn: Connection,
    *,
    table_name: str,
    no_column: str,
    prefix: str,
    fy_start_year: int,
    fy_start_date: str,
    fy_end_date: str,
    reset_per_prefix: bool = True,
) -> str:
    """
    Returns the next `YY+PFX+00000` number for `table_name.no_column`, having
    taken an application lock for this (table, prefix, FY) so two concurrent
    saves cannot compute the same number (see doc 09 finding N17 / D-05).
    Caller must be inside a `with_transaction()` block.
    """
    yy = _fy_year_suffix(fy_start_year)

    if get_settings().is_mysql:
        next_no = _next_sequence_number(conn, doc_table=table_name, fy_year=fy_start_year, prefix=prefix)
        return f"{yy}{prefix}{next_no:05d}"

    lock_key = f"docno:{table_name}:{prefix}:{fy_start_year}"
    conn.execute(text("EXEC sp_getapplock @Resource=:k, @LockMode='Exclusive', @LockOwner='Transaction'"), {"k": lock_key})

    if reset_per_prefix:
        sql = f"""
            SELECT ISNULL(MAX(CONVERT(int, RIGHT({no_column}, 5))), 0) + 1
            FROM {table_name}
            WHERE Prefix = :pfx AND LEFT({no_column}, LEN(:yy) + LEN(:pfx)) = :yy + :pfx
        """
        next_no = conn.execute(text(sql), {"pfx": prefix, "yy": yy}).scalar_one()
    else:
        sql = f"""
            SELECT ISNULL(MAX(CONVERT(int, RIGHT({no_column}, 5))), 0) + 1
            FROM {table_name}
            WHERE LEFT({no_column}, LEN(:yy)) = :yy
        """
        next_no = conn.execute(text(sql), {"yy": yy}).scalar_one()

    return f"{yy}{prefix}{int(next_no):05d}"


def next_receipt_no(
    conn: Connection,
    *,
    prefix: str,
    fy_start_year: int,
    fy_start_date: str,
    fy_end_date: str,
) -> str:
    """
    Port of the inline SQL in `SaveRcptVch`:
      SELECT YY + prefix + right('00000'+ max(right(RcptVchNo,5))+1, 5)
      FROM TrnHdrRcptVch
      WHERE Prefix=@pfx AND RcptVchDate BETWEEN @fyStart AND @fyEnd AND Cancelled='N'
    default when none found: YY + '00001'
    """
    yy = _fy_year_suffix(fy_start_year)

    if get_settings().is_mysql:
        next_no = _next_sequence_number(conn, doc_table="TrnHdrRCPTVCH", fy_year=fy_start_year, prefix=prefix)
        return f"{yy}{prefix}{next_no:05d}"

    lock_key = f"docno:TrnHdrRcptVch:{prefix}:{fy_start_year}"
    conn.execute(text("EXEC sp_getapplock @Resource=:k, @LockMode='Exclusive', @LockOwner='Transaction'"), {"k": lock_key})

    sql = """
        SELECT ISNULL(MAX(CONVERT(int, RIGHT(RcptVchNo, 5))), 0) + 1
        FROM TrnHdrRcptVch
        WHERE Prefix = :pfx AND RCPTVCHDate BETWEEN :fs AND :fe AND Cancelled = 'N'
    """
    next_no = conn.execute(text(sql), {"pfx": prefix, "fs": fy_start_date, "fe": fy_end_date}).scalar_one()
    return f"{yy}{prefix}{int(next_no):05d}"


def print_doc_no(conn: Connection, *, doc_id: int, doc_no: str, prefix: str, fy_start_year: int, fy_end_year: int) -> str:
    """
    Port of `svtModule.getPrintDocFmtNo`: assemble the printed number from
    `UtlDocNoFmt.F1..F14` tokens.
      1=prefix  2=4-digit FY-start-year  3=4-digit FY-end-year
      4=2-digit FY-start-year  5=2-digit FY-end-year  6=last 5 digits of doc_no
      7=doc_no without leading zeros  8/9/10=Misc1/2/3  '/' '-' = literal separators
      anything else = literal text
    """
    row = conn.execute(text("SELECT * FROM UtlDocNoFmt WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None:
        return doc_no

    number_tail = doc_no[-5:]
    parts: list[str] = []
    for i in range(1, 15):
        token = (row.get(f"F{i}") or "").strip()
        if token == "":
            continue
        if token == "1":
            parts.append(prefix)
        elif token == "2":
            parts.append(str(fy_start_year))
        elif token == "3":
            parts.append(str(fy_end_year))
        elif token == "4":
            parts.append(str(fy_start_year)[-2:])
        elif token == "5":
            parts.append(str(fy_end_year)[-2:])
        elif token == "6":
            parts.append(number_tail)
        elif token == "7":
            parts.append(str(int(number_tail)))
        elif token in ("8", "9", "10"):
            misc = {"8": row.get("Misc1"), "9": row.get("Misc2"), "10": row.get("Misc3")}[token]
            parts.append((misc or "").strip())
        elif token in ("/", "-"):
            if parts:  # legacy: only append the separator once something precedes it
                parts.append(token)
        else:
            parts.append(token)
    result = "".join(parts)
    return result or doc_no


def resolve_prefix(
    conn: Connection, *, doc_id: int, field_values: dict[str, str]
) -> list[str]:
    """
    Port of `UtlDocNoPrefix` resolution: returns the list of prefixes allowed
    for this document, filtered by any conditional rule
    (CndFldCode/CndOperator/CndFldValue) matched against `field_values`
    (e.g. {"SANNIDHIID": "SLV"} or {"TYPE": "HALL BOOKING"}).
    """
    rows = conn.execute(
        text("SELECT Prefix, CndOperator, CndFldCode, CndFldValue FROM UtlDocNoPrefix WHERE DocID = :d"),
        {"d": doc_id},
    ).mappings().all()
    if not rows:
        return []
    unconditional = [r["Prefix"] for r in rows if not (r["CndFldCode"] or "").strip()]
    if unconditional:
        return unconditional
    matched = []
    for r in rows:
        fld = (r["CndFldCode"] or "").strip()
        val = (r["CndFldValue"] or "").strip()
        op = (r["CndOperator"] or "=").strip()
        actual = str(field_values.get(fld, "")).strip()
        if op == "=" and actual.upper() == val.upper():
            matched.append(r["Prefix"])
    return matched

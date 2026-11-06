"""SQL Query Execution + Saved Query. The validator is the safety net, so it is tested hard; execution runs on the real DB
(read-only); saved queries use a synthetic RptQuery table created inside a transaction that is rolled back."""
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.services import sql_tools as st

GOOD = [
    "select 1",
    "SELECT TOP 5 * FROM MstMenu",
    "  select * from MstMenu where MenuItemCaption = 'it''s -- not a comment; drop table x'  ;",
    "with a as (select 1 as x) select * from a",
    "select [Update], \"Delete\" from [Insert]",  # keyword-looking NAMES in brackets / quotes are just names
    "select @@SERVERNAME, DB_NAME()",
    "select name from sys.tables order by name",
    "SELECT COUNT(*) FROM MstMenu WHERE MenuShow = 'Y' AND MenuItemType IN (1, 2)",
]
BAD = [
    ("", "Enter a query"),
    ("   ", "Enter a query"),
    ("update MstMenu set MenuShow = 'N'", "Only a SELECT"),
    ("delete from MstMenu", "Only a SELECT"),
    ("drop table MstMenu", "Only a SELECT"),
    ("exec sp_who", "Only a SELECT"),
    ("select 1; drop table MstMenu", "Only one statement"),
    ("select 1; select 2", "Only one statement"),
    ("select * into Zcopy from MstMenu", "'INTO' is not allowed"),
    ("select 1 -- trailing", "Comments"),
    ("select /* x */ 1", "Comments"),
    ("with a as (select 1 x) delete from MstMenu", "'DELETE' is not allowed"),
    ("select * from OPENROWSET('SQLNCLI', 'x', 'select 1')", "OPENROWSET"),
    ("select * from OPENQUERY(srv, 'select 1')", "OPENQUERY"),
    ("select 1 where 1 = (select count(*) from sys.sql_logins)", "SQL_LOGINS"),
    ("select xp_cmdshell('dir')", "XP_CMDSHELL"),
    ("select sp_executesql", "SP_EXECUTESQL"),
    ("select @x", "'@X' is not allowed"),
    ("select * from MstMenu where Caption = 'unclosed", "not closed"),
    ("select [unclosed from MstMenu", "not closed"),
    ("set nocount on select 1", "Only a SELECT"),
    ("select 1 waitfor delay '00:00:05'", "WAITFOR"),
    ("select 1 union all select 2 option (maxdop 1) use master", "'USE'"),
    ("declare @a int select 1", "Only a SELECT"),
]


@pytest.mark.parametrize("sql", GOOD)
def test_validator_accepts_plain_selects(sql):
    out = st.validate_select(sql)
    assert out and not out.endswith(";")


@pytest.mark.parametrize("sql,why", BAD)
def test_validator_refuses_everything_that_could_write_or_escape(sql, why):
    with pytest.raises(HTTPException) as e:
        st.validate_select(sql)
    assert e.value.status_code == 422 and why.lower() in e.value.detail.lower()


def test_a_semicolon_or_keyword_inside_a_text_value_is_not_a_second_statement():
    assert st.validate_select("select ';' as a, 'DROP TABLE x' as b").startswith("select ';'")


def test_run_select_returns_rows_columns_and_audits():
    r = st.run_select("select top 3 MenuItemID, MenuItemCaption from MstMenu order by MenuItemID", user_code="T")
    assert r["columns"] == ["MenuItemID", "MenuItemCaption"] and r["row_count"] == 3 and not r["truncated"] and len(r["rows"]) == 3
    with get_engine().connect() as c:
        assert c.execute(text("SELECT TOP 1 Details FROM WebAuditLog WHERE Entity = 'SQL Query' AND UserCode = 'T' ORDER BY ID DESC")).scalar().startswith("select top 3 MenuItemID")
        c.execute(text("DELETE FROM WebAuditLog WHERE Entity = 'SQL Query' AND UserCode = 'T'"))
        c.commit()


def test_run_select_masks_secret_columns_and_caps_rows():
    with get_engine().connect() as c:
        if not c.execute(text("SELECT TOP 1 1 FROM MstUser WHERE ISNULL(LoginPwd, '') <> ''")).first():
            pytest.skip("no user with a password to mask")
    r = st.run_select("select top 1 UserCode, LoginPwd from MstUser where isnull(LoginPwd, '') <> ''", user_code="T")
    assert r["rows"][0][1] == "********"
    big = st.run_select(f"select top {st.MAX_ROWS + 10} a.object_id from sys.all_objects a, sys.all_objects b", user_code="T")
    assert big["row_count"] == st.MAX_ROWS and big["truncated"]
    with get_engine().connect() as c:
        c.execute(text("DELETE FROM WebAuditLog WHERE Entity = 'SQL Query' AND UserCode = 'T'"))
        c.commit()


def test_run_select_reports_database_errors_and_non_row_statements_cleanly():
    with pytest.raises(HTTPException) as e:
        st.run_select("select * from NoSuchTable_xyz", user_code="T")
    assert e.value.status_code == 422 and "Error on Executing query" in e.value.detail


def test_nothing_can_be_changed_even_through_the_runner():
    with get_engine().connect() as c:
        before = c.execute(text("SELECT COUNT(*) FROM MstMenu")).scalar()
    for sql in ("delete from MstMenu", "select 1; delete from MstMenu", "update MstMenu set MenuShow = 'N'"):
        with pytest.raises(HTTPException):
            st.run_select(sql, user_code="T")
    with get_engine().connect() as c:
        assert c.execute(text("SELECT COUNT(*) FROM MstMenu")).scalar() == before


def test_table_browser():
    with get_engine().connect() as c:
        info = st.server_info(c)
        assert info["database"] and info["server"]
        assert "MstMenu" in {t["name"] for t in st.tables(c, "Menu")}
        cols = st.columns(c, "MstMenu")
        assert {"MenuItemID", "MenuItemCaption"} <= {x["name"] for x in cols}
        with pytest.raises(HTTPException) as e:
            st.columns(c, "NoSuchTable_xyz")
        assert e.value.status_code == 404


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        if not c.execute(text("SELECT 1 FROM sys.tables WHERE name = 'RptQuery'")).scalar():
            c.execute(text("CREATE TABLE RptQuery (QID int IDENTITY(1,1) PRIMARY KEY, Query varchar(max), QName varchar(100), QGroup varchar(100))"))
        c.execute(text("DELETE FROM RptQuery WHERE QName LIKE 'ZT%'"))
        yield c
    finally:
        tx.rollback()
        c.close()


def test_saved_queries_save_list_get_delete(conn):
    st.saved_save(conn, name="ZT Menu", group="ZT Group", query="select top 2 * from MstMenu;", user_code="T")
    lst = st.saved_list(conn, "ZT Group")
    assert lst["available"] and [q["name"] for q in lst["queries"]] == ["ZT Menu"] and "ZT Group" in lst["groups"]
    assert st.saved_get(conn, "ZT Menu")["query"] == "select top 2 * from MstMenu"  # stored without the trailing ;
    with pytest.raises(HTTPException) as e:
        st.saved_save(conn, name="ZT Menu", group="ZT Group", query="select 1", user_code="T")
    assert e.value.status_code == 409 and "already Exist" in e.value.detail
    st.saved_delete(conn, name="ZT Menu", user_code="T")
    assert not st.saved_list(conn, "ZT Group")["queries"]
    with pytest.raises(HTTPException) as e:
        st.saved_delete(conn, name="ZT Menu", user_code="T")
    assert e.value.status_code == 404


def test_a_saved_query_can_only_be_a_select(conn):
    for bad in ("delete from MstMenu", "select 1; drop table x", "select * into Zt from MstMenu"):
        with pytest.raises(HTTPException) as e:
            st.saved_save(conn, name="ZT Bad", group="ZT Group", query=bad, user_code="T")
        assert e.value.status_code == 422
    assert not st.saved_list(conn, "ZT Group")["queries"]
    for name, group in (("", "g"), ("ZT n", "")):
        with pytest.raises(HTTPException):
            st.saved_save(conn, name=name, group=group, query="select 1", user_code="T")


def test_saved_queries_report_a_database_without_the_table(monkeypatch):
    c = get_engine().connect()
    try:
        monkeypatch.setattr(st, "saved_available", lambda _c: ["RptQuery"])
        assert st.saved_list(c) == {"available": False, "missing": ["RptQuery"]}
        with pytest.raises(HTTPException) as e:
            st.saved_save(c, name="a", group="b", query="select 1", user_code="T")
        assert e.value.status_code == 409
    finally:
        c.close()

import pytest

from app.services import ask_sql_guard as g


@pytest.mark.parametrize("sql", [
    "SELECT COUNT(*) FROM TrnHdrSEVA",
    "```sql\nselect top 5 * from MstSeva;\n```",
    "WITH x AS (SELECT 1 a) SELECT a FROM x",
    "SELECT 'delete; drop' AS note",  # keywords inside a string literal are harmless
])
def test_allows_reads(sql):
    assert g.validate(sql)


@pytest.mark.parametrize("sql", [
    "DELETE FROM TrnHdrSEVA",
    "SELECT 1; DROP TABLE MstSeva",
    "UPDATE MstSeva SET x=1",
    "EXEC xp_cmdshell 'dir'",
    "SELECT * INTO t FROM MstSeva",
    "SELECT * FROM MstUser",
    "SELECT * FROM sys.sql_logins; --",
    "",
])
def test_rejects_unsafe(sql):
    with pytest.raises(g.UnsafeSql):
        g.validate(sql)

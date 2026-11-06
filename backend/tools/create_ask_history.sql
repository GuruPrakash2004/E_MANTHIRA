-- Ask the Data: question history. The ONLY schema addition for this feature
-- (explicit user exception to the "never create tables" rule). Idempotent.
-- Run once on the temple DB (e.g. in SSMS). The app never creates it itself.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebAiQueryHistory')
BEGIN
    CREATE TABLE dbo.WebAiQueryHistory (
        ID           int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UserCode     nvarchar(50)   NULL,
        AskedAt      datetime       NOT NULL DEFAULT (GETDATE()),
        Lang         varchar(5)     NULL,
        Question     nvarchar(1000) NOT NULL,
        GeneratedSql nvarchar(max)  NULL,
        ChartType    varchar(20)    NULL,
        [RowCount]   int            NULL,
        AnswerText   nvarchar(max)  NULL,
        Status       varchar(10)    NOT NULL DEFAULT ('ok'),
        Rating       tinyint        NULL
    );
    CREATE INDEX IX_WebAiQueryHistory_User ON dbo.WebAiQueryHistory (UserCode, AskedAt DESC);
END

-- Split payment: one Seva / Donation receipt paid in parts by different modes (e.g. 2000 = 1200 CASH + 800 UPI).
-- A NEW table only: no existing table or column is changed, and the legacy EXE ignores it. The header of the Seva /
-- Donation keeps the main (largest) mode in its existing Payment column, so the EXE and the .rpt receipts keep working.
-- Idempotent. Run once on the temple DB; the app never creates it (the screens show "not available" until it exists).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebSplitPayment')
BEGIN
    CREATE TABLE dbo.WebSplitPayment (
        SplitID      int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DocType      varchar(10)    NOT NULL,            -- 'SEVA' (TrnHdrSEVA.SEVAID) | 'DONREC' (TrnHdrDONREC.DONRECID)
        DocID        int            NOT NULL,
        SlNo         int            NOT NULL,
        PayMode      varchar(20)    NOT NULL,            -- CASH / UPI / CARD / CHEQUE ... (the document designer's list)
        Amount       numeric(18,2)  NOT NULL,
        CashBankLedID int           NOT NULL,            -- MstLed.LEDID debited for this part (the document's "Cash or Bank Account")
        RefNo        nvarchar(60)   NULL,                -- UPI reference / cheque number
        ChqDate      datetime       NULL,
        BankName     nvarchar(60)   NULL,
        AddedBy      nvarchar(50)   NULL,
        AddedOn      datetime       NOT NULL DEFAULT (GETDATE())
    );
    CREATE INDEX IX_WebSplitPayment_Doc ON dbo.WebSplitPayment (DocType, DocID);
END

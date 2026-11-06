-- Ask the Data: menu row. Same shape as the other web-only reports (PDF Generator, Item Referencer): MenuShow='Y', empty FrmName, DocID 0.
-- Same pattern as the existing web-only rows (e.g. Expense Entry). Idempotent.
IF NOT EXISTS (SELECT 1 FROM MstMenu WHERE MenuItemCaption = 'Ask the Data')
    INSERT INTO MstMenu (MenuItemID, MenuItemCaption, MenuItemName, Menuindex, MenuItemType, DocID, CustomReport, MenuShow, FrmName, IconName, MenuGroupName, IsSepReq, WebMenuShow, WebUrlPage, PWAMenuShow)
    SELECT (SELECT MAX(MenuItemID) + 1 FROM MstMenu), 'Ask the Data', 'SVTMNU', (SELECT MAX(Menuindex) + 1 FROM MstMenu WHERE MenuItemType = 4), 4, 0, 'N', 'Y', '', '', '', 'N', 'Y', 'AskData.aspx', 'N';

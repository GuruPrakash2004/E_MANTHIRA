-- Sample data for vtemple_sample — enough to exercise every screen already
-- built (login, menu/rights, Seva Entry, Hall Booking, generic masters).
USE vtemple_sample;

INSERT INTO MstComp (CompID, CompName, Address1, Address2, MOBNO, PANNO, GSTNO, CompLoc)
VALUES (1, 'Sri Sample Temple Trust (Demo)', '#1 Temple Street', 'Sample Nagar, Bengaluru 560001', '9900000000', 'AAAAA0000A', '29AAAAA0000A1Z1', 'Bengaluru')
ON DUPLICATE KEY UPDATE CompName=CompName;

INSERT INTO MstCompFinYear (yrFdate, yrTdate, Active) VALUES
  ('2025-04-01','2026-03-31','N'),
  ('2026-04-01','2027-03-31','Y');

INSERT INTO UtlMisc (UserBased, PwdPolicy, PwdExpiryDays) VALUES ('N','N',0);

-- ---- Security: one role, one admin user (password: admin123) ----
INSERT INTO MstROLE (ROLEID, ROLECODE, ROLENAME, AddedBy, AddedOn) VALUES (1,'ADMIN','Administrator','SEED',NOW());
-- LoginPwd below is a placeholder; the backend's seed_data.py script overwrites it
-- with the real legacy-compatible 3DES ciphertext for 'admin123' after this file runs.
INSERT INTO MstUser (UserID, UserCode, LoginPwd, UserName, RoleID, AddedBy, AddedOn)
VALUES (1, 'ADMIN', 'PLACEHOLDER', 'Administrator', 1, 'SEED', NOW());

-- ---- Menu + document metadata (Seva Entry=1263, Hall Booking=1281, Sannidhi=1255 etc) ----
INSERT INTO UtlTransactions (DocID, DocType, DocName, HdrTblName, DtlTblName, DocShForm, TrnDocType, AuthReq) VALUES
 (1255,'Master','Sannidhi Master','MstSANNIDHI',NULL,'SANNIDHI','General','N'),
 (1265,'Master','Seva Master','MstSVA',NULL,'SVA','General','N'),
 (1257,'Master','Gothra Master','MstGOTHRA',NULL,'GOTHRA','General','N'),
 (1258,'Master','Nakshatra Master','MstNAKSHATRA',NULL,'NAKSHATRA','General','N'),
 (1279,'Master','Rashi Master','MstRASHI',NULL,'RASHI','General','N'),
 (1266,'Master','Event Master','MstEVENT',NULL,'EVENT','General','N'),
 (1282,'Master','Hall Master','MstHALL',NULL,'HALL','General','N'),
 (1205,'Master','Ledger Group Master','MstLedgroup',NULL,'LEDGROUP','General','N'),
 (1204,'Master','Ledger Master','MstLed',NULL,'LED','General','N'),
 (1263,'Transaction','Seva Entry','TrnHdrSEVA','TrnDtlSevaDates','SEVA','NONE','N'),
 (1261,'Transaction','Donation Reciept Entry','TrnHdrDONREC','TrnDtlDONREC','DONREC','NONE','N'),
 (1281,'Transaction','Hall Booking','TrnHdrHB',NULL,'HB','NONE','N'),
 (1224,'Voucher','Payment Voucher','TrnHdrPMTVCH','TrnDtlPMTVCH','PMTVCH','Payment','N'),
 (1248,'Voucher','Receipt Voucher','TrnHdrRCPTVCH','TrnDtlRCPTVCH','RCPTVCH','Receipt','N');

INSERT INTO MstMenu (MenuItemID, MenuItemCaption, MenuItemType, DocID, MenuShow, FrmName, MenuGroupName, Menuindex) VALUES
 (1,'Sannidhi Master',1,1255,'Y',NULL,'Seva Related',1),
 (2,'Seva Master',1,1265,'Y',NULL,'Seva Related',2),
 (3,'Gothra Master',1,1257,'Y',NULL,'Seva Related',3),
 (4,'Nakshatra Master',1,1258,'Y',NULL,'Seva Related',4),
 (5,'Rashi Master',1,1279,'Y',NULL,'Seva Related',5),
 (6,'Event Master',1,1266,'Y',NULL,'Seva Related',6),
 (7,'Hall Master',1,1282,'Y',NULL,'Seva Related',7),
 (8,'Ledger Group Master',1,1205,'Y',NULL,'Others',8),
 (9,'Ledger Master',1,1204,'Y',NULL,'Others',9),
 (10,'Seva Entry',2,1263,'Y','FRMTRNSEVA',NULL,1),
 (11,'Donation Reciept Entry',2,1261,'Y','DONREC',NULL,2),
 (12,'Hall Booking',2,1281,'Y','HBE',NULL,3),
 (13,'Payment Voucher',3,1224,'Y',NULL,NULL,1),
 (14,'Receipt Voucher',3,1248,'Y',NULL,NULL,2);

INSERT INTO MstRoleRights (RoleID, MenuItemID, RoleRights)
SELECT 1, MenuItemID, '111111111111' FROM MstMenu;

-- ---- Numbering: prefix + print format for Seva / Hall / Donation / Vouchers ----
INSERT INTO UtlDocNoPrefix (DocID, Prefix) VALUES (1263,'SLV'), (1261,'SLV'), (1224,'SLV'), (1248,'SLV');
INSERT INTO UtlDocNoPrefix (DocID, Prefix, CndOperator, CndFldCode, CndFldValue) VALUES
 (1281,'HB','=','TYPE','HALL BOOKING'), (1281,'CF','=','TYPE','CARPUS FUND');

INSERT INTO UtlDocNoFmt (DocID, F1, F2, F3, F6) VALUES
 (1263,'1','/','4','6'), (1261,'1','/','4','6'), (1281,'1','/','4','6'),
 (1224,'1','/','4','6'), (1248,'1','/','4','6');

-- ---- Print options (folder-mapped against backend/print_templates) ----
INSERT INTO UtlOption (DocID, OptionOrder, OptionName, CrptFileName, SelFormula, DefaultPrint, DirectPrinterName, AfterSaveAction) VALUES
 (1263,1,'Seva Receipt','fmtSeva_3Inc.rpt','{TrnHdrSEVA.SEVAID}=','Y','Thermal 80mm','P'),
 (1281,1,'Hall Receipt','fmtHB.rpt','{TrnHdrHB.HBID}=','Y','Office Printer','P');

-- ---- Global settings (auto-receipt on Seva save, same as legacy SLV/NMM) ----
INSERT INTO UtlGSettings (SetGroup, SetName, SetValue) VALUES ('COMPANY','AutoRcptFromSeva','Y');

-- ---- Temple masters (sample data) ----
INSERT INTO MstSANNIDHI (SANNIDHIID, SANNIDHICODE, SANNIDHINAME, AddedBy, AddedOn) VALUES
 (1,'MAIN','Main Sannidhi','SEED',NOW()),
 (2,'AMMA','Amma Sannidhi','SEED',NOW());

INSERT INTO MstGOTHRA (GOTHRAID, GOTHRACODE, GOTHRANAME, AddedBy, AddedOn) VALUES
 (1,'BHARADWAJA','Bharadwaja','SEED',NOW()), (2,'KASHYAPA','Kashyapa','SEED',NOW()), (3,'VASISHTA','Vasishta','SEED',NOW());

INSERT INTO MstRASHI (RASHIID, RASHICODE, RASHINAME, AddedBy, AddedOn) VALUES
 (1,'MESHA','Mesha','SEED',NOW()), (2,'VRISHABHA','Vrishabha','SEED',NOW()), (3,'MITHUNA','Mithuna','SEED',NOW());

INSERT INTO MstNAKSHATRA (NAKSHATRAID, NAKSHATRACODE, NAKSHATRANAME, RASHIID1, AddedBy, AddedOn) VALUES
 (1,'ASHWINI','Ashwini',1,'SEED',NOW()), (2,'BHARANI','Bharani',1,'SEED',NOW()), (3,'ROHINI','Rohini',2,'SEED',NOW());

INSERT INTO MstEVENT (EVENTID, EVENTCODE, EVENTNAME, CLRCODE, AddedBy, AddedOn) VALUES
 (1,'POORNIMA','Poornima','YELLOW','SEED',NOW()), (2,'AMAVASYA','Amavasya','GRAY','SEED',NOW());

INSERT INTO MstHALL (HALLID, HALLCODE, HALLNAME, AddedBy, AddedOn) VALUES
 (1,'MAIN HALL','Main Community Hall','SEED',NOW()),
 (2,'SMALL HALL','Small Function Hall','SEED',NOW());

INSERT INTO MstSVA (SVAID, SVACODE, SVANAME, AMT, AddedBy, AddedOn) VALUES
 (1,'ARCHANE','Archane', 50.00,'SEED',NOW()),
 (2,'ABHISHEKA','Abhisheka', 300.00,'SEED',NOW()),
 (3,'SATYANARAYANA-PUJA','Satyanarayana Puja', 1500.00,'SEED',NOW());

INSERT INTO MstSanSeva (SanID, SvaID) VALUES (1,1),(1,2),(1,3),(2,1),(2,2);

-- ---- Accounts: one ledger group + ledgers (income & cash), mirrored into MstAcLed ----
INSERT INTO MstLedgroup (LEDGROUPID, LEDGROUPCODE, LEDGROUPNAME, AddedBy, AddedOn) VALUES
 (1,'MAIN','Main Unit','SEED',NOW());

INSERT INTO MstLed (LEDID, LEDCODE, LEDNAME, LEDGROUPID, AddedBy, AddedOn) VALUES
 (1,'SEVA-INCOME','Seva Income', 1,'SEED',NOW()),
 (2,'CASH-ON-HAND','Cash on Hand', 1,'SEED',NOW()),
 (3,'HALL-INCOME','Hall Booking Income', 1,'SEED',NOW());

INSERT INTO MstAcLed (AcLedID, AcLedName, LedType, LedMstID, LedGroupId, MstDocID) VALUES
 (1,'Seva Income','L',1,1,1204),
 (2,'Cash on Hand','L',2,1,1204),
 (3,'Hall Booking Income','L',3,1,1204);

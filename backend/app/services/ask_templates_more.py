"""
Second batch of Ask-the-Data templates, from analysing what the application holds and what temple staff ask day to day:
collection by user / payment mode, expense and income by head and by branch (ledger group), hall availability on a date,
festivals (panchanga), summaries, pending / cancelled documents, and lists of masters. Same rules as ask_templates.T:
bound parameters only, {W} / {W:expr} = date filter, `v` = concept specs, `en` / `native` = natural phrasings.
Every template is executed against the live database by tests/test_ask_templates.py.
"""
from __future__ import annotations

OK = "Cancelled = 'N'"

MORE: list[dict] = [
    # ---- sevas
    dict(id="seva_largest", col="SEVADate", sql=f"SELECT TOP 5 PrintSEVANO AS seva_no, SEVADate AS seva_date, KNAME AS customer, TotalAmt AS amount FROM TrnHdrSEVA WHERE {OK} {{W}} ORDER BY TotalAmt DESC",
         v=["highest single seva", "highest seva single amount", "highest seva booking"], en=["what is the biggest seva booking", "largest single seva", "most expensive seva booked"]),
    dict(id="seva_payment_count", col="SEVADate", sql=f"SELECT PAYMENT AS payment_mode, COUNT(*) AS sevas FROM TrnHdrSEVA WHERE {OK} AND PAYMENT IS NOT NULL {{W}} GROUP BY PAYMENT ORDER BY 2 DESC",
         v=["seva paymode wise count", "seva paymode howmany"], en=["how many sevas were paid by cash and upi"]),
    dict(id="seva_sannidhi_count", col="SEVADate", sql=f"SELECT n.SANNIDHINAME AS sannidhi, COUNT(*) AS sevas FROM TrnHdrSEVA h JOIN MstSANNIDHI n ON n.SANNIDHIID = h.SANNIDHIID WHERE h.{OK} {{W}} GROUP BY n.SANNIDHINAME ORDER BY COUNT(*) DESC",
         v=["sannidhi wise seva count", "sannidhi seva howmany"], en=["how many sevas per sannidhi", "which sannidhi has the most sevas"]),
    dict(id="collection_by_user", col=None,
         sql="SELECT who AS user_name, SUM(amt) AS collected FROM (SELECT AddedBy AS who, TotalAmt AS amt FROM TrnHdrSEVA WHERE Cancelled = 'N' {W:SEVADate} "
             "UNION ALL SELECT AddedBy, TOTAMT FROM TrnHdrDONREC WHERE Cancelled = 'N' {W:DONRECDate}) x WHERE who IS NOT NULL GROUP BY who ORDER BY SUM(amt) DESC",
         v=["staff collection amount wise", "staff total collection", "staff collection"], en=["how much did each user collect", "collection by user", "who collected how much today", "counter wise collection"]),
    # ---- donations
    dict(id="donation_by_seva", col=None,
         sql="SELECT TOP 15 d.SEVANME AS seva, SUM(d.AMOUNT) AS amount FROM TrnDtlDONREC d JOIN TrnHdrDONREC h ON h.DONRECID = d.DONRECID WHERE h.Cancelled = 'N' AND d.SEVANME IS NOT NULL {W:h.DONRECDate} GROUP BY d.SEVANME ORDER BY SUM(d.AMOUNT) DESC",
         v=["donation seva types wise amount", "seva types wise donation"], en=["donations received towards each seva", "which seva got the most donation"]),
    dict(id="donation_cancelled", col="DONRECDate", sql="SELECT COUNT(*) AS cancelled_donations FROM TrnHdrDONREC WHERE Cancelled = 'Y' {W}",
         v=["cancelled donation", "cancelled donation howmany"], en=["how many donation receipts were cancelled"]),
    dict(id="donation_daily", col="DONRECDate", sql="SELECT CONVERT(char(10), DONRECDate, 120) AS day, SUM(TOTAMT) AS amount FROM TrnHdrDONREC WHERE Cancelled = 'N' {W} GROUP BY CONVERT(char(10), DONRECDate, 120) ORDER BY 1",
         v=["daywise donation", "daywise donation amount"], en=["daily donations"]),
    # ---- hall bookings
    dict(id="hall_free", col=None, default="today",
         sql="SELECT hl.HALLNAME AS hall FROM MstHALL hl WHERE hl.HALLID <> 0 AND ISNULL(hl.InActive, 'N') <> 'Y' AND hl.HALLID NOT IN "
             "(SELECT s.HALLID FROM TrnST s JOIN TrnHdrHB h ON h.HBID = s.HBID WHERE h.Cancelled = 'N' {W:s.STAYDATE}) ORDER BY hl.HALLNAME",
         v=["free hall", "free hall list"], en=["which halls are free", "is the hall available", "halls available tomorrow", "vacant halls"]),
    dict(id="hall_booked_on", col=None, default="today",
         sql="SELECT hl.HALLNAME AS hall, h.PrintHBNO AS booking_no, h.NMEOFFUNC AS function_name, h.CONPRS AS contact_person FROM TrnST s JOIN TrnHdrHB h ON h.HBID = s.HBID JOIN MstHALL hl ON hl.HALLID = s.HALLID "
             "WHERE h.Cancelled = 'N' {W:s.STAYDATE} GROUP BY hl.HALLNAME, h.PrintHBNO, h.NMEOFFUNC, h.CONPRS ORDER BY hl.HALLNAME",
         v=["hall occupancy list", "hall booking occupancy list"], en=["which halls are booked today", "what is happening in the hall tomorrow", "hall bookings on a date"]),
    dict(id="hall_functions", col="HBDate", sql="SELECT TOP 15 NMEOFFUNC AS function_name, COUNT(*) AS bookings FROM TrnHdrHB WHERE Cancelled = 'N' AND NMEOFFUNC IS NOT NULL {W} GROUP BY NMEOFFUNC ORDER BY COUNT(*) DESC",
         v=["function hall booking wise", "highest function hall booking"], en=["what kind of functions are held in the hall", "function wise bookings"]),
    dict(id="hall_top_customers", col="HBDate", sql="SELECT TOP 10 CONPRS AS contact_person, SUM(TOTAMT) AS amount FROM TrnHdrHB WHERE Cancelled = 'N' AND CONPRS IS NOT NULL {W} GROUP BY CONPRS ORDER BY SUM(TOTAMT) DESC",
         v=["top devotee hall booking", "highest devotee hall booking amount", "highest devotee hall count"], en=["who booked the hall the most", "top hall customers"]),
    dict(id="hall_by_paymode", col="HBDate", sql="SELECT PAYMNTMODE AS payment_mode, SUM(TOTAMT) AS amount FROM TrnHdrHB WHERE Cancelled = 'N' AND PAYMNTMODE IS NOT NULL {W} GROUP BY PAYMNTMODE ORDER BY 2 DESC",
         v=["hall booking paymode wise"], en=["hall booking payments by cash upi cheque"]),
    dict(id="hall_latest", col="HBDate", sql="SELECT TOP 10 PrintHBNO AS booking_no, HBDate AS booking_date, CONPRS AS contact_person, NMEOFFUNC AS function_name, TOTAMT AS amount FROM TrnHdrHB WHERE Cancelled = 'N' {W} ORDER BY HBID DESC",
         v=["latest hall booking list"], en=["show the latest hall bookings", "recent hall bookings"]),
    # ---- vouchers and accounts
    dict(id="receipt_vch_count", col="RCPTVCHDate", sql="SELECT COUNT(*) AS receipt_vouchers FROM TrnHdrRCPTVCH WHERE Cancelled = 'N' {W}",
         v=["receipt voucher howmany", "receipt voucher count"], en=["how many receipt vouchers"]),
    dict(id="payment_vch_count", col="PMTVCHDate", sql="SELECT COUNT(*) AS payment_vouchers FROM TrnHdrPMTVCH WHERE Cancelled = 'N' {W}",
         v=["payment voucher howmany", "payment voucher count"], en=["how many payment vouchers"]),
    dict(id="payment_by_mode", col="PMTVCHDate", sql="SELECT VCHTYP AS mode, SUM(TOTDR) AS amount FROM TrnHdrPMTVCH WHERE Cancelled = 'N' AND VCHTYP IS NOT NULL {W} GROUP BY VCHTYP ORDER BY 2 DESC",
         v=["payment paymode wise", "payment voucher paymode wise"], en=["cash versus bank payments", "expenses by cash and bank"]),
    dict(id="receipt_by_mode", col="RCPTVCHDate", sql="SELECT VCHTYP AS mode, SUM(TOTCR) AS amount FROM TrnHdrRCPTVCH WHERE Cancelled = 'N' AND VCHTYP IS NOT NULL {W} GROUP BY VCHTYP ORDER BY 2 DESC",
         v=["receipt paymode wise", "receipt voucher paymode wise"], en=["cash versus bank receipts", "income by cash upi bank"]),
    dict(id="expense_by_head", col=None,
         sql="SELECT TOP 10 l.LEDNAME AS ledger, SUM(d.DrAmt) AS amount FROM TrnDtlPMTVCH d JOIN TrnHdrPMTVCH h ON h.PMTVCHID = d.PMTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID "
             "WHERE h.Cancelled = 'N' AND d.DrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.PMTVCHDate} GROUP BY l.LEDNAME ORDER BY SUM(d.DrAmt) DESC",
         v=["highest payment ledger", "payment ledger wise", "highest payment"], en=["where did we spend the most", "top expense heads", "expense by category", "biggest expenses"]),
    dict(id="income_by_head", col=None,
         sql="SELECT TOP 10 l.LEDNAME AS ledger, SUM(d.CrAmt) AS amount FROM TrnDtlRCPTVCH d JOIN TrnHdrRCPTVCH h ON h.RCPTVCHID = d.RCPTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID "
             "WHERE h.Cancelled = 'N' AND d.CrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.RCPTVCHDate} GROUP BY l.LEDNAME ORDER BY SUM(d.CrAmt) DESC",
         v=["highest receipt ledger", "receipt ledger wise"], en=["top income heads", "where does our income come from", "biggest sources of income"]),
    dict(id="expense_by_branch", col=None,
         sql="SELECT g.LEDGROUPNAME AS branch, SUM(d.DrAmt) AS amount FROM TrnDtlPMTVCH d JOIN TrnHdrPMTVCH h ON h.PMTVCHID = d.PMTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID JOIN MstLedgroup g ON g.LEDGROUPID = l.LEDGROUPID "
             "WHERE h.Cancelled = 'N' AND d.DrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.PMTVCHDate} GROUP BY g.LEDGROUPNAME ORDER BY SUM(d.DrAmt) DESC",
         v=["payment branch wise", "payment branch ledger"], en=["branch wise expense", "expenses by branch"]),
    dict(id="income_by_branch", col=None,
         sql="SELECT g.LEDGROUPNAME AS branch, SUM(d.CrAmt) AS amount FROM TrnDtlRCPTVCH d JOIN TrnHdrRCPTVCH h ON h.RCPTVCHID = d.RCPTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID JOIN MstLedgroup g ON g.LEDGROUPID = l.LEDGROUPID "
             "WHERE h.Cancelled = 'N' AND d.CrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.RCPTVCHDate} GROUP BY g.LEDGROUPNAME ORDER BY SUM(d.CrAmt) DESC",
         v=["receipt branch wise", "receipt branch ledger", "collection branch wise"], en=["branch wise income", "income by branch"]),
    dict(id="payment_monthly", col="PMTVCHDate", sql="SELECT CONVERT(char(7), PMTVCHDate, 120) AS month, SUM(TOTDR) AS amount FROM TrnHdrPMTVCH WHERE Cancelled = 'N' {W} GROUP BY CONVERT(char(7), PMTVCHDate, 120) ORDER BY 1",
         v=["monthwise payment", "monthwise payment voucher"], en=["monthly expenses", "expense trend by month"]),
    dict(id="net_surplus", col=None,
         sql="SELECT ISNULL((SELECT SUM(d.CrAmt) FROM TrnDtlRCPTVCH d JOIN TrnHdrRCPTVCH h ON h.RCPTVCHID = d.RCPTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID "
             "WHERE h.Cancelled = 'N' AND d.CrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.RCPTVCHDate}), 0) "
             "- ISNULL((SELECT SUM(d.DrAmt) FROM TrnDtlPMTVCH d JOIN TrnHdrPMTVCH h ON h.PMTVCHID = d.PMTVCHID JOIN MstLed l ON l.LEDID = d.AcLedID "
             "WHERE h.Cancelled = 'N' AND d.DrAmt > 0 AND l.LEDNAME NOT LIKE '%BANK%' AND l.LEDNAME NOT LIKE '%CASH%' {W:h.PMTVCHDate}), 0) AS income_less_expense",
         v=["net", "net total", "net receipt payment"], en=["how much did we save", "income minus expense", "are we in surplus or deficit", "net balance"]),
    # ---- whole-temple views
    dict(id="daily_summary", col=None, default="today",
         sql="SELECT 'Seva' AS source, COUNT(*) AS entries, ISNULL(SUM(TotalAmt), 0) AS amount FROM TrnHdrSEVA WHERE Cancelled = 'N' {W:SEVADate} "
             "UNION ALL SELECT 'Donation', COUNT(*), ISNULL(SUM(TOTAMT), 0) FROM TrnHdrDONREC WHERE Cancelled = 'N' {W:DONRECDate} "
             "UNION ALL SELECT 'Hall booking', COUNT(*), ISNULL(SUM(TOTAMT), 0) FROM TrnHdrHB WHERE Cancelled = 'N' {W:HBDate}",
         v=["summary", "summary total collection"], en=["give me today's summary", "overview", "what happened today", "dashboard summary", "at a glance"]),
    dict(id="collection_monthly", col=None,
         sql="SELECT month, SUM(amt) AS amount FROM (SELECT CONVERT(char(7), SEVADate, 120) AS month, TotalAmt AS amt FROM TrnHdrSEVA WHERE Cancelled = 'N' {W:SEVADate} "
             "UNION ALL SELECT CONVERT(char(7), DONRECDate, 120), TOTAMT FROM TrnHdrDONREC WHERE Cancelled = 'N' {W:DONRECDate} "
             "UNION ALL SELECT CONVERT(char(7), HBDate, 120), TOTAMT FROM TrnHdrHB WHERE Cancelled = 'N' {W:HBDate}) x GROUP BY month ORDER BY month",
         v=["monthwise total collection", "monthwise collection seva donation hall"], en=["month wise total collection", "collection trend by month"]),
    dict(id="collection_by_mode", col=None,
         sql="SELECT m AS payment_mode, SUM(amt) AS amount FROM (SELECT UPPER(PAYMENT) AS m, TotalAmt AS amt FROM TrnHdrSEVA WHERE Cancelled = 'N' {W:SEVADate} "
             "UNION ALL SELECT UPPER(PAYMNTMODE), TOTAMT FROM TrnHdrDONREC WHERE Cancelled = 'N' {W:DONRECDate} "
             "UNION ALL SELECT UPPER(PAYMNTMODE), TOTAMT FROM TrnHdrHB WHERE Cancelled = 'N' {W:HBDate}) x WHERE m IS NOT NULL GROUP BY m ORDER BY SUM(amt) DESC",
         v=["total collection paymode wise", "collection paymode"], en=["cash and upi collection", "how much came by cash and how much by upi", "payment mode wise total collection"]),
    dict(id="pending_auth_all", col=None,
         sql="SELECT 'Seva' AS document, COUNT(*) AS pending FROM TrnHdrSEVA WHERE Cancelled = 'N' AND ISNULL(Authorised, 'N') <> 'Y' {W:SEVADate} "
             "UNION ALL SELECT 'Donation', COUNT(*) FROM TrnHdrDONREC WHERE Cancelled = 'N' AND ISNULL(Authorised, 'N') <> 'Y' {W:DONRECDate} "
             "UNION ALL SELECT 'Hall booking', COUNT(*) FROM TrnHdrHB WHERE Cancelled = 'N' AND ISNULL(Authorised, 'N') <> 'Y' {W:HBDate} "
             "UNION ALL SELECT 'Payment voucher', COUNT(*) FROM TrnHdrPMTVCH WHERE Cancelled = 'N' AND ISNULL(Authorised, 'N') <> 'Y' {W:PMTVCHDate} "
             "UNION ALL SELECT 'Receipt voucher', COUNT(*) FROM TrnHdrRCPTVCH WHERE Cancelled = 'N' AND ISNULL(Authorised, 'N') <> 'Y' {W:RCPTVCHDate}",
         v=["unauth", "unauth voucher", "unauth total"], en=["which documents are pending authorisation", "documents waiting for approval", "unauthorised entries"]),
    dict(id="cancelled_all", col=None,
         sql="SELECT 'Seva' AS document, COUNT(*) AS cancelled FROM TrnHdrSEVA WHERE Cancelled = 'Y' {W:SEVADate} "
             "UNION ALL SELECT 'Donation', COUNT(*) FROM TrnHdrDONREC WHERE Cancelled = 'Y' {W:DONRECDate} "
             "UNION ALL SELECT 'Hall booking', COUNT(*) FROM TrnHdrHB WHERE Cancelled = 'Y' {W:HBDate} "
             "UNION ALL SELECT 'Payment voucher', COUNT(*) FROM TrnHdrPMTVCH WHERE Cancelled = 'Y' {W:PMTVCHDate} "
             "UNION ALL SELECT 'Receipt voucher', COUNT(*) FROM TrnHdrRCPTVCH WHERE Cancelled = 'Y' {W:RCPTVCHDate}",
         v=["cancelled", "cancelled total", "cancelled voucher"], en=["which documents were cancelled", "cancelled entries summary"]),
    # ---- panchanga, events, masters
    dict(id="panchanga_list", col=None, default="upcoming",
         sql="SELECT TOP 40 CONVERT(char(10), PDate, 120) AS day, PName AS festival FROM MstPanch WHERE 1 = 1 {W:PDate} ORDER BY PDate",
         v=["festival", "festival list", "festival upcoming"], en=["what festivals are coming up", "panchanga for this month", "special days this month", "is there any festival tomorrow", "ekadashi and amavasya dates"]),
    dict(id="events_list", col=None, sql="SELECT EVENTNAME AS event FROM MstEVENT WHERE EVENTID <> 0 AND ISNULL(InActive, 'N') <> 'Y' ORDER BY EVENTNAME",
         v=["function list"], en=["list the events", "which events do we have"]),
    dict(id="sannidhi_list", col=None, sql="SELECT SANNIDHINAME AS sannidhi FROM MstSANNIDHI WHERE SANNIDHIID <> 0 AND ISNULL(InActive, 'N') <> 'Y' ORDER BY SANNIDHINAME",
         v=["sannidhi list", "sannidhi list types"], en=["list the sannidhis", "which sannidhis do we have"]),
]

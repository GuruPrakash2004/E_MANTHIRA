"""
Columns SQL Server computes itself (see sys.computed_columns, verified against
the restored vTmplSLV database — 45 columns, doc 09 finding N1).

NEVER insert or update these. `legacy/tables.py::insert_row` / `update_row`
filter them out automatically as a safety net, but code should not pass them
in the first place.
"""
COMPUTED_COLUMNS: dict[str, set[str]] = {
    "MSTCUR": {"CURCodeClean"},
    "MSTCUST": {"CustCodeClean", "CUSTDispName", "CustAddress"},
    "MSTCUSTGROUP": {"CUSTGROUPCODEClean"},
    "MSTEVENT": {"EVENTCodeClean"},
    "MSTGOTHRA": {"GOTHRACodeClean"},
    "MSTHALL": {"HALLCODEClean"},
    "MSTITEM": {"ITEMCODEClean"},
    "MSTITEMGROUP": {"ITEMGROUPCODEClean"},
    "MSTLOC": {"LOCCODEClean"},
    "MSTNAKSHATRA": {"NAKSHATRACodeClean"},
    "MSTPARTYCONTACTS": {"CDispName"},
    "MSTRASHI": {"RashiCodeClean"},
    "MSTSANNIDHI": {"SANNIDHICodeClean"},
    "MSTSTATE": {"STATECodeClean"},
    "MSTSUPP": {"SUPPCODEClean", "SUPPDispName", "SuppAddress"},
    "MSTSUPPGROUP": {"SUPPGROUPCODEClean"},
    "MSTSVA": {"SVACodeClean", "SVADISPNAME"},
    "MSTUOM": {"UOMCODEClean"},
    "TRNHDRASSET": {"ASSETDateYear", "ASSETDateMonth"},
    "TRNHDRCNTVCH": {"CNTVCHDateYear", "CNTVCHDateMonth"},
    "TRNHDRCRDNT": {"CRDNTDateYear", "CRDNTDateMonth"},
    "TRNHDRDBTNT": {"DBTNTDateYear", "DBTNTDateMonth"},
    "TRNHDRDONREC": {"DONRECDateYear", "DONRECDateMonth"},
    "TRNHDREXP": {"EXPDateYear", "EXPDateMonth"},
    "TRNHDRGRPSEVA": {"GRPSEVADateYear", "GRPSEVADateMonth", "GRPSEVADISPNAME"},
    "TRNHDRJNRVCH": {"JNRVCHDateYear", "JNRVCHDateMonth"},
    # Note: TrnHdrPMTVCH, TrnHdrHB, TrnHdrPB/PR/ISS/SA have NO computed columns
    # in this database (verified via sys.computed_columns) — deliberately absent here.
    "TRNHDRRCPTVCH": {"RCPTVCHDateYear", "RCPTVCHDateMonth"},
    "TRNHDRSEVA": {"SEVADateYear", "SEVADateMonth"},
}


def computed_columns_for(table_name: str) -> set[str]:
    return COMPUTED_COLUMNS.get(table_name.upper(), set())

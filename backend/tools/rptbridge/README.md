# RptBridge - the only print engine

A small x86 .NET Framework exe that opens the **original Crystal `.rpt`** files with the SAP Crystal Reports runtime. The
backend never opens or draws a report itself, and nothing redraws one: there is no HTML template or mock renderer. If the
bridge is not running, printing says so.

Build: `build.cmd` (needs the Crystal runtime in the GAC). The backend starts it on `127.0.0.1` with a key (see
`app/print/rpt_bridge_manager.py`); `RPT_BRIDGE_URL` / `RPT_BRIDGE_KEY` point it at an external one instead.

## Contract (every request carries `X-Rpt-Bridge-Key`)

`POST /render` -> `application/pdf`
```json
{ "rpt_path": "C:/.../Rpts/fmtSeva_3Inc.rpt", "selection_formula": "{TrnHdrSEVA.SEVAID}= 24488",
  "formula_values": { "compname": "...", "add1": "..." }, "record_id": "24488" }
```
`formula_values` holds exactly the pairs of the print option (`UtlOption.FormulasFld` / `FormulasVal`) - nothing is added, and
the report is never edited. A declared parameter that nobody supplied gets `""` / `0` (a headless export cannot prompt).

Response headers describe the report's own paper: `X-Paper-Kind` (`Named` = A4 / Letter ..., `Custom` = roll size),
`X-Paper-Name`, `X-Orientation`, `X-Margin-Bottom-Pt`. The backend uses them to cut a roll page at the end of the receipt
(`app/print/page_fit.py`); named paper sizes are never touched.

`POST /print` -> `{"message":"sent"}` - same body plus `printer_name`, `copies`; `PrintToPrinter` on that printer.
`GET /health`, `GET /inspect?rpt=<file>` (parameters, formulas, tables, sub-reports, texts, paper).

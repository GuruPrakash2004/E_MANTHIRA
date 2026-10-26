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

## Fonts (Kannada / Telugu / Tamil / Hindi reports)

Old reports draw regional-language text in non-Unicode fonts such as **BRH Kannada** or Nudi. On a machine without that font Windows
swaps in Times New Roman and the output is Latin gibberish. At start-up the bridge installs every `.ttf` / `.otf` / `.ttc` found in
`<RPT folder>\Fonts` (also `--fonts a;b` and `<exe folder>\fonts`) **for the current Windows user** (copy to
`%LOCALAPPDATA%\Microsoft\Windows\Fonts` + HKCU registry; no admin rights, nothing system-wide; if that is blocked it loads the font
privately into the process). `GET /fonts?rpt=<file>` lists the fonts a report uses and which are missing; the print dialog shows that
as a warning, and ADMIN can add the font file from Admin Master > Print Options (`POST /print-options/font-files`, which restarts the bridge).

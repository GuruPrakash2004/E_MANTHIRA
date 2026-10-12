# Crystal Reports print service — contract & mock bridge

The main backend (`app/print/crystal_client.py`) **never renders a `.rpt` file
itself** — `.rpt` files are encrypted Crystal Reports binaries that cannot be
parsed outside the Crystal runtime (verified: OLE container with compressed/
encrypted streams, see `vTemple_Analysis/09_Second_Pass_Analysis_Addendum.md`
finding N10). Instead it always calls out to **this** service over HTTP.

There are two implementations of the contract:

1. **The real thing (production)** — a small Windows service, running on a
   machine that has the genuine SAP Crystal Reports runtime and the
   temple's printer drivers installed (can be the same Windows box that used
   to run `vTemple7.exe`, or a dedicated print server on the LAN). It opens
   the actual `.rpt` file from the shared `Rpts` folder, sets the selection
   formula and formula fields exactly like `frmUtlReportViewer.
   ShowRptFileFromUtlOptions` used to, and either streams back a PDF or
   sends the job straight to a named printer. **This is not included here**
   — it must be built with .NET + the Crystal Reports SDK (Softvent/the
   client already has the runtime licence from the old app) and pointed at
   by `CRYSTAL_SERVICE_URL`.

2. **`mock_bridge.py` (this folder, dev only)** — a tiny FastAPI app that
   implements the SAME two endpoints below using WeasyPrint + the Jinja
   templates in `print_templates/`, so the whole print pipeline (registry →
   client → preview/print) can be built, tested and demoed without a
   Windows/Crystal environment. It reads the `.rpt` filename only to log it
   — it does **not** attempt to parse the binary — and renders the matching
   `.html.j2` template instead. Swap `CRYSTAL_SERVICE_URL` to the real
   service when one is available; nothing else in the app changes.

## Contract

### `POST /render` → returns `application/pdf`
```json
{
  "rpt_path": "/abs/path/to/fmtSeva_3Inc.rpt",
  "selection_formula": "{TrnHdrSEVA.SEVAID}=24488",
  "formula_values": {"compname": "...", "add1": "...", "gstno": "...", ...},
  "record_id": "24488",
  "format": "pdf"
}
```

### `POST /print` → 200 OK (no body) once the job is queued/sent
```json
{
  "rpt_path": "...",
  "selection_formula": "...",
  "formula_values": {...},
  "record_id": "24488",
  "printer_name": "RP 3220 star",
  "copies": 1
}
```
On the real service this calls the Crystal `PrintToPrinter(printerName)` API
(the legacy `frmUtlReportViewer` behaviour for `UtlOption.DirectPrinterName`
+ `ClickOperation='P'`). The mock bridge instead just renders the PDF and
discards it (there is no cross-platform way to talk to a Windows printer
driver from here) — use `/render` + the browser's print dialog for local
testing, or wire up a local print agent (e.g. QZ Tray) in the frontend.

## Running the mock bridge

```bash
cd backend/print_service
pip install -r requirements.txt
uvicorn mock_bridge:app --port 8100
```

Then set `CRYSTAL_SERVICE_URL=http://localhost:8100` in `backend/.env`.

## Status (as of this build)

The full pipeline was run end-to-end against the real database and verified
working: `GET /print/{doc}/options` correctly lists `UtlOption` rows scanned
against real `.rpt` files in the legacy `Rpts` folder, and `GET /print/{doc}/
{option}/{id}/preview` returns a real PDF rendered from `fmtSeva_3Inc.html.j2`
with the real `MstComp` company header (name, address, phone) and correct
Kannada glyphs (ಸೇವಾ ರಶೀದಿ). Two follow-ups noted for whoever wires up the
templates properly against real printouts:

1. **Page size** — `@page { size: 80mm auto }` is rendering as full A4 in
   this WeasyPrint version; needs a fixed-height-then-trim approach or a
   WeasyPrint option to correctly honour `auto` height for thermal-width
   pages. Not a blocker for the real Crystal service (which owns the exact
   layout), only for the mock bridge / any future all-HTML print path.
2. **Per-record data** — the mock bridge only has the company header fields
   in context (see contract above), so Name/Gotra/Nakshatra/Seva/Amount show
   as placeholders in its output. The real Crystal service queries the
   document itself (exactly like the legacy `.rpt` files do), so this is
   only a mock-bridge limitation, not a pipeline gap — confirmed by tracing
   `UtlOption.SelFormula` through to the Crystal `render` call.

## Template checklist (map every UtlOption.CrptFileName to a template)

See `vTemple_Analysis/07_Implementation_Plan.md` §7 for the full list. Status:

| .rpt | Template | Status |
|---|---|---|
| fmtSeva_3Inc.rpt | fmtSeva_3Inc.html.j2 | ✅ built (from the sample receipt image) |
| fmtSeva_A4.rpt | fmtSeva_A4.html.j2 | ⬜ TODO — needs a real printout to match exactly |
| fmtDon.rpt | fmtDon.html.j2 | ⬜ TODO |
| fmtHB.rpt | fmtHB.html.j2 | ✅ built (from the sample receipt image) |
| fmtHB_3Inc.rpt / fmtHall_3Inc.rpt | fmtHB_3Inc.html.j2 | ⬜ TODO |
| fmtVCH.rpt (+ unit variants) | fmtVCH.html.j2 | ⬜ TODO |
| fmtGrpSeva_A4 .rpt | — | not in Phase-1 scope |
| RptDtlCompDaySmry/Dtl, RptDtlColn, RptDtlPayment, SevaIssue, RptKnk | — | report templates, later phase |

**Action needed from the client**: real printouts or exported PDFs of each
`.rpt` (via Crystal Reports Designer → File → Export → PDF, on any PC that
still has the old app installed) so each template can be checked pixel-for-
pixel against the original, per doc 07 §7.

# vTemple Print Agent

Lets a counter PC print receipts on **its own** printers (USB or network), silently — no browser print dialog.
A browser page can't list a PC's printers or print to them without a dialog; this tiny Windows program closes
that gap. One instance per Windows user, started at sign-in.

```
 Counter PC (Windows)                                              vTemple server
┌──────────────────────────────────────────┐                     ┌───────────────────────────┐
│ Browser — vTemple web app                 │                     │  FastAPI backend          │
│    1. GET  http://127.0.0.1:8787/health   │                     │  renders the document      │
│    3. POST http://127.0.0.1:8787/print    │ ◀── 2. page pictures ┤  GET /print/.../pages      │
│    ▼                                      │                     └───────────────────────────┘
│ VTemplePrintAgent.exe                     │
│    prints on a printer of THIS PC         │
└──────────────────────────────────────────┘
```

* **The server draws the document** — same Crystal Reports pipeline as `/print/.../preview`
  (`app/print/crystal_client.py`), rasterised to PNG pages by `app/print/print_agent.py::pdf_to_pages`.
* **The agent prints pictures** on whatever printer Windows has on that PC. It never touches vTemple's data.
* **The browser is the bridge**, because only the browser on the counter PC can reach `127.0.0.1` of that PC.

## Files

| File | Purpose |
|---|---|
| `Program.cs` | The agent itself (~450 lines, C#, .NET Framework 4, no external dependencies) |
| `build.cmd` | Builds `bin/VTemplePrintAgent.exe` with `csc.exe` (ships with Windows — no SDK, no admin rights) |
| `install.cmd` | Manual install for dev/testing (the real path is the downloaded Setup `.cmd`, see below) |
| `uninstall.cmd` | Removes the agent, its Run-key entry and its data folder |

## Protocol

| Call | Body | Answer |
|---|---|---|
| `GET /health` | none | `{"agent":"vtemple-print-agent","version":"1.0","host":"PC-NAME","default":"POS-80","printers":["POS-80", ...]}` |
| `POST /print` | `{"printer":"POS-80","copies":1,"name":"26SLV00549","pages":[{"png":"<base64>","w":226.8,"h":600.0}, ...]}` | `{"printed":true,"printer":"POS-80","copies":1}` |
| `OPTIONS *` | none | `204` with CORS headers |

* `printer` blank -> the PC's Windows default. `w`/`h` are the page size in **points** (1/72 inch); the agent sets
  the printer's paper to exactly that, zero margins.
* Errors are JSON `{"error": "..."}` — `403` page not allowed, `409` no default printer, `413` too large (64 MB),
  `422` no pages, `500` Windows refused.
* Listens on **`127.0.0.1:8787` only** — nothing outside the PC can connect. Mutex `Local\VTemplePrintAgent` so
  only one instance runs per Windows user; one print job at a time (receipts never interleave).

## Security

* **Loopback only.**
* **Origin allow-list** — `printagent.txt` next to the exe (`%LOCALAPPDATA%\VTemplePrintAgent\printagent.txt`),
  one allowed web address per line (`*` allows any page; **no file = nothing is allowed**). The browser's `Origin`
  header is checked on every `/print` call; anything else gets `403`.
* **CORS / Chrome "local network" rule** — replies carry `Access-Control-Allow-Private-Network: true`; Chrome may
  ask once to *allow access to devices on the local network* — allow it.
* Limits: 64 MB per job, 20 copies, 20s socket timeouts.

## The one-click install

The frontend's *Download Print Agent for this PC* button (`LocalPrinterSetting.jsx` / the Print dialog's "This PC"
panel) calls `GET /api/v1/print/agent?origin=<window.location.origin>` and gets back
`vTemple-Print-Agent-Setup.cmd` — a self-installing file (see `app/print/print_agent.py::agent_install_script`):
the exe is base64-packed into `::B64 ` lines at the bottom of the script; double-clicking it unpacks the exe,
writes the origin into `printagent.txt`, registers `HKCU\...\Run`, and starts the agent. No admin rights, no
separate installer. If the app is opened from a different address later, running the Setup file again from
that address just adds another line to `printagent.txt`.

## Limits

* Windows counter PCs only (`System.Drawing.Printing`).
* Prints **pictures**, not text/ESC-POS — cash-drawer kicks and paper-cut settings come from the printer driver.
* Firefox/Safari may block a page from calling `127.0.0.1`; tested with Chrome/Edge.
* An unsigned exe may trigger SmartScreen/antivirus on a customer rollout — sign it for production.
* Logs: `%LOCALAPPDATA%\VTemplePrintAgent\printagent.log` (trimmed at 512 KB).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/health` doesn't open | agent isn't running — run `%LOCALAPPDATA%\VTemplePrintAgent\VTemplePrintAgent.exe` |
| Print Settings shows no printers | the address in `printagent.txt` doesn't match the browser's exactly — re-run Setup from that address |
| 403 "This page is not allowed..." | add the page's address to `printagent.txt`, restart the agent |
| "This PC has no printer called ..." | printer was removed/renamed; choose another in Print Settings |
| receipt cut off / wrong size | set the printer's paper to the roll width in Windows printer properties |

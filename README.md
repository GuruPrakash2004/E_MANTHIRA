# vTemple Web — Vite + React frontend, FastAPI backend

Web rebuild of the legacy `vTemple7.exe` (Windows/VB.NET) temple management
software, running against the **same SQL Server database** so the old app
and this one can operate side by side during rollout. See `/CLAUDE.md` at
the repo root for the full rules/contract, and `vTemple_Analysis/` for the
detailed specs this was built from (especially `07_Implementation_Plan.md`).

## What's built vs scaffolded (be honest with yourself before demoing)

**Built and verified against the real restored database** (see `backend/tests/`
and the manual verification transcript in the project chat history):
- Legacy 3DES password crypto — round-trips real `MstUser.LoginPwd` values
- Amount-in-words — matches 214/215 distinct real (amount, words) pairs in the DB
  (the 1 outlier is a pre-existing data bug in the legacy DB itself)
- Login, JWT auth, financial-year resolution, menu + 12-bit rights
- **Seva Entry**: create → writes `TrnHdrSEVA` + `TrnDtlSevaDates` + auto
  Receipt Voucher (`TrnHdrRCPTVCH`/`TrnDtlRCPTVCH`) + balanced GL posting
  (`TrnHdrAcc`/`TrnDtlAcc`), exactly matching the legacy write-set
- **Seva cancel** — now correctly voids the receipt and posts a reversing GL
  entry (fixes D-06; legacy just flips `Cancelled='Y'` and leaves income
  overstated — verified against real data)
- **Hall Booking**: create with a **fixed** overlap check (fixes D-04 — the
  legacy check only catches a new booking fully contained inside an existing
  one; verified the exact case it misses is now correctly rejected here),
  ADV/Partial/Final payments, cancel-with-reversal
- Generic master CRUD (Sannidhi/Seva/Gothra/Nakshatra/Rashi/Hall/Event/Ledger
  Group/Ledger, incl. the Ledger↔`MstAcLed` sync and delete guard)
- **Printing**: folder-mapped `UtlOption` → `.rpt` registry, Crystal-service-
  only architecture (per your instruction), a working dev mock bridge, and a
  real end-to-end PDF render proven against the live company data — see
  `backend/print_service/README.md` for exact status and the 2 known
  follow-ups (page sizing, per-record data needs the real Crystal service)

**Scaffolded (routes/services exist and follow the same patterns above, but
not yet exercised against real data the way Seva/Hall were)**: Donation
Receipt, Payment/Receipt Voucher screens, Panchanga, reports, settings,
users/roles UI, most of the frontend polish (search/nav, print dialog,
seva-dates picker UI, hall availability calendar UI). Follow the exact same
service → router → page pattern already in place for Seva/Hall.

## ⚠️ If your working copy is on a network share (SMB/AFP)

This project folder was found mounted over SMB (`//…/ClientData`). `npm install`
there took **hours** (thousands of small-file writes over the network) before
we worked around it; a build on local disk took **6 seconds**. If you hit the
same thing: `npm install` in a local directory and either work from there, or
symlink `node_modules` back (`ln -s /local/path/node_modules frontend/node_modules`).
Not a project issue — just how SMB handles huge directory trees.

## Prerequisites
- Docker running a restored copy of the client's SQL Server backup (see the
  root `vTemple_Analysis/README.md` for the restore command) — this build
  used `vtemple-sql` on port 14333.
- Python 3.12 (3.13/3.14 currently break some native wheels — see
  `backend/requirements.txt` notes), Node 18+.
- `freetds` + `unixodbc` on macOS for `pymssql`: `brew install freetds`.

## Run it

```bash
# 1. Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DB_PASSWORD etc — see comments in the file
uvicorn app.main:app --reload --port 8010   # http://localhost:8010/docs

# 2. Print service (dev mock — see print_service/README.md for the real thing)
cd backend/print_service
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn mock_bridge:app --port 8100

# 3. Frontend
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:8010/api/v1
npm run dev             # http://localhost:5173
```

Login with a real user from `MstUser` (e.g. `ADMIN`) and its real password —
this app decrypts the legacy password column, it does not use fixtures.

## Tests
```bash
cd backend && pytest -q
```
(Golden tests for amount-in-words and the crypto round-trip are the most
valuable ones to run first — they were what caught the real bugs during
this build; add more parity tests per doc 07 §9 as each screen is finished.)

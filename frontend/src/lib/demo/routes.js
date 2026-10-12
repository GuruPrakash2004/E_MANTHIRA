// Demo-mode request router: maps "METHOD /path" to a handler over the in-memory demo database (db.js).
// Handlers return the same JSON shapes the real FastAPI endpoints return; validation errors are thrown with
// the same `detail` message style the screens already display. Anything not listed here answers 404 with a
// clear "not available in demo mode" message instead of silently doing nothing.
import dayjs from 'dayjs'
import { getDb } from './db'
import { DEMO_BULK_DEFS, BULK_TABLE_DOC, DEMO_CUSTOM_DEFS, DEMO_CUSTOM_REPORTS, DEMO_DB_SETTINGS, DEMO_REPORT_CATALOG, DOC_NAMES, DEMO_PRINT_OPTIONS_BY_DOC } from './seedSystem'
import { FY_PREFIX, clone, iso, pad, stamp } from './util'

export class DemoError extends Error {
  constructor(status, detail) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}
const fail = (status, detail) => {
  throw new DemoError(status, detail)
}

export const DEMO_USER = { user_id: 1, user_code: 'ADMIN', user_name: 'Demo Admin', role_id: 1 }
export const DEMO_LOGIN_RESPONSE = { access_token: 'demo-mode-token', refresh_token: 'demo-mode-refresh', user_code: 'ADMIN', user_name: 'Demo Admin', role_id: 1, financial_year_id: 1 }

// ---------------------------------------------------------------- helpers
const num = (v) => Number(v) || 0
const top = (list, q) => (q?.top ? list.slice(0, Number(q.top)) : list)
const master = (db, doc) => db.masters[doc]
const rowName = (db, doc, id) => {
  const m = master(db, doc)
  return m?.rows.find((r) => r[m.meta.id_col] === Number(id))?.[m.meta.name_col] || ''
}
const inRange = (d, q) => (!q.from_date || d >= q.from_date) && (!q.to_date || d <= q.to_date)
const audit = (db, user, action, entity, id, details) => {
  const label = { A: 'Added', M: 'Modified', D: 'Deleted', C: 'Cancelled' }[action]
  db.audit.unshift({ id: db.nextId.audit++, at: stamp(0, new Date().getHours(), new Date().getMinutes()), user_code: user, action, action_label: label, entity, entity_id: String(id), details: details || `${label} ${entity} #${id}`, deleted: action === 'D' })
}
const ledgerRows = (db, ids) => master(db, 1204).rows.filter((r) => r.LEDID > 0 && (!ids || ids.includes(r.LEDID)))

// lookup field -> master doc (UtlDocDsgrFlds.FldCmbTblName equivalents)
const LOOKUP_DOC = { SANNIDHIID: 1255, SVAID: 1265, GOTHRAID: 1257, NAKSHATRAID: 1258, SECNAKSHATRAID: 1258, RASHIID: 1279, SECRASHIID: 1279, RASHIID1: 1279, HALLID: 1282, BANK: 1223, LEDGER: 1204, LEDID: 1204, LEDIDPUR: 1204 }

function lookup(db, field, search) {
  const q = (search || '').toLowerCase()
  if (field === 'HBID') return db.hall.filter((h) => h.Cancelled !== 'Y').map((h) => ({ value: h.HBID, label: `${h.PrintHBNO} · ${h.NMEOFFUNC}` })).filter((o) => o.label.toLowerCase().includes(q))
  const doc = LOOKUP_DOC[field]
  if (!doc) return []
  const m = master(db, doc)
  let rows = m.rows.filter((r) => r[m.meta.id_col] > 0 && r.InActive !== 'Y')
  if (field === 'LEDID') rows = rows.filter((r) => [1, 2].includes(r.LEDGRPID)) // cash / bank accounts only
  if (field === 'LEDGER') rows = rows.filter((r) => [3, 4].includes(r.LEDGRPID)) // income ledgers
  return rows.map((r) => ({ value: r[m.meta.id_col], label: r[m.meta.name_col] })).filter((o) => o.label.toLowerCase().includes(q))
}

// ---------------------------------------------------------------- masters CRUD
function masterList(db, doc, q) {
  const m = master(db, doc) || fail(404, 'Unknown document')
  const s = (q.search || '').toLowerCase()
  let rows = m.rows
  if (s) rows = rows.filter((r) => String(r[m.meta.code_col]).toLowerCase().includes(s) || String(r[m.meta.name_col]).toLowerCase().includes(s))
  return { meta: m.meta, rows: top(rows, q) }
}
function masterCreate(db, doc, v, user) {
  const m = master(db, doc) || fail(404, 'Unknown document')
  const { meta } = m
  const sf = meta.short_form
  const code = String(v[meta.code_col] || '').trim()
  const name = String(v[meta.name_col] || '').trim()
  if (!code) fail(422, `${sf} Code should not be blank!`)
  if (!name) fail(422, `${sf} Name should not be blank!`)
  if (m.rows.some((r) => String(r[meta.code_col]).toLowerCase() === code.toLowerCase())) fail(409, `${meta.caption} already exists..`)
  if ((v.InActive || 'N') === 'Y' && !String(v.InActiveRmks || '').trim()) fail(422, 'Remarks are required when a record is made inactive')
  const id = Math.max(...m.rows.map((r) => r[meta.id_col])) + 1
  const row = { ...v, [meta.id_col]: id, AddedBy: user, AddedOn: stamp(0, 12, 0), InActive: v.InActive || 'N' }
  m.rows.push(row)
  audit(db, user, 'A', meta.caption, id)
  return row
}
function masterUpdate(db, doc, id, v, user) {
  const m = master(db, doc) || fail(404, 'Unknown document')
  const row = m.rows.find((r) => r[m.meta.id_col] === Number(id)) || fail(404, `${m.meta.caption} not found`)
  const code = v[m.meta.code_col]
  if (code && m.rows.some((r) => r !== row && String(r[m.meta.code_col]).toLowerCase() === String(code).toLowerCase())) fail(409, `${m.meta.caption} already exists..`)
  Object.assign(row, v, { ModifiedBy: user, ModifiedOn: stamp(0, 12, 0) })
  audit(db, user, 'M', m.meta.caption, id)
  return row
}
function masterDelete(db, doc, id, user) {
  const m = master(db, doc) || fail(404, 'Unknown document')
  if (Number(id) === 0) fail(409, 'The placeholder record cannot be deleted')
  const i = m.rows.findIndex((r) => r[m.meta.id_col] === Number(id))
  if (i < 0) fail(404, `${m.meta.caption} not found`)
  m.rows.splice(i, 1)
  audit(db, user, 'D', m.meta.caption, id)
}

// ---------------------------------------------------------------- transactions
function createSeva(db, b, user) {
  if (!b.sannidhi_id || !b.seva_id) fail(422, 'Sannidhi and Seva are mandatory')
  if (!b.name || !String(b.name).trim()) fail(422, 'Devotee name should not be blank!')
  if (!b.dates?.length) fail(422, 'Add at least one Seva date')
  const id = db.nextId.seva++
  const no = db.sevas.length + 1
  const rec = {
    SEVAID: id, SEVANO: no, PrintSEVANO: `${b.prefix || FY_PREFIX}${pad(500 + no)}`, SEVADate: b.doc_date || iso(0), KNAME: b.name, NAMEINKAN: b.name_kn || '', MOBNUM: b.mobile || '', SECKNAME: b.name2 || '',
    SANNIDHIID: b.sannidhi_id, SVAID: b.seva_id, GOTHRAID: b.gothra_id || 0, NAKSHATRAID: b.nakshatra_id || 0, RASHIID: b.rashi_id || 0, SECNAKSHATRAID: b.nakshatra2_id || 0, SECRASHIID: b.rashi2_id || 0,
    Rate: num(b.rate), PAYMNTMODE: b.payment_mode || 'Cash', TotalAmt: num(b.rate) * b.dates.length, Cancelled: 'N', dates: b.dates, ReceiptNo: `${FY_PREFIX}${pad(1200 + no)}`, AddedBy: user, AddedOn: stamp(0, new Date().getHours(), new Date().getMinutes()),
  }
  db.sevas.unshift(rec)
  audit(db, user, 'A', 'Seva', rec.PrintSEVANO)
  return { seva_id: id, seva_no: rec.PrintSEVANO, receipt_no: rec.ReceiptNo, total_amt: rec.TotalAmt }
}
function createDonation(db, b, user) {
  if (!b.donor || !String(b.donor).trim()) fail(422, 'Donor name should not be blank!')
  if (!num(b.amount)) fail(422, 'Amount should be greater than zero')
  const id = db.nextId.donation++
  const no = db.donations.length + 1
  const rec = { DONRECID: id, DONRECNO: no, PrintDONRECNO: `${b.prefix || FY_PREFIX}${pad(700 + no)}`, DONRECDate: b.doc_date || iso(0), DONOR: b.donor, CONTACTNO: b.contact_no || '', ADDRESS: b.address || '', PANNO: b.pan_no || '', TOTAMT: num(b.amount), PAYMNTMODE: b.payment_mode || 'Cash', Cancelled: 'N', ReceiptNo: `${FY_PREFIX}${pad(1300 + no)}`, AddedBy: user, lines: b.lines || [] }
  db.donations.unshift(rec)
  audit(db, user, 'A', 'Donation', rec.PrintDONRECNO)
  return { donrec_id: id, donrec_no: rec.PrintDONRECNO, receipt_no: rec.ReceiptNo }
}
function createHall(db, b, user) {
  if (!b.hall_id) fail(422, 'Name of the Hall / Room is mandatory')
  const id = db.nextId.hall++
  const no = db.hall.length + 1
  const amount = num(b.amount)
  const gst = (amount * (num(b.cgst_pct) + num(b.sgst_pct))) / 100
  const net = amount + gst
  const rec = {
    HBID: id, HBNO: no, PrintHBNO: `${FY_PREFIX}HB${pad(no, 4)}`, HBDate: iso(0), TYPE: b.booking_type || 'HALL BOOKING', NMEOFFUNC: b.function_name || '', CONPRS: b.contact_person || '', CONTACTNO: b.contact_no || '', MOBNO: b.mobile || '',
    HALLID: b.hall_id, HALLNAME: rowName(db, 1282, b.hall_id), HBSTARTDT: (b.start_at || iso(0)).slice(0, 10), HBENDDT: (b.end_at || b.start_at || iso(0)).slice(0, 10), AMOUNT: amount, CGST: (amount * num(b.cgst_pct)) / 100, SGST: (amount * num(b.sgst_pct)) / 100,
    NETPAY: net, ADV: 0, BALAMT: net, SDEPAMT: num(b.deposit), Cancelled: 'N', receipts: [], RCPTVCHNO: '', RCPTTYPE: '', TOTCR: 0, printdonrecno: '',
  }
  db.hall.unshift(rec)
  audit(db, user, 'A', 'Hall Booking', rec.PrintHBNO)
  return { hb_id: id, hb_no: rec.PrintHBNO, net_pay: net }
}
function hallPayment(db, id, b, user) {
  const h = db.hall.find((x) => x.HBID === Number(id)) || fail(404, 'Booking not found')
  const amt = num(b.amount)
  if (amt <= 0) fail(422, 'Amount should be greater than zero')
  if (amt > h.BALAMT + 0.005) fail(422, 'Payment is more than the balance due')
  const rid = db.nextId.rcptHall++
  const rcpt = { RCPTVCHID: rid, PrintRCPTVCHNO: `${FY_PREFIX}RV${pad(rid - 4000, 4)}`, RCPTVCHDate: iso(0), RCPTTYPE: b.receipt_type || 'Partial', TOTCR: amt, Cancelled: 'N' }
  h.receipts.push(rcpt)
  h.ADV += amt
  h.BALAMT = Math.round((h.BALAMT - amt) * 100) / 100
  h.TOTCR = h.ADV
  audit(db, user, 'A', 'Receipt Voucher', rcpt.PrintRCPTVCHNO)
  return { receipt_no: rcpt.PrintRCPTVCHNO, receipt_id: rid, balance: h.BALAMT }
}
function createHbe(db, b, user) {
  if (!b.contact_no) fail(422, 'Contact Number is mandatory')
  const id = db.nextId.hbe++
  const no = db.hbe.length + 1
  const net = (b.lines || []).reduce((s, l) => s + num(l.amount), 0) + num(b.cgst) + num(b.sgst) - num(b.security_deposit_amt) - num(b.advance_amt)
  const rec = { HBEID: id, HBENO: no, PrintHBENO: `${FY_PREFIX}${b.type === 'CARPUS FUND' ? 'CF' : 'HB'}${pad(no, 4)}`, HBEDate: iso(0), TYPE: b.type, NMEOFFUNC: b.name_of_func || '', NETPAY: net, CONTACTNO: b.contact_no, CONPRS: b.contact_person || '' }
  db.hbe.unshift(rec)
  audit(db, user, 'A', 'Hall Booking Entry', rec.PrintHBENO)
  return { hbe_id: id, hbe_no: rec.PrintHBENO }
}
function createVoucher(db, kind, b, user) {
  const list = kind === 'pay' ? db.payVch : db.rcptVch
  const lines = b.lines || []
  const dr = lines.reduce((s, l) => s + num(l.dr_amt), 0)
  const cr = lines.reduce((s, l) => s + num(l.cr_amt), 0)
  if (!String(b.narration || '').trim()) fail(422, 'Narration should not be blank!')
  if (Math.round(dr * 100) !== Math.round(cr * 100) || !dr) fail(422, 'Debit and Credit totals are NOT matching!')
  const id = kind === 'pay' ? db.nextId.pay++ : db.nextId.rcpt++
  const no = list.length + 1
  const pfx = kind === 'pay' ? 'PV' : 'RV'
  const printNo = `${b.prefix || FY_PREFIX}${pfx}${pad(no, 4)}`
  const date = (kind === 'pay' ? b.voucher_date : b.receipt_date) || iso(0)
  list.unshift({ [kind === 'pay' ? 'PMTVCHID' : 'RCPTVCHID']: id, [kind === 'pay' ? 'PMTVCHNO' : 'RCPTVCHNO']: no, [kind === 'pay' ? 'PrintPMTVCHNO' : 'PrintRCPTVCHNO']: printNo, VCHDate: date, VCHTYP: b.vch_type, NARR: b.narration, TOTDR: dr, TOTCR: cr, Cancelled: 'N', lines })
  audit(db, user, 'A', kind === 'pay' ? 'Payment Voucher' : 'Receipt Voucher', printNo)
  return kind === 'pay' ? { pmtvch_id: id, pmtvch_no: printNo } : { receipt_id: id, receipt_no: printNo }
}
function createInv(db, key, idKey, noKey, printKey, prefix, b, extra, user) {
  const list = db[key]
  const id = db.nextId[idKey]++
  const no = list.length + 1
  const printNo = `${FY_PREFIX}${prefix}${pad(no, 3)}`
  const rec = { ...extra, [`${noKey}`]: no, [printKey]: printNo }
  list.unshift(rec)
  audit(db, user, 'A', prefix, printNo)
  return { id, no: printNo }
}

// ---------------------------------------------------------------- reports
function sevaEntries(db, q) {
  return db.sevas.filter((s) => s.Cancelled !== 'Y' && inRange(s.SEVADate, q) && (!q.sannidhi_ids?.length || q.sannidhi_ids.includes(s.SANNIDHIID)) && (!q.seva_ids?.length || q.seva_ids.includes(s.SVAID)))
}
function collectionReport(db, q) {
  const list = sevaEntries(db, q)
  const rows = list.map((s) => ({ SEVANO: s.PrintSEVANO, SEVADate: s.SEVADate, Name1: s.KNAME, Sannadhi: rowName(db, 1255, s.SANNIDHIID), Seva: rowName(db, 1265, s.SVAID), Payment: s.PAYMNTMODE, Totalamt: s.TotalAmt, AddedBy: s.AddedBy }))
  const group = (keyFn, label) => {
    const m = new Map()
    rows.forEach((r) => {
      const k = keyFn(r)
      const g = m.get(k.join('|')) || { ...label(k), count: 0, amount: 0 }
      g.count += 1
      g.amount += r.Totalamt
      m.set(k.join('|'), g)
    })
    return [...m.values()]
  }
  return {
    total_count: rows.length, total_amount: rows.reduce((s, r) => s + r.Totalamt, 0), rows,
    summary_by_sannidhi_seva: group((r) => [r.Sannadhi, r.Seva], ([sannidhi, seva]) => ({ sannidhi, seva })),
    summary_by_payment_mode: group((r) => [r.Payment], ([payment_mode]) => ({ payment_mode })),
  }
}
function generalLedger(db, b) {
  const entries = []
  const cashOrBank = (mode) => (mode === 'Cash' ? 1 : 2)
  db.sevas.filter((s) => s.Cancelled !== 'Y').forEach((s) => {
    entries.push({ led: cashOrBank(s.PAYMNTMODE), date: s.SEVADate, doc_type: 'Seva', trn_no: s.PrintSEVANO, narration: rowName(db, 1265, s.SVAID), dr: s.TotalAmt, cr: 0 })
    entries.push({ led: 4, date: s.SEVADate, doc_type: 'Seva', trn_no: s.PrintSEVANO, narration: s.KNAME, dr: 0, cr: s.TotalAmt })
  })
  db.donations.filter((d) => d.Cancelled !== 'Y').forEach((d) => {
    entries.push({ led: cashOrBank(d.PAYMNTMODE), date: d.DONRECDate, doc_type: 'Donation', trn_no: d.PrintDONRECNO, narration: d.DONOR, dr: d.TOTAMT, cr: 0 })
    entries.push({ led: 5, date: d.DONRECDate, doc_type: 'Donation', trn_no: d.PrintDONRECNO, narration: d.DONOR, dr: 0, cr: d.TOTAMT })
  })
  ;[...db.payVch.map((v) => ({ ...v, t: 'Payment', no: v.PrintPMTVCHNO })), ...db.rcptVch.map((v) => ({ ...v, t: 'Receipt', no: v.PrintRCPTVCHNO }))].forEach((v) =>
    (v.lines || []).forEach((l) => entries.push({ led: l.ac_led_id, date: v.VCHDate, doc_type: v.t, trn_no: v.no, narration: v.NARR, dr: num(l.dr_amt), cr: num(l.cr_amt) }))
  )
  const OPEN = { 1: 25000, 2: 150000, 3: 80000 }
  return (b.ac_led_ids || []).map((id) => {
    const opening = OPEN[id] || 0
    let bal = opening
    const mine = entries.filter((e) => e.led === id && e.date <= b.to_date).sort((a, c) => a.date.localeCompare(c.date))
    const before = mine.filter((e) => e.date < b.from_date)
    before.forEach((e) => (bal += e.dr - e.cr))
    const openBal = bal
    const rows = mine.filter((e) => e.date >= b.from_date).map((e) => {
      bal += e.dr - e.cr
      return { date: e.date, doc_type: e.doc_type, trn_no: e.trn_no, narration: e.narration, dr: e.dr, cr: e.cr, balance: bal }
    })
    return { ac_led_id: id, name: rowName(db, 1204, id), opening: openBal, closing: bal, rows: b.mode === 'summary' ? [] : rows }
  }).filter((c) => !b.hide_zero || c.opening || c.closing || c.rows.length)
}
function customRun(db, crid, filters) {
  const def = DEMO_CUSTOM_DEFS[crid] || fail(404, 'Report not found')
  const key = (f) => `${f.table}__${f.code}`
  let rows
  if (crid === 1) {
    rows = db.sevas.filter((s) => s.Cancelled !== 'Y' && (!filters.KNAME || s.KNAME.toLowerCase().includes(filters.KNAME.toLowerCase())) && (!filters.SEVADate_from || s.SEVADate >= filters.SEVADate_from) && (!filters.SEVADate_to || s.SEVADate <= filters.SEVADate_to)).map((s) => ({
      TrnHdrSEVA__KNAME: s.KNAME, TrnHdrSEVA__MOBNUM: s.MOBNUM, MstGOTHRA__GOTHRANAME: rowName(db, 1257, s.GOTHRAID), MstNAKSHATRA__NAKSHATRANAME: rowName(db, 1258, s.NAKSHATRAID), TrnHdrSEVA__SEVADate: dayjs(s.SEVADate).format('DD/MM/YYYY'),
    }))
  } else {
    const m = new Map()
    sevaEntries(db, {}).forEach((s) => {
      const sn = rowName(db, 1255, s.SANNIDHIID)
      if (filters.SANNIDHINAME && !sn.toLowerCase().includes(filters.SANNIDHINAME.toLowerCase())) return
      const k = `${sn}|${rowName(db, 1265, s.SVAID)}`
      const g = m.get(k) || { MstSANNIDHI__SANNIDHINAME: sn, MstSVA__SVANAME: rowName(db, 1265, s.SVAID), TrnHdrSEVA__TotalAmt: 0 }
      g.TrnHdrSEVA__TotalAmt += s.TotalAmt
      m.set(k, g)
    })
    rows = [...m.values()]
  }
  const totals = {}
  def.fields.filter((f) => f.data_type === 'NUMERIC').forEach((f) => (totals[key(f)] = rows.reduce((s, r) => s + num(r[key(f)]), 0)))
  return { count: rows.length, rows, totals }
}

// ---------------------------------------------------------------- misc builders
function rightsFor(db, roleId) {
  if (!db.rights[roleId]) {
    const full = Number(roleId) === 1
    db.rights[roleId] = db.menu.map((m) => {
      const counter = Number(roleId) === 2 && ['Transactions', 'Vouchers'].includes(m.type)
      const acct = Number(roleId) === 3 && ['Vouchers', 'Reports', 'Ac-Reports'].includes(m.type)
      const mgr = Number(roleId) === 4 && m.type !== 'Utilities'
      const view = Number(roleId) === 5 && ['Reports', 'Ac-Reports'].includes(m.type)
      const on = full || counter || acct || mgr || view
      return { menu_item_id: m.menu_item_id, caption: m.caption, type: m.type, open: on, add: (full || counter || acct || mgr) && m.type !== 'Reports' && m.type !== 'Ac-Reports' && on, edit: (full || mgr) && on, delete: full && on }
    })
  }
  return db.rights[roleId]
}
function availability(db, hallId, from, months) {
  const start = dayjs(from)
  const end = start.add(Number(months) || 1, 'month')
  const out = []
  db.hall.filter((h) => h.HALLID === Number(hallId) && h.Cancelled !== 'Y').forEach((h) => {
    for (let d = dayjs(h.HBSTARTDT); !d.isAfter(dayjs(h.HBENDDT)); d = d.add(1, 'day')) {
      if (!d.isBefore(start) && d.isBefore(end)) out.push({ STAYDATE: d.format('YYYY-MM-DD'), PrintHBNO: h.PrintHBNO, NMEOFFUNC: h.NMEOFFUNC })
    }
  })
  // a few non-booking blocks so every hall shows something in the grid
  if (Number(hallId) === 2 && start.isSame(dayjs(), 'month')) [4, 11, 18].forEach((dd) => out.push({ STAYDATE: start.date(dd).format('YYYY-MM-DD'), PrintHBNO: `${FY_PREFIX}HB9${dd}`, NMEOFFUNC: 'Annadana seva' }))
  return out
}
const cancel = (rec, reason) => {
  rec.Cancelled = 'Y'
  rec.CancelReason = reason || ''
}

// minimal valid one-page PDF so print previews have something real to show in a viewer
export function demoPdfBlob(title = 'e-Mandira Pranali') {
  const t = String(title).replace(/[()\\]/g, '')
  const stream = `BT /F1 20 Tf 60 760 Td (${t}) Tj 0 -30 Td /F1 12 Tf (Demo preview. No real receipt was generated.) Tj ET`
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => {
    offs.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

// ---------------------------------------------------------------- route table
const ROUTES = []
const on = (method, pattern, handler) => ROUTES.push({ method, re: new RegExp(`^${pattern.replace(/:[a-z_]+/g, '([^/]+)')}$`), handler })

const U = DEMO_USER.user_code

on('GET', '/auth/me', () => DEMO_USER)
on('GET', '/auth/financial-years', ({ db }) => db.fys.map((f, i) => ({ id: i + 1, start_date: f.yrFdate, end_date: f.yrTdate, is_active: f.Active === 'Y' })))
on('POST', '/auth/change-password', () => ({ message: 'Password changed (demo: nothing was stored)' }))

on('GET', '/meta/menu', ({ db }) => db.menu.filter((m) => !db.hiddenMenu.has(m.menu_item_id)))
on('GET', '/meta/menu/settings', ({ db }) => db.menu.map((m) => ({ menu_item_id: m.menu_item_id, caption: m.caption, type: m.type, doc_id: m.doc_id, group: m.group, show: !db.hiddenMenu.has(m.menu_item_id) })))
on('PUT', '/meta/menu/:id/visibility', ({ db, p, body }) => {
  body.show ? db.hiddenMenu.delete(Number(p[0])) : db.hiddenMenu.add(Number(p[0]))
  return { message: 'Updated' }
})
on('GET', '/meta/prefixes/:doc', () => [FY_PREFIX])
on('GET', '/meta/docs/:doc/fields', ({ db, p }) => ({ doc: { DocID: Number(p[0]), DocName: DOC_NAMES[p[0]] || 'Document' }, fields: db.fields[p[0]] || [] }))
on('GET', '/meta/lookup/:doc/:field', ({ db, p, q }) => lookup(db, p[1], q.search))
on('GET', '/meta/ledgers', ({ db, q }) => ledgerRows(db).map((r) => ({ value: r.LEDID, label: r.LEDNAME })).filter((o) => !q.search || o.label.toLowerCase().includes(q.search.toLowerCase())))

on('GET', '/masters/:doc', ({ db, p, q }) => masterList(db, Number(p[0]), q))
on('POST', '/masters/:doc/import', ({ db, p }) => {
  const m = master(db, Number(p[0]))
  const rows = ['Sample row A', 'Sample row B', 'Sample row C'].map((n, i) => ({ row: i + 2, status: i === 2 ? 'error' : 'ok', id: m ? Math.max(...m.rows.map((r) => r[m.meta.id_col])) + i + 1 : 0, message: 'Code already exists' }))
  return { created: 2, failed: 1, rows }
})
on('GET', '/masters/:doc/import-template', () => new Blob(['Code,Name\n'], { type: 'text/csv' }))
on('GET', '/masters/:doc/:row/attachments', ({ db, p }) => db.attachments[`${p[0]}:${p[1]}`] || [])
on('POST', '/masters/:doc/:row/attachments', ({ db, p, body }) => {
  const file = body?.get?.('file')
  const key = `${p[0]}:${p[1]}`
  db.attachments[key] = [...(db.attachments[key] || []), { AFileName: `${Date.now()}_${file?.name || 'document.pdf'}`, ADescription: '' }]
  return { message: 'File attached' }
})
on('DELETE', '/masters/:doc/:row/attachments/:file', ({ db, p }) => {
  const key = `${p[0]}:${p[1]}`
  db.attachments[key] = (db.attachments[key] || []).filter((f) => f.AFileName !== decodeURIComponent(p[2]))
  return { message: 'Removed' }
})
on('GET', '/masters/:doc/:row/attachments/:file', () => new Blob(['Demo attachment'], { type: 'text/plain' }))
on('GET', '/masters/:doc/:row', ({ db, p }) => {
  const m = master(db, Number(p[0])) || fail(404, 'Unknown document')
  return m.rows.find((r) => r[m.meta.id_col] === Number(p[1])) || fail(404, `${m.meta.caption} not found`)
})
on('POST', '/masters/:doc', ({ db, p, body }) => masterCreate(db, Number(p[0]), body, U))
on('PUT', '/masters/:doc/:row', ({ db, p, body }) => masterUpdate(db, Number(p[0]), p[1], body, U))
on('DELETE', '/masters/:doc/:row', ({ db, p }) => {
  masterDelete(db, Number(p[0]), p[1], U)
  return { message: 'Deleted Successfully!' }
})

on('GET', '/sevas/devotee', ({ db, q }) => {
  const s = db.sevas.find((x) => x.Cancelled !== 'Y' && ((q.mobile && x.MOBNUM === q.mobile) || (q.name && x.KNAME.toLowerCase() === q.name.toLowerCase())))
  return s ? { KNAME: s.KNAME, NAMEINKAN: s.NAMEINKAN, MOBNUM: s.MOBNUM, GOTHRAID: s.GOTHRAID, NAKSHATRAID: s.NAKSHATRAID, RASHIID: s.RASHIID, SECKNAME: s.SECKNAME, SECNAKSHATRAID: s.SECNAKSHATRAID, SECRASHIID: s.SECRASHIID } : null
})
on('GET', '/sevas', ({ db, q }) => top(db.sevas, q))
on('GET', '/sevas/:id', ({ db, p }) => db.sevas.find((s) => s.SEVAID === Number(p[0])) || fail(404, 'Seva not found'))
on('POST', '/sevas', ({ db, body }) => createSeva(db, body, U))
on('POST', '/sevas/:id/cancel', ({ db, p, body }) => {
  cancel(db.sevas.find((s) => s.SEVAID === Number(p[0])) || fail(404, 'Seva not found'), body?.reason)
  return { message: 'Cancelled' }
})
on('DELETE', '/sevas/:id', ({ db, p }) => {
  db.sevas = db.sevas.filter((s) => s.SEVAID !== Number(p[0]))
  return { message: 'Deleted' }
})

on('GET', '/donations/donor/lookup', ({ db, q }) => {
  const d = db.donations.find((x) => x.CONTACTNO === q.contact_no)
  return d ? { DONOR: d.DONOR, ADDRESS: d.ADDRESS, PANNO: d.PANNO } : null
})
on('GET', '/donations', ({ db, q }) => top(db.donations, q))
on('GET', '/donations/:id', ({ db, p }) => db.donations.find((s) => s.DONRECID === Number(p[0])) || fail(404, 'Donation not found'))
on('POST', '/donations', ({ db, body }) => createDonation(db, body, U))
on('POST', '/donations/:id/cancel', ({ db, p, body }) => {
  cancel(db.donations.find((s) => s.DONRECID === Number(p[0])) || fail(404, 'Donation not found'), body?.reason)
  return { message: 'Cancelled' }
})
on('DELETE', '/donations/:id', ({ db, p }) => {
  db.donations = db.donations.filter((s) => s.DONRECID !== Number(p[0]))
  return { message: 'Deleted' }
})

on('GET', '/halls', ({ db }) => master(db, 1282).rows.filter((r) => r.HALLID > 0).map((r) => ({ HALLID: r.HALLID, HALLNAME: r.HALLNAME })))
on('GET', '/halls/bookings', ({ db, q }) => top(db.hall, q))
on('GET', '/halls/bookings/:id', ({ db, p }) => db.hall.find((h) => h.HBID === Number(p[0])) || fail(404, 'Booking not found'))
on('POST', '/halls/bookings', ({ db, body }) => createHall(db, body, U))
on('POST', '/halls/bookings/:id/payments', ({ db, p, body }) => hallPayment(db, p[0], body, U))
on('POST', '/halls/bookings/:id/cancel', ({ db, p, body }) => {
  cancel(db.hall.find((h) => h.HBID === Number(p[0])) || fail(404, 'Booking not found'), body?.reason)
  return { message: 'Cancelled' }
})
on('GET', '/halls/:id/availability', ({ db, p, q }) => availability(db, p[0], q.from_date, q.months))

on('GET', '/hall-booking-entry', ({ db, q }) => top(db.hbe, q))
on('GET', '/hall-booking-entry/:id', ({ db, p }) => db.hbe.find((h) => h.HBEID === Number(p[0])) || fail(404, 'Entry not found'))
on('POST', '/hall-booking-entry', ({ db, body }) => createHbe(db, body, U))
on('DELETE', '/hall-booking-entry/:id', ({ db, p }) => {
  db.hbe = db.hbe.filter((h) => h.HBEID !== Number(p[0]))
  return { message: 'Deleted' }
})

;[['payments', 'pay', 'payVch', 'PMTVCHID'], ['receipts', 'rcpt', 'rcptVch', 'RCPTVCHID']].forEach(([path, kind, key, idCol]) => {
  on('GET', `/vouchers/${path}`, ({ db, q }) => top(db[key], q))
  on('POST', `/vouchers/${path}`, ({ db, body }) => createVoucher(db, kind, body, U))
  on('POST', `/vouchers/${path}/:id/cancel`, ({ db, p, body }) => {
    cancel(db[key].find((v) => v[idCol] === Number(p[0])) || fail(404, 'Voucher not found'), body?.reason)
    return { message: 'Cancelled' }
  })
  on('DELETE', `/vouchers/${path}/:id`, ({ db, p }) => {
    db[key] = db[key].filter((v) => v[idCol] !== Number(p[0]))
    return { message: 'Deleted' }
  })
})

// inventory documents
const INV = [
  ['stock-adjustments', 'sa', 'sa', 'SAID', 'SANO', 'PrintSANO', 'SA', (b) => ({ SADate: b.doc_date, RMKS: b.remarks || '', TOTQTY: (b.lines || []).reduce((s, l) => s + (l.adj_type === 'Out' ? -num(l.qty) : num(l.qty)), 0), LOCID: b.loc_id }), 'sa_no'],
  ['store-issues', 'si', 'si', 'ISSID', 'ISSNO', 'PrintISSNO', 'SI', (b) => ({ ISSDate: b.doc_date, RMKS: b.remarks || '', TOTQTY: (b.lines || []).reduce((s, l) => s + num(l.qty), 0), LOCID: b.loc_id }), 'iss_no'],
  ['purchase-bills', 'pb', 'pb', 'PBID', 'PBNO', 'PrintPBNO', 'PB', (b) => ({ PBDate: b.doc_date, PartyName: rowName(getDb(), 1121, b.supp_id) || 'Supplier', PBVALUE: (b.lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0), VCHID: 0, SUPPID: b.supp_id, REFNO: b.ref_no || '' }), 'pb_no'],
  ['purchase-vouchers', 'pv', 'pv', 'PURVCHID', 'PURVCHNO', 'PrintPURVCHNO', 'PUV', (b) => ({ VCHDate: b.voucher_date, CRPERIOD: b.credit_period || 0, PBID: b.pb_id, PartyName: getDb().pb.find((x) => x.PBID === Number(b.pb_id))?.PartyName || '' }), 'purvch_no'],
  ['boms', 'bom', 'bom', 'BOMID', 'BOMNO', 'PrintBOMNO', 'BOM', (b) => ({ EffFrom: b.eff_from, FinishedItem: rowName(getDb(), 1114, b.item_id), ITEMID: b.item_id }), 'bom_no'],
]
INV.forEach(([path, key, idKey, idCol, noCol, printCol, prefix, build, resultNo]) => {
  on('GET', `/inventory/${path}`, ({ db, q }) => top(db[key], q))
  on('POST', `/inventory/${path}`, ({ db, body }) => {
    const id = db.nextId[idKey]++
    const no = db[key].length + 1
    const printNo = `${FY_PREFIX}${prefix}${pad(no, 3)}`
    db[key].unshift({ [idCol]: id, [noCol]: no, [printCol]: printNo, ...build(body) })
    audit(db, U, 'A', path, printNo)
    return { [idCol.toLowerCase()]: id, [resultNo]: printNo }
  })
  on('DELETE', `/inventory/${path}/:id`, ({ db, p }) => {
    db[key] = db[key].filter((r) => r[idCol] !== Number(p[0]))
    return { message: 'Deleted' }
  })
})
on('GET', '/inventory/stock-balance', ({ db, q }) => db.stock.balances.filter((b) => (!q.loc_id || b.loc_id === Number(q.loc_id)) && (!q.item_code || b.item_code.toLowerCase().includes(String(q.item_code).toLowerCase()))))
on('GET', '/inventory/stock-balance-report', ({ db, q }) => db.stock.balances.filter((b) => !q.loc_id || b.loc_id === Number(q.loc_id)))
on('GET', '/inventory/stock-ledger-report', ({ db, q }) => db.stock.ledger.filter((l) => l.item_id === Number(q.item_id) && (!q.loc_id || l.loc_id === Number(q.loc_id))))
on('GET', '/inventory/where-used', ({ db, q }) => db.stock.boms.filter((b) => b.component_item_id === Number(q.item_id)))

on('GET', '/panchanga', ({ db, q }) => db.panchanga.filter((d) => d.date >= q.from_date && d.date <= q.to_date))
on('PUT', '/panchanga', ({ db, body }) => {
  const i = db.panchanga.findIndex((d) => d.date === body.date)
  i >= 0 ? (db.panchanga[i].name = body.name) : db.panchanga.push({ date: body.date, name: body.name, color: null })
  return { message: 'Updated' }
})
on('DELETE', '/panchanga/:day', ({ db, p }) => {
  db.panchanga = db.panchanga.filter((d) => d.date !== p[0])
  return { message: 'Deleted' }
})

// reports
on('POST', '/reports/complete-day', ({ db, body }) => collectionReport(db, { from_date: body.from_date, to_date: body.to_date, sannidhi_ids: body.sannidhi_ids, seva_ids: body.seva_ids }))
on('POST', '/reports/collection', ({ db, body }) => collectionReport(db, body))
on('POST', '/reports/seva-issue', ({ db, body }) => {
  const rows = []
  sevaEntries(db, {}).forEach((s) =>
    (s.dates || []).filter((d) => inRange(d, body) && (!body.sannidhi_ids?.length || body.sannidhi_ids.includes(s.SANNIDHIID)) && (!body.seva_ids?.length || body.seva_ids.includes(s.SVAID))).forEach((d) =>
      rows.push({ PDATE: d, PrintSevaNo: s.PrintSEVANO, NAME1: s.KNAME, SANNADHI: rowName(db, 1255, s.SANNIDHIID), SEVA: rowName(db, 1265, s.SVAID), GOTHRA: rowName(db, 1257, s.GOTHRAID), NAKSHATRA1: rowName(db, 1258, s.NAKSHATRAID), RASHI1: rowName(db, 1279, s.RASHIID), MOBNUM: s.MOBNUM })
    )
  )
  rows.sort((a, b) => a.PDATE.localeCompare(b.PDATE))
  return { total_count: rows.length, rows }
})
on('POST', '/reports/donations', ({ db, body }) => {
  const rows = db.donations.filter((d) => d.Cancelled !== 'Y' && inRange(d.DONRECDate, body)).map((d) => ({ PrintDONRECNO: d.PrintDONRECNO, DONRECDate: d.DONRECDate, DONOR: d.DONOR, CONTACTNO: d.CONTACTNO, PANNO: d.PANNO, TOTAMT: d.TOTAMT, PAYMNTMODE: d.PAYMNTMODE, AddedBy: d.AddedBy }))
  return { total_count: rows.length, total_amount: rows.reduce((s, r) => s + r.TOTAMT, 0), rows }
})
on('POST', '/reports/hall-booking-voucher', ({ db, body }) => {
  const rows = db.hall.filter((h) => h.Cancelled !== 'Y' && inRange(h.HBDate, body)).flatMap((h) =>
    (h.receipts.length ? h.receipts : [{}]).map((r) => ({ PrintHBNO: h.PrintHBNO, HBDate: h.HBDate, NMEOFFUNC: h.NMEOFFUNC, CONPRS: h.CONPRS, CONTACTNO: h.CONTACTNO, HBSTARTDT: h.HBSTARTDT, HBENDDT: h.HBENDDT, AMOUNT: h.AMOUNT, RCPTVCHNO: r.PrintRCPTVCHNO || '', RCPTTYPE: r.RCPTTYPE || '', TOTCR: r.TOTCR || 0, BALAMT: h.BALAMT, printdonrecno: h.printdonrecno }))
  )
  return { total_count: rows.length, total_amount: rows.reduce((s, r) => s + r.AMOUNT, 0), rows }
})
on('POST', '/reports/general-ledger', ({ db, body }) => generalLedger(db, body))
on('GET', '/reports/custom', () => DEMO_CUSTOM_REPORTS)
on('GET', '/reports/custom/:id/fields', ({ p }) => DEMO_CUSTOM_DEFS[p[0]] || fail(404, 'Report not found'))
on('POST', '/reports/custom/:id/run', ({ db, p, body }) => customRun(db, Number(p[0]), body.filters || {}))
on('GET', '/reports/catalog', () => DEMO_REPORT_CATALOG)

// admin
on('GET', '/roles/:id/rights', ({ db, p }) => rightsFor(db, p[0]))
on('PUT', '/roles/:id/rights', ({ db, p, body }) => {
  db.rights[p[0]] = body
  return { message: 'Rights saved' }
})
on('PUT', '/users/:id/password', () => ({ message: 'Password updated (demo: nothing was stored)' }))
on('GET', '/settings', ({ db }) => db.settings)
on('PUT', '/settings', ({ db, body }) => {
  const s = db.settings.find((x) => x.group === body.group && x.name === body.name) || fail(404, 'Setting not found')
  s.value = body.value
  return { message: 'Updated' }
})
on('GET', '/company', ({ db }) => db.company)
on('PUT', '/company', ({ db, body }) => {
  if (!String(body.CompName || '').trim()) fail(422, 'Company name should not be blank!')
  Object.assign(db.company, body)
  return db.company
})
on('GET', '/company/financial-years', ({ db }) => db.fys)
on('POST', '/company/financial-years', ({ db, body }) => {
  if (db.fys.some((f) => f.yrFdate === body.from_date)) fail(409, 'That financial year already exists')
  db.fys.unshift({ yrFdate: body.from_date, yrTdate: body.to_date, Active: 'N' })
  return { message: 'Added' }
})
on('PUT', '/company/financial-years/active', ({ db, body }) => {
  db.fys.forEach((f) => (f.Active = f.yrFdate === body.from_date ? 'Y' : 'N'))
  return { message: 'Active year changed' }
})
on('GET', '/audit-log/filters', ({ db }) => ({ entities: [...new Set(db.audit.map((a) => a.entity))].sort(), actions: ['A', 'M', 'D', 'C'], users: [...new Set(db.audit.map((a) => a.user_code))].sort() }))
on('GET', '/audit-log', ({ db, q }) => db.audit.filter((a) => (!q.entity || a.entity === q.entity) && (!q.action || a.action === q.action) && (!q.user_code || a.user_code === q.user_code) && (!q.from_date || a.at.slice(0, 10) >= q.from_date) && (!q.to_date || a.at.slice(0, 10) <= q.to_date)))
on('DELETE', '/audit-log', ({ db, q }) => {
  const before = db.audit.length
  db.audit = db.audit.filter((a) => a.at.slice(0, 10) >= q.before)
  return { deleted: before - db.audit.length }
})
on('GET', '/bulk-update/definitions', () => DEMO_BULK_DEFS.map((d) => ({ row_id: d.row_id, doc_name: d.doc_name, table: d.table })))
on('GET', '/bulk-update/:id', ({ p }) => DEMO_BULK_DEFS.find((d) => d.row_id === Number(p[0])) || fail(404, 'Bulk update definition not found'))
on('POST', '/bulk-update/:id/rows/search', ({ db, p, body }) => {
  const def = DEMO_BULK_DEFS.find((d) => d.row_id === Number(p[0])) || fail(404, 'Bulk update definition not found')
  const m = master(db, BULK_TABLE_DOC[def.table])
  const f = Object.entries(body.filters || {}).filter(([, v]) => v)
  return m.rows.filter((r) => r[def.key_field] > 0 && f.every(([k, v]) => String(r[k] ?? '').toLowerCase().includes(String(v).toLowerCase()))).map((r) => Object.fromEntries(def.columns.map((c) => [c.name, r[c.name]])))
})
on('PUT', '/bulk-update/:id/rows', ({ db, p, body }) => {
  const def = DEMO_BULK_DEFS.find((d) => d.row_id === Number(p[0])) || fail(404, 'Bulk update definition not found')
  const m = master(db, BULK_TABLE_DOC[def.table])
  let n = 0
  ;(body.rows || []).forEach((r) => {
    const row = m.rows.find((x) => x[def.key_field] === r[def.key_field])
    if (row) {
      Object.assign(row, r)
      n += 1
    }
  })
  return { message: `Updated ${n} row(s)` }
})

// printing
on('GET', '/print/:doc/options', ({ p }) => DEMO_PRINT_OPTIONS_BY_DOC(Number(p[0])))
on('PUT', '/print/:doc/preference', () => ({ message: 'Saved' }))
on('GET', '/print/:doc/:opt/:rec/preview', ({ p }) => demoPdfBlob(`${DOC_NAMES[p[0]] || 'Document'} #${p[2]}`))
on('POST', '/print/:doc/:opt/:rec/print-direct', () => ({ message: 'Demo: nothing was sent to a printer' }))
on('GET', '/print/:doc/:opt/bulk-pdf', () => new Blob(['PK'], { type: 'application/zip' }))
on('GET', '/print-options', ({ db }) => db.printOptions)
on('PUT', '/print-options/:doc/:opt', ({ db, p, body }) => {
  const o = db.printOptions.find((x) => x.DocID === Number(p[0]) && x.OptionName === decodeURIComponent(p[1])) || fail(404, 'Print option not found')
  Object.assign(o, body)
  return o
})

on('GET', '/display/today-sevas', ({ db }) =>
  db.sevas.filter((s) => s.Cancelled !== 'Y' && s.dates?.includes(iso(0))).map((s) => ({ name: s.KNAME, name2: s.SECKNAME, sannidhi: rowName(db, 1255, s.SANNIDHIID), seva: rowName(db, 1265, s.SVAID), date_text: dayjs(iso(0)).format('DD/MM/YYYY') }))
)

on('GET', '/db-settings', () => DEMO_DB_SETTINGS)
on('POST', '/db-settings/test', () => ({ ok: true, detail: 'Demo mode: no real connection was tested.' }))
on('PUT', '/db-settings', () => ({ ok: true, detail: 'Demo mode: nothing was changed.' }))
on('GET', '/welcome', ({ db }) => ({ enabled: db.welcome.enabled, custom: false, size: 0, version: 0 }))
on('PUT', '/welcome/enabled', ({ db, body }) => {
  db.welcome.enabled = !!body.enabled
  return { enabled: db.welcome.enabled, custom: false, size: 0, version: 0 }
})
on('POST', '/welcome', () => fail(400, 'Uploading a welcome video needs the real backend (not available in demo mode)'))
on('DELETE', '/welcome', ({ db }) => ({ enabled: db.welcome.enabled, custom: false, size: 0, version: 0 }))

/** Resolve one request. Returns { data } or throws DemoError. */
export function handleDemoRequest({ method, path, query = {}, body }) {
  const db = getDb()
  const m = method.toUpperCase()
  for (const r of ROUTES) {
    if (r.method !== m) continue
    const hit = r.re.exec(path)
    if (hit) return { data: r.handler({ db, p: hit.slice(1), q: query, body: body ?? {} }) }
  }
  throw new DemoError(404, `Not available in demo mode: ${m} ${path}`)
}

export { clone }

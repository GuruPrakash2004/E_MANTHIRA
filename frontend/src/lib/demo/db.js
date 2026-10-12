// The in-memory demo database. Built once per page load from the seed modules; writes made in Demo mode mutate it,
// so saved entries show up in the recent lists, reports and dashboards until the page is reloaded.
import { buildMasters } from './seedMasters'
import { buildTransactions } from './seedTransactions'
import { buildDocFields, DEMO_COMPANY, DEMO_FYS, DEMO_MENU, DEMO_PRINT_OPTIONS_ALL, DEMO_SETTINGS } from './seedSystem'
import { clone, iso, rng } from './util'

let db = null

function buildStock(masters) {
  const r = rng(23)
  const items = masters[1114].rows.filter((x) => x.ITEMID > 0)
  const locs = masters[1123].rows.filter((x) => x.LOCID > 0)
  const uoms = ['Kg', 'Kg', 'Packet', 'Nos', 'Nos', 'Kg', 'Kg', 'Kg', 'Nos', 'Packet', 'Packet', 'Bunch']
  const rates = [620, 90, 55, 40, 28, 62, 118, 70, 380, 25, 30, 45]
  const balances = []
  const ledger = []
  items.forEach((it, i) => {
    locs.forEach((loc, j) => {
      if ((i + j) % 3 === 2) return
      const qty = Math.round((10 + r() * 90) * 10) / 10
      balances.push({ loc_id: loc.LOCID, loc_name: loc.LOCNAME, item_id: it.ITEMID, item_code: it.ITEMCODE, item_name: it.ITEMNAME, item_group: it.ITEMGRPNAME, uom_code: uoms[i], balance: qty, rate: rates[i], value: Math.round(qty * rates[i] * 100) / 100 })
    })
    // a short ledger per item: opening, purchase, issue, adjustment
    let run = 0
    ;[['Opening Balance', 'OB', 0, 40 + i * 3], ['Purchase Bill', 'PB', 12, 30], ['Store Issue Note', 'SI', 9, -12], ['Store Issue Note', 'SI', 5, -8], ['Stock Adjustment', 'SA', 3, 5]].forEach(([doc, pfx, ago, q], k) => {
      run += q
      ledger.push({ item_id: it.ITEMID, loc_id: 1 + (k % 3), doc_date: iso(ago + 20 - k * 3), doc_name: doc, doc_no: `26SLV${pfx}${String(k + 1).padStart(3, '0')}`, particulars: k === 1 ? 'Sri Lakshmi Traders' : doc, in_qty: q > 0 ? q : 0, out_qty: q < 0 ? -q : 0, running_balance: run })
    })
  })
  const boms = [
    { bom_no: '26SLV BOM001', bom_date: iso(60), finished_item_code: 'PRA01', finished_item_name: 'Prasadam Laddu Mix', component_item_id: 8, qty_per_unit: 0.4, uom_code: 'Kg' },
    { bom_no: '26SLV BOM001', bom_date: iso(60), finished_item_code: 'PRA01', finished_item_name: 'Prasadam Laddu Mix', component_item_id: 1, qty_per_unit: 0.1, uom_code: 'Kg' },
    { bom_no: '26SLV BOM002', bom_date: iso(50), finished_item_code: 'PON01', finished_item_name: 'Pongal Pack', component_item_id: 6, qty_per_unit: 0.5, uom_code: 'Kg' },
    { bom_no: '26SLV BOM002', bom_date: iso(50), finished_item_code: 'PON01', finished_item_name: 'Pongal Pack', component_item_id: 7, qty_per_unit: 0.2, uom_code: 'Kg' },
    { bom_no: '26SLV BOM003', bom_date: iso(40), finished_item_code: 'KIT01', finished_item_name: 'Pooja Kit', component_item_id: 2, qty_per_unit: 1, uom_code: 'Nos' },
    { bom_no: '26SLV BOM003', bom_date: iso(40), finished_item_code: 'KIT01', finished_item_name: 'Pooja Kit', component_item_id: 3, qty_per_unit: 1, uom_code: 'Packet' },
  ]
  return { balances, ledger, boms }
}

export function getDb() {
  if (db) return db
  const masters = buildMasters()
  const tx = buildTransactions(masters)
  db = {
    masters,
    ...tx,
    fields: buildDocFields(),
    settings: clone(DEMO_SETTINGS),
    company: clone(DEMO_COMPANY),
    fys: clone(DEMO_FYS),
    menu: clone(DEMO_MENU),
    hiddenMenu: new Set(),
    rights: {},
    printOptions: clone(DEMO_PRINT_OPTIONS_ALL),
    attachments: {},
    welcome: { enabled: true },
    stock: buildStock(masters),
    nextId: { seva: 9100, donation: 7100, hall: 5100, hbe: 6200, pay: 3100, rcpt: 4600, sa: 900, si: 950, pb: 990, pv: 1000, bom: 500, rcptHall: 4900, master: 1000, audit: 500 },
  }
  return db
}

export function resetDemoDb() {
  db = null
}

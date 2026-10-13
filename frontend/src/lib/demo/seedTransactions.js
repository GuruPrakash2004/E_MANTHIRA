// Transactions for the demo database: sevas, donations, hall bookings (+ payments), hall booking entries, vouchers,
// inventory documents, the Panchanga calendar and the audit trail. Generated deterministically from the masters so
// names, ledgers and amounts agree across every screen and report.
import { specialDayOf } from '../../utils/tithi'
import dayjs from 'dayjs'
import { FY_PREFIX, iso, isoFuture, oleColor, pad, pick, rng, stamp } from './util'

const nameOf = (masters, doc, id) => masters[doc].rows.find((r) => r[masters[doc].meta.id_col] === id)?.[masters[doc].meta.name_col] || ''

const DEVOTEES = [
  ['Ramesh Iyengar', 'ರಮೇಶ್ ಅಯ್ಯಂಗಾರ್', '9900044441', 'Rukmini Iyengar'], ['Lakshmi Narasimhan', 'ಲಕ್ಷ್ಮಿ ನರಸಿಂಹನ್', '9845512234', 'Narasimhan R'], ['Venkatesh Prasad', 'ವೆಂಕಟೇಶ್ ಪ್ರಸಾದ್', '9900112233', ''],
  ['Shruthi Bhat', 'ಶ್ರುತಿ ಭಟ್', '9741122334', 'Ganesh Bhat'], ['Gopalakrishna Rao', 'ಗೋಪಾಲಕೃಷ್ಣ ರಾವ್', '9611223344', 'Sharada Rao'], ['Anitha Hegde', 'ಅನಿತಾ ಹೆಗಡೆ', '9880011223', ''],
  ['Srinivas Murthy', 'ಶ್ರೀನಿವಾಸ ಮೂರ್ತಿ', '9449900112', 'Vasantha Murthy'], ['Padmavathi K', 'ಪದ್ಮಾವತಿ ಕೆ', '9535566778', ''], ['Raghavendra Acharya', 'ರಾಘವೇಂದ್ರ ಆಚಾರ್ಯ', '9886677889', 'Seetha Acharya'],
  ['Meera Kulkarni', 'ಮೀರಾ ಕುಲಕರ್ಣಿ', '9972211334', ''], ['Dinesh Kamath', 'ದಿನೇಶ್ ಕಾಮತ್', '9008899776', 'Asha Kamath'], ['Vasudha Rao', 'ವಸುಧಾ ರಾವ್', '9591122443', ''],
]
const PAY = ['Cash', 'Cash', 'UPI', 'Cash', 'Card', 'Cheque']

export function buildTransactions(masters) {
  const r = rng(7)
  const db = { sevas: [], donations: [], hall: [], hbe: [], payVch: [], jnrVch: [], exp: [], rcptVch: [], sa: [], si: [], pb: [], pv: [], bom: [], audit: [], panchanga: [], seq: {} }

  // ---- Sevas: ~5 today, the rest spread over the last 12 days
  let n = 0
  const perDay = [5, 4, 4, 3, 3, 2, 2, 3, 2, 2, 1, 2, 1]
  perDay.forEach((count, daysAgo) => {
    for (let k = 0; k < count; k++) {
      n += 1
      const dev = DEVOTEES[(n * 5) % DEVOTEES.length]
      const sevaId = 1 + ((n * 7) % 12)
      const seva = masters[1265].rows.find((x) => x.SVAID === sevaId)
      const nakId = 1 + ((n * 3) % 27)
      const nak = masters[1258].rows.find((x) => x.NAKSHATRAID === nakId)
      const dates = [dayjs().subtract(daysAgo, 'day').add(k % 3, 'day').format('YYYY-MM-DD')]
      if (n % 4 === 0) dates.push(dayjs(dates[0]).add(7, 'day').format('YYYY-MM-DD'))
      const rate = seva.AMT
      const mode = pick(r, PAY)
      db.sevas.push({
        SEVAID: 9000 + n, SEVANO: n, PrintSEVANO: `${FY_PREFIX}${pad(500 + n)}`, SEVADate: iso(daysAgo), KNAME: dev[0], NAMEINKAN: dev[1], MOBNUM: dev[2], SECKNAME: dev[3],
        SANNIDHIID: seva.SANNIDHIID, SVAID: sevaId, GOTHRAID: 1 + (n % 14), NAKSHATRAID: nakId, RASHIID: nak.RASHIID1, SECNAKSHATRAID: dev[3] ? 1 + ((n * 5) % 27) : 0, SECRASHIID: dev[3] ? 1 + (n % 12) : 0,
        Rate: rate, PAYMNTMODE: mode, TotalAmt: rate * dates.length, Cancelled: n === 9 ? 'Y' : 'N', CancelReason: n === 9 ? 'Duplicate entry' : '', dates, ReceiptNo: `${FY_PREFIX}${pad(1200 + n)}`, AddedBy: n % 3 ? 'SURESH' : 'LAKSHMI', AddedOn: stamp(daysAgo, 9 + (k % 6), 10 + k * 7),
      })
    }
  })
  db.sevas.sort((a, b) => b.SEVAID - a.SEVAID)

  // ---- Donations
  const DONORS = [['Suresh Kamath', '9900887766', 'Basavanagudi, Bengaluru'], ['Padma Subramanya', '9845123456', 'Jayanagar 4th Block'], ['Krishna Murthy Trust', '9741234567', 'Malleswaram, Bengaluru'], ['Vidya Shenoy', '9611234567', 'Udupi'], ['Anantha Rao', '9886001122', 'Mysuru'], ['Sudha Nayak', '9449123987', 'Rajajinagar'], ['Harish Bhat', '9035112233', 'Mangaluru']]
  for (let i = 0; i < 14; i += 1) {
    const d = DONORS[i % DONORS.length]
    const amt = [2000, 500, 10000, 1000, 5000, 251, 21000][i % 7]
    db.donations.push({
      DONRECID: 7000 + i + 1, DONRECNO: i + 1, PrintDONRECNO: `${FY_PREFIX}${pad(700 + i + 1)}`, DONRECDate: iso(Math.floor(i / 2)), DONOR: d[0], CONTACTNO: d[1], ADDRESS: d[2], PANNO: i % 3 === 0 ? 'ABCPK1234F' : '', TOTAMT: amt,
      PAYMNTMODE: PAY[i % PAY.length], Cancelled: 'N', ReceiptNo: `${FY_PREFIX}${pad(1300 + i)}`, AddedBy: i % 2 ? 'SURESH' : 'LAKSHMI', lines: i % 5 === 0 ? [{ seva_id: 1, amount: amt / 2 }, { seva_id: 6, amount: amt / 2 }] : [],
    })
  }
  db.donations.sort((a, b) => b.DONRECID - a.DONRECID)

  // ---- Hall bookings with their payment receipts
  const FUNCS = [['Sri Satyanarayana Pooja', 1, 3, 2], ['Upanayana Ceremony', 1, 12, 2], ['Bhajan Sandhya', 5, 6, 0], ['Annadana for Aradhane', 2, 9, 0], ['Wedding Reception', 1, 20, 1], ['Namakarana', 4, 5, 0], ['Shashtipoorthi', 1, 26, 1]]
  FUNCS.forEach((f, i) => {
    const hallId = f[1]
    const amount = [15000, 30000, 4000, 12000, 45000, 6000, 28000][i]
    const gst = Math.round(amount * 0.18 * 100) / 100
    const net = amount + gst
    const start = i === 3 ? iso(1) : i < 2 ? iso(-1 * f[2] + 30 - 30) : isoFuture(f[2])
    const startDate = i === 0 ? iso(6) : start
    const days = f[3] || 0
    const adv = Math.round(net * (i % 2 ? 0.5 : 0.3))
    const receipts = [{ RCPTVCHID: 4000 + i * 10 + 1, PrintRCPTVCHNO: `${FY_PREFIX}RV${pad(100 + i * 2 + 1, 4)}`, RCPTVCHDate: iso(8 - i), RCPTTYPE: 'ADV', TOTCR: adv, Cancelled: 'N' }]
    let paid = adv
    if (i === 0 || i === 3) {
      receipts.push({ RCPTVCHID: 4000 + i * 10 + 2, PrintRCPTVCHNO: `${FY_PREFIX}RV${pad(100 + i * 2 + 2, 4)}`, RCPTVCHDate: iso(1), RCPTTYPE: 'Final', TOTCR: net - adv, Cancelled: 'N' })
      paid = net
    }
    db.hall.push({
      HBID: 5000 + i + 1, HBNO: i + 1, PrintHBNO: `${FY_PREFIX}HB${pad(i + 1, 4)}`, HBDate: iso(10 - i), TYPE: 'HALL BOOKING', NMEOFFUNC: f[0], CONPRS: DEVOTEES[(i * 2) % 12][0], CONTACTNO: DEVOTEES[(i * 2) % 12][2], MOBNO: DEVOTEES[(i * 2) % 12][2],
      HALLID: hallId, HALLNAME: nameOf(masters, 1282, hallId), HBSTARTDT: startDate, HBENDDT: dayjs(startDate).add(days, 'day').format('YYYY-MM-DD'), AMOUNT: amount, CGST: gst / 2, SGST: gst / 2, NETPAY: net, ADV: paid, BALAMT: net - paid, SDEPAMT: 5000,
      Cancelled: i === 5 ? 'Y' : 'N', receipts: i === 5 ? [] : receipts, RCPTVCHNO: receipts[0].PrintRCPTVCHNO, RCPTTYPE: receipts[0].RCPTTYPE, TOTCR: paid, printdonrecno: i === 1 ? `${FY_PREFIX}${pad(703)}` : '',
    })
  })
  db.hall.sort((a, b) => b.HBID - a.HBID)

  // ---- Hall booking entries (flat receipts, no GL)
  ;[['HALL BOOKING', 'Sri Satyanarayana Pooja', 6000], ['CARPUS FUND', 'Corpus fund donation', 25000], ['KESHAVA SADANA', 'Family gathering', 4500], ['HALL BOOKING', 'Bhajan Sandhya', 3000], ['ANNAPOORNA DHYANA MANDIRA', 'Meditation camp', 8000], ['HALL BOOKING', 'Housewarming pooja', 5500]].forEach((h, i) => {
    db.hbe.push({ HBEID: 6100 + i + 1, HBENO: i + 1, PrintHBENO: `${FY_PREFIX}${h[0] === 'CARPUS FUND' ? 'CF' : 'HB'}${pad(i + 1, 4)}`, HBEDate: iso(i * 2), TYPE: h[0], NMEOFFUNC: h[1], NETPAY: h[2], CONTACTNO: DEVOTEES[i][2], CONPRS: DEVOTEES[i][0] })
  })
  db.hbe.sort((a, b) => b.HBEID - a.HBEID)

  // ---- Payment and receipt vouchers
  const PAYS = [['Flower purchase for the week', 3200, 9], ['Electricity bill, September', 18450, 12], ['Priest honorarium', 15000, 13], ['Prasadam ingredients', 7800, 10], ['Annadana provisions', 22400, 11], ['Repairs: temple lights', 5600, 14], ['Printing of receipt books', 4300, 15], ['Cleaning supplies', 1850, 14]]
  PAYS.forEach((p, i) => {
    db.payVch.push({ PMTVCHID: 3000 + i + 1, PMTVCHNO: i + 1, PrintPMTVCHNO: `${FY_PREFIX}PV${pad(i + 1, 4)}`, VCHDate: iso(i), VCHTYP: i % 2 ? 'Bank' : 'Cash', NARR: p[0], TOTDR: p[1], TOTCR: p[1], Cancelled: 'N', lines: [{ ac_led_id: p[2], dr_amt: p[1], cr_amt: 0 }, { ac_led_id: i % 2 ? 2 : 1, dr_amt: 0, cr_amt: p[1] }] })
  })
  db.payVch.sort((a, b) => b.PMTVCHID - a.PMTVCHID)
  const RCPTS = [['Bank interest credited', 4120, 7], ['Coconut sale at temple stall', 2600, 4], ['Donation by cheque, Sri Krishna Trust', 25000, 5], ['Hall rent, Upanayana', 30000, 6], ['Seva income, cash deposit', 15800, 4], ['Hall rent advance', 12000, 6], ['Prasadam counter sales', 3900, 4], ['Donation by UPI', 1500, 5]]
  RCPTS.forEach((p, i) => {
    db.rcptVch.push({ RCPTVCHID: 4500 + i + 1, RCPTVCHNO: i + 1, PrintRCPTVCHNO: `${FY_PREFIX}RV${pad(i + 1, 4)}`, VCHDate: iso(i), VCHTYP: i % 3 ? 'Cash' : 'Bank', NARR: p[0], TOTDR: p[1], TOTCR: p[1], Cancelled: 'N', lines: [{ ac_led_id: i % 3 ? 1 : 2, dr_amt: p[1], cr_amt: 0 }, { ac_led_id: p[2], dr_amt: 0, cr_amt: p[1] }] })
  })
  db.rcptVch.sort((a, b) => b.RCPTVCHID - a.RCPTVCHID)

  // ---- Inventory documents
  ;[['Opening stock correction', 42], ['Monthly count adjustment', -6], ['Damaged goods written off', -3]].forEach((s, i) => db.sa.push({ SAID: 800 + i + 1, SANO: i + 1, PrintSANO: `${FY_PREFIX}SA${pad(i + 1, 3)}`, SADate: iso(i * 5), RMKS: s[0], TOTQTY: s[1], LOCID: 1 }))
  ;[['Daily pooja materials', 8], ['Annadana kitchen issue', 60], ['Deepotsava lamps and wicks', 25], ['Festival decoration', 14]].forEach((s, i) => db.si.push({ ISSID: 850 + i + 1, ISSNO: i + 1, PrintISSNO: `${FY_PREFIX}SI${pad(i + 1, 3)}`, ISSDate: iso(i * 3), RMKS: s[0], TOTQTY: s[1], LOCID: i % 3 + 1 }))
  ;[['Sri Lakshmi Traders', 18400], ['Mysore Agarbathi Works', 6200], ['Nandini Dairy Depot', 24900], ['Basavanagudi Flower Market', 3100], ['Sri Venkateshwara Provisions', 31200]].forEach((s, i) => db.pb.push({ PBID: 900 + i + 1, PBNO: i + 1, PrintPBNO: `${FY_PREFIX}PB${pad(i + 1, 3)}`, PBDate: iso(i * 4), PartyName: s[0], PBVALUE: s[1], VCHID: i < 2 ? 5100 + i : 0, SUPPID: i + 1, REFNO: `INV-${2210 + i}` }))
  ;[[900 + 1, 'Sri Lakshmi Traders', 30], [900 + 2, 'Mysore Agarbathi Works', 15]].forEach((s, i) => db.pv.push({ PURVCHID: 950 + i + 1, PURVCHNO: i + 1, PrintPURVCHNO: `${FY_PREFIX}PUV${pad(i + 1, 3)}`, VCHDate: iso(i * 4), CRPERIOD: s[2], PBID: s[0], PartyName: s[1] }))
  ;[['Prasadam Laddu Mix', 4], ['Pongal Pack', 3], ['Pooja Kit', 3]].forEach((s, i) => db.bom.push({ BOMID: 400 + i + 1, BOMNO: i + 1, PrintBOMNO: `${FY_PREFIX}BOM${pad(i + 1, 3)}`, EffFrom: iso(60 - i * 10), FinishedItem: s[0], ITEMID: 4 + i }))

  // ---- Panchanga calendar for the previous, current and next month: the real tithi days (Amavasya, Poornima,
  // Ekadashi, Sankashti Chaturthi) worked out from the actual calendar dates (utils/tithi.js, approximate).
  const TITHI_COLOR = { Ekadashi: '#C0392B', 'Sankashti Chaturthi': '#D4A63F' }
  ;[-1, 0, 1].forEach((mo) => {
    const base = dayjs().add(mo, 'month').startOf('month')
    for (let i = 0; i < base.daysInMonth(); i++) {
      const d = base.add(i, 'day')
      const name = specialDayOf(d.toDate())
      if (name) db.panchanga.push({ date: d.format('YYYY-MM-DD'), name, color: TITHI_COLOR[name] ? oleColor(TITHI_COLOR[name]) : null })
    }
  })

  // ---- Audit trail
  const ENT = ['Seva', 'Donation', 'Hall Booking', 'Payment Voucher', 'Receipt Voucher', 'Seva Master', 'User', 'Role']
  const ACT = [['A', 'Added'], ['M', 'Modified'], ['D', 'Deleted'], ['C', 'Cancelled']]
  const USERS = ['ADMIN', 'SURESH', 'LAKSHMI', 'RAVI', 'MEENA']
  for (let i = 0; i < 48; i += 1) {
    const a = ACT[i % 9 === 8 ? 2 : i % 7 === 6 ? 3 : i % 3 === 2 ? 1 : 0]
    const entity = ENT[(i * 3) % ENT.length]
    db.audit.push({ id: 100 + i, at: stamp(Math.floor(i / 5), 18 - (i % 9), (i * 11) % 60), user_code: USERS[(i * 2) % USERS.length], action: a[0], action_label: a[1], entity, entity_id: String(1000 + i), details: `${a[1]} ${entity} #${1000 + i}`, deleted: a[0] === 'D' })
  }
  db.audit.sort((a, b) => b.at.localeCompare(a.at))
  void pad
  void isoFuture
  return db
}

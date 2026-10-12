// Master tables for the demo database: every simple master the generic MasterPage serves, plus the users and roles
// the Admin Master screen edits. Row shape mirrors the real tables (<ShForm>ID / CODE / NAME + audit columns);
// ID 0 / code '-' is the legacy "none" placeholder row, as in the real data.
import { oleColor, rng, pick, stamp } from './util'

const audit = (i = 0) => ({ AddedBy: 'ADMIN', AddedOn: stamp(120 - (i % 60), 11, 5), ModifiedBy: null, ModifiedOn: null, InActive: 'N', InActiveRmks: '' })

function master(docId, sf, caption, table, names, { fileAttach = false, extra = () => ({}), codeLen = 3, codes } = {}) {
  const rows = [{ [`${sf}ID`]: 0, [`${sf}CODE`]: '-', [`${sf}NAME`]: '-', ...audit(), ...extra(0, null) }]
  names.forEach((n, i) => {
    const code = codes ? codes[i] : n.replace(/[^A-Za-z]/g, '').slice(0, codeLen).toUpperCase() + String(i + 1).padStart(2, '0')
    rows.push({ [`${sf}ID`]: i + 1, [`${sf}CODE`]: code, [`${sf}NAME`]: n, ...audit(i + 1), ...extra(i + 1, n) })
  })
  return {
    meta: { doc_id: docId, table, id_col: `${sf}ID`, code_col: `${sf}CODE`, name_col: `${sf}NAME`, series_col: `${sf}Series`, no_col: `${sf}No`, auth_req: false, caption, short_form: sf, file_attach_req: fileAttach },
    rows,
  }
}

const RASHIS = ['Mesha', 'Vrishabha', 'Mithuna', 'Karkataka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena']
const NAKSHATRAS = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Moola', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati']
const SEVAS = [
  ['Panchamrita Abhisheka', 501], ['Archana', 51], ['Alankara Seva', 1001], ['Hasta Pooja', 251], ['Pavamana Homa', 2101], ['Rathotsava Seva', 1500],
  ['Sarva Seva', 5001], ['Annadana Seva', 3001], ['Kumkumarchana', 101], ['Tulasi Archana', 151], ['Vastra Samarpana', 701], ['Deepotsava', 201],
]

export function buildMasters() {
  const r = rng(11)
  const m = {}
  m[1255] = master(1255, 'SANNIDHI', 'Sannidhi', 'MstSANNIDHI', ['Sri Raghavendra Swamy Brindavana', 'Sri Mukhyaprana Devaru', 'Sri Lakshmi Narasimha', 'Sri Venkateshwara', 'Sri Anjaneya Swamy', 'Navagraha Sannidhi'], { fileAttach: true, codes: ['RAG', 'MUK', 'NAR', 'VEN', 'ANJ', 'NAV'] })
  m[1265] = master(1265, 'SVA', 'Seva', 'MstSVA', SEVAS.map((s) => s[0]), {
    fileAttach: true,
    extra: (i) => (i ? { AMT: SEVAS[i - 1][1], SANNIDHIID: 1 + (i % 6) } : { AMT: 0, SANNIDHIID: 0 }),
  })
  m[1257] = master(1257, 'GOTHRA', 'Gothra', 'MstGOTHRA', ['Bharadvaja', 'Kashyapa', 'Vasishtha', 'Vishvamitra', 'Gautama', 'Atri', 'Jamadagni', 'Agastya', 'Shandilya', 'Harita', 'Kaundinya', 'Kaushika', 'Vatsa', 'Srivatsa'])
  m[1279] = master(1279, 'RASHI', 'Rashi', 'MstRASHI', RASHIS)
  m[1258] = master(1258, 'NAKSHATRA', 'Nakshatra', 'MstNAKSHATRA', NAKSHATRAS, { extra: (i) => ({ RASHIID1: i ? Math.floor(((i - 1) * 12) / 27) + 1 : 0 }) })
  m[1282] = master(1282, 'HALL', 'Hall', 'MstHALL', ['Kalyana Mantapa', 'Bhojanashala (Dining Hall)', 'Keshava Sadana', 'Annapoorna Dhyana Mandira', 'Seva Mantapa'], {
    fileAttach: true,
    extra: (i) => ({ CAPACITY: i ? [400, 250, 80, 120, 150][i - 1] : 0 }),
  })
  const EVENTS = [['Rathotsava', '#C0392B'], ['Raghavendra Aradhane', '#7A1F1F'], ['Hanuma Jayanti', '#D4A63F'], ['Vaikuntha Ekadashi', '#2F6B3A'], ['Ugadi', '#3AA05A'], ['Deepavali', '#E07B16'], ['Navaratri', '#8E44AD'], ['Poornima Special', '#C79A3D']]
  m[1266] = master(1266, 'EVENT', 'Event', 'MstEVENT', EVENTS.map((e) => e[0]), { extra: (i) => ({ CLRCODE: i ? oleColor(EVENTS[i - 1][1]) : -1 }) })
  m[1205] = master(1205, 'LEDGRP', 'Ledger Group', 'MstLEDGRP', ['Cash-in-Hand', 'Bank Accounts', 'Direct Income', 'Indirect Income', 'Direct Expenses', 'Indirect Expenses', 'Current Liabilities'])
  const LEDGERS = [['Cash in Hand', 1], ['State Bank of India A/c', 2], ['Canara Bank A/c', 2], ['Seva Income', 3], ['Donation Income', 3], ['Hall Rent Income', 3], ['Interest Received', 4], ['Security Deposit', 7], ['Flower Expenses', 5], ['Prasadam Expenses', 5], ['Annadana Expenses', 5], ['Electricity Charges', 6], ['Priest Honorarium', 6], ['Repairs and Maintenance', 6], ['Printing and Stationery', 6]]
  m[1204] = master(1204, 'LED', 'Ledger', 'MstLED', LEDGERS.map((l) => l[0]), { extra: (i) => ({ LEDGRPID: i ? LEDGERS[i - 1][1] : 0 }) })
  m[1223] = master(1223, 'BANK', 'Bank', 'MstBANK', ['SBI Raghavendra Nagar', 'Canara Bank Basavanagudi', 'Karnataka Bank Jayanagar', 'HDFC Bank Banashankari'])
  m[1160] = master(1160, 'ROLE', 'Role', 'MstROLE', ['Administrator', 'Counter Staff', 'Accountant', 'Temple Manager', 'Viewer'], { codes: ['ADMIN', 'COUNTER', 'ACCT', 'MGR', 'VIEW'] })
  // Users: the Admin Master "Users" tab reads UserID/UserCode/UserName/RoleID/... directly.
  const USERS = [
    ['ADMIN', 'Administrator', 1, '9845000001', 'admin@sriraghavendramutt.example', 'Administrator', 'N'],
    ['SURESH', 'Suresh Kamath', 2, '9900112201', 'suresh@sriraghavendramutt.example', 'Counter Clerk', 'N'],
    ['LAKSHMI', 'Lakshmi Devi', 2, '9900112202', 'lakshmi@sriraghavendramutt.example', 'Counter Clerk', 'N'],
    ['RAVI', 'Ravi Shankar', 3, '9900112203', 'ravi@sriraghavendramutt.example', 'Accountant', 'N'],
    ['MEENA', 'Meenakshi Rao', 4, '9900112204', 'meena@sriraghavendramutt.example', 'Temple Manager', 'N'],
    ['GIRISH', 'Girish Hegde', 5, '9900112205', '', 'Auditor (view only)', 'N'],
    ['SHARATH', 'Sharath Bhat', 2, '9900112206', '', 'Former counter clerk', 'Y'],
  ]
  m[18] = {
    meta: { doc_id: 18, table: 'MstUser', id_col: 'UserID', code_col: 'UserCode', name_col: 'UserName', series_col: 'UserSeries', no_col: 'UserNo', auth_req: false, caption: 'User', short_form: 'User', file_attach_req: false },
    rows: USERS.map((u, i) => ({ UserID: i + 1, UserCode: u[0], UserName: u[1], RoleID: u[2], Mobileno: u[3], EmailID: u[4], DESIGNATION: u[5], Inactive: u[6], InactiveRmks: u[6] === 'Y' ? 'Left the trust' : '', InActive: u[6], ...audit(i) })),
  }
  // Inventory masters (low usage in the real client, still wired in the UI)
  m[1114] = master(1114, 'ITEM', 'Item', 'MstITEM', ['Cow Ghee', 'Camphor', 'Incense Sticks', 'Marigold Garland', 'Coconut', 'Rice (Sona Masoori)', 'Toor Dal', 'Jaggery', 'Sandalwood Paste', 'Kumkum', 'Cotton Wicks', 'Banana (Bunch)'], { extra: (i) => ({ ITEMGRPNAME: i ? ['Pooja Material', 'Pooja Material', 'Pooja Material', 'Flowers', 'Pooja Material', 'Kitchen', 'Kitchen', 'Kitchen', 'Pooja Material', 'Pooja Material', 'Pooja Material', 'Prasadam'][i - 1] : '' }) })
  m[1115] = master(1115, 'UOM', 'Unit of Measure', 'MstUOM', ['Kg', 'Litre', 'Nos', 'Packet', 'Box', 'Bunch'])
  m[1123] = master(1123, 'LOC', 'Location', 'MstLOC', ['Main Store', 'Pooja Store', 'Kitchen Store'])
  m[1121] = master(1121, 'SUPP', 'Supplier', 'MstSUPP', ['Sri Lakshmi Traders', 'Mysore Agarbathi Works', 'Nandini Dairy Depot', 'Basavanagudi Flower Market', 'Sri Venkateshwara Provisions'])
  void r
  void pick
  return m
}

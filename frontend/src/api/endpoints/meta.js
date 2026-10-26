import { get, post, put } from '../api'

export const getMenu = () => get('/meta/menu')
export const getDocFields = (docId) => get(`/meta/docs/${docId}/fields`)
export const getPrefixes = (docId) => get(`/meta/prefixes/${docId}`)
// `ctx` = the screen's current FldCode values (JSON), used by dependent combos such as Rashi-by-Nakshatra
export const getLookup = (docId, fieldCode, search, ctx) =>
  get(`/meta/lookup/${docId}/${fieldCode}`, { params: { ...(search ? { search } : {}), ...(ctx ? { ctx: JSON.stringify(ctx) } : {}) } })
export const getPickup = (docId, fieldCode, values) => post(`/meta/docs/${docId}/pickup/${fieldCode}`, { values })
export const getLedgers = (search) => get('/meta/ledgers', { params: search ? { search } : undefined })
export const getMenuSettings = () => get('/meta/menu/settings')
export const setMenuVisibility = (menuItemId, show) => put(`/meta/menu/${menuItemId}/visibility`, { show })
export const navigateDoc = (docId, params) => get(`/meta/docs/${docId}/nav`, { params })
export const reloadDesigner = () => post('/meta/reload')
export const getRefill = (docId, fieldCode) => get(`/meta/docs/${docId}/refill/${fieldCode}`)

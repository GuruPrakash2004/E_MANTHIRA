import { get, post } from '../api'

export const listAssets = (params) => get('/assets', { params })
export const getAsset = (id) => get(`/assets/${id}`)
export const createAsset = (body) => post('/assets', body)

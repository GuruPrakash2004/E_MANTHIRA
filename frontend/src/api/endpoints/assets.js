import { get, post, put, del } from '../api'

export const listAssets = (params) => get('/assets', { params })
export const getAsset = (id) => get(`/assets/${id}`)
export const createAsset = (body) => post('/assets', body)
export const updateAsset = (id, body) => put(`/assets/${id}`, body)
export const deleteAsset = (id) => del(`/assets/${id}`)

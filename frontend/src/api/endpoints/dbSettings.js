import { get, post, put } from '../api'

// Deliberately unauthenticated backend routes — reachable before login,
// since no DB connection exists yet to authenticate against. See
// backend/app/core/runtime_db_settings.py.
export const getDbSettings = () => get('/db-settings')
export const testDbSettings = (body) => post('/db-settings/test', body)
export const saveDbSettings = (body) => put('/db-settings', body)
export const listDatabases = (body) => post('/db-settings/databases', body)

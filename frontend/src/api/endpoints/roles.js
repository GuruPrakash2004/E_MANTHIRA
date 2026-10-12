import { get, put } from '../api'

export const getRoleRights = (roleId) => get(`/roles/${roleId}/rights`)
export const saveRoleRights = (roleId, items) => put(`/roles/${roleId}/rights`, items)

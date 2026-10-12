import { put } from '../api'

export const setPassword = (userId, newPassword) => put(`/users/${userId}/password`, { new_password: newPassword })

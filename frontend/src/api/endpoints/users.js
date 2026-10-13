import { api, del, download, get, put } from '../api'

export const setPassword = (userId, newPassword) => put(`/users/${userId}/password`, { new_password: newPassword })
export const formSettings = () => get('/users/form-settings')
export const uploadImage = (userId, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.put(`/users/${userId}/image`, fd).then((r) => r.data)
}
export const deleteImage = (userId) => del(`/users/${userId}/image`)
export const imageBlob = (userId) => download(`/users/${userId}/image`)

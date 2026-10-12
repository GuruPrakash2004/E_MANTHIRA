import { createContext, useContext, useEffect, useState } from 'react'
import * as authApi from '../api/endpoints/auth'
import { clearSession, getAccessToken, setSession } from '../api/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false)
      return
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => clearSession())
      .finally(() => setLoading(false))
  }, [])

  async function login(username, password) {
    const data = await authApi.login(username, password)
    setSession(data)
    setUser({ user_id: null, user_code: data.user_code, user_name: data.user_name, role_id: data.role_id })
    return data
  }

  function logout() {
    clearSession()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

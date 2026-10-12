// Entry/exit for demo mode: sets (or clears) both the demo-mode flag and a
// matching session together, then does a full navigation. A full reload is
// deliberate, not laziness — switching data sources invalidates whatever
// React Query cache and component state are currently in memory (real rows
// mixed with demo rows would be confusing, not helpful), and the token from
// one mode is never valid for the other anyway.
import { setSession, clearSession } from '../api/api'
import { setDemoModeFlag } from './demoMode'
import { DEMO_LOGIN_RESPONSE } from './demo/routes'

export function enterDemoMode() {
  setDemoModeFlag(true)
  setSession(DEMO_LOGIN_RESPONSE)
  window.location.assign('/')
}

export function exitDemoMode() {
  setDemoModeFlag(false)
  clearSession()
  window.location.assign('/login')
}

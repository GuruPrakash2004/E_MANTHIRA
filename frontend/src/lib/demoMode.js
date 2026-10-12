// Whether the app is browsing canned demo data instead of the real backend.
// Pure localStorage flag only — no session/API logic here, so this module
// can be imported from both api.js (to decide whether to intercept a
// request) and from UI/demoAuth.js (to decide what to show) without a
// circular import between api.js and the auth-orchestration module.
const KEY = 'vtemple_demo_mode'

export function isDemoMode() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDemoModeFlag(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // localStorage unavailable (private browsing, etc.) — demo mode just
    // won't persist across reloads, not worth surfacing an error for.
  }
}

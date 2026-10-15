import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, session: null, profile: null, mfa: false })
  // პაროლის აღდგენის ბმულით შემოსვლა → ახალი პაროლის ფორმა
  const [recovery, setRecovery] = useState(() => /type=recovery/.test(location.hash))

  const load = useCallback(async (session) => {
    if (!session) { setState({ loading: false, session: null, profile: null, mfa: false }); return }
    // 2FA: პაროლით შესულს, თუ TOTP ჩართული აქვს, ჯერ კოდი სჭირდება
    let mfa = false
    try { mfa = (await api.mfaState()).needsCode } catch { /* MFA არ არის ხელმისაწვდომი */ }
    try {
      const profile = await api.profile(session.user.id)
      setState({ loading: false, session, profile, mfa })
    } catch {
      setState({ loading: false, session, profile: null, mfa })
    }
  }, [])

  useEffect(() => {
    api.session().then(load)
    return api.onAuth((s, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      load(s)
    })
  }, [load])

  useEffect(() => {
    if (!state.session) return
    api.touch()
    const t = setInterval(() => api.touch(), 120_000)
    return () => clearInterval(t)
  }, [state.session])

  const refresh = useCallback(async () => {
    if (!state.session) return
    const profile = await api.profile(state.session.user.id)
    setState((s) => ({ ...s, profile }))
  }, [state.session])

  const setProfile = useCallback((profile) => setState((s) => ({ ...s, profile })), [])

  return (
    <AuthCtx.Provider value={{ ...state, me: state.profile, refresh, setProfile, recovery, endRecovery: () => setRecovery(false) }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)

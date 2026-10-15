import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// პატარა როუტერი History API-ზე (დამატებითი პაკეტის გარეშე)
const RouterCtx = createContext({ path: '/', query: new URLSearchParams() })

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return
  if (replace) history.replaceState({}, '', to)
  else history.pushState({}, '', to)
  window.dispatchEvent(new Event('ezo:navigate'))
}

export function back(fallback = '/') {
  if ((window.__ezoDepth || 0) > 0) history.back()
  else navigate(fallback, { replace: true })
}

export function RouterProvider({ children }) {
  const read = () => ({ path: location.pathname, query: new URLSearchParams(location.search) })
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    window.__ezoDepth = window.__ezoDepth || 0
    const onNav = () => { window.__ezoDepth++; setLoc(read()); window.scrollTo(0, 0) }
    const onPop = () => { window.__ezoDepth = Math.max(0, window.__ezoDepth - 1); setLoc(read()) }
    window.addEventListener('ezo:navigate', onNav)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('ezo:navigate', onNav)
      window.removeEventListener('popstate', onPop)
    }
  }, [])
  return <RouterCtx.Provider value={loc}>{children}</RouterCtx.Provider>
}

export const useLocation = () => useContext(RouterCtx)

// '/u/:username' → { username }
export function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('/').filter(Boolean)
  if (p.length !== s.length) return null
  const params = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i])
    else if (p[i] !== s[i]) return null
  }
  return params
}

export function Link({ to, children, className, replace, onClick, ...rest }) {
  const handle = useCallback((e) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.button !== 0) return
    e.preventDefault()
    navigate(to, { replace })
  }, [to, replace, onClick])
  return <a href={to} className={className} onClick={handle} {...rest}>{children}</a>
}

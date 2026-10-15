import { useEffect, useRef, useState } from 'react'
import { dayLabel, compact, niceMax } from '../lib/chartmath.js'

// მცირე, დამოუკიდებელი დიაგრამები ადმინის ანალიტიკისთვის (SVG, ბიბლიოთეკის გარეშე).
// ერთი სერია ერთ დიაგრამაზე: ხაზი (ტენდენცია) ან სვეტები (დღიური რაოდენობა). ერთი ღერძი, თხელი ნიშნები,
// ჯვარედინი ხაზი და მინიშნება მაუსით, თითით და ისრებით; ყველა მნიშვნელობა ცხრილშიც ჩანს.

export { dayLabel, compact }

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// სვეტი: ზემოთ მომრგვალებული (4px), ფუძესთან სწორი
function barPath(x, y, w, base) {
  const h = base - y
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`
}

export function TimeChart({ title, data, field, kind = 'line', noun = '', height = 140, endLabel = kind === 'line' }) {
  const box = useRef(null)
  const width = useWidth(box)
  const [hover, setHover] = useState(null)
  const values = data.map((d) => Number(d[field]) || 0)
  const n = values.length
  const max = niceMax(Math.max(0, ...values))
  const pad = { l: 30, r: endLabel ? 30 : 8, t: 10, b: 22 }
  const W = Math.max(width, 160)
  const iw = W - pad.l - pad.r
  const ih = height
  const H = ih + pad.t + pad.b
  const base = pad.t + ih
  const band = n ? iw / n : iw
  const xAt = kind === 'line' ? (i) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1)) : (i) => pad.l + (i + 0.5) * band
  const yAt = (v) => pad.t + ih - (v / max) * ih
  const bw = Math.min(24, Math.max(1, band - 2))

  const pick = (clientX) => {
    const r = box.current.getBoundingClientRect()
    const x = clientX - r.left
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i
    setHover(best)
  }
  const onKey = (e) => {
    if (!n) return
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }
    if (!(e.key in keys)) return
    e.preventDefault()
    const cur = hover ?? n - 1
    const step = keys[e.key]
    setHover(Math.max(0, Math.min(n - 1, Number.isFinite(step) ? cur + step : step < 0 ? 0 : n - 1)))
  }

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('')
  const area = n ? `${line}L${xAt(n - 1).toFixed(1)},${base}L${xAt(0).toFixed(1)},${base}Z` : ''
  const ticks = [0, max / 2, max]
  const xLabels = n ? [...new Set([0, Math.floor((n - 1) / 2), n - 1])] : []
  const last = n - 1
  const total = values.reduce((a, b) => a + b, 0)
  const summary = n ? `${title}: ${dayLabel(data[0].day)} – ${dayLabel(data[last].day)}, სულ ${total}, მაქსიმუმი ${Math.max(...values)}, ბოლო დღე ${values[last]}` : `${title}: მონაცემი არ არის`
  const tipX = hover !== null ? Math.min(Math.max(xAt(hover), 60), W - 60) : 0

  return (
    <figure className="tchart">
      <figcaption>{title}</figcaption>
      <div
        className="tchart-plot"
        ref={box}
        tabIndex={0}
        role="group"
        aria-label={`${summary}. მნიშვნელობების სანახავად გამოიყენე ისრები.`}
        onPointerMove={(e) => n && pick(e.clientX)}
        onPointerDown={(e) => n && pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        style={{ height: H }}
      >
        {width > 0 && (
          <svg width={W} height={H} aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={yAt(t)} y2={yAt(t)} className="tchart-grid" />
                <text x={pad.l - 6} y={yAt(t)} dy="0.32em" textAnchor="end" className="tchart-axis">{compact(t)}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={xAt(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className="tchart-axis"
                dx={i === 0 && kind !== 'line' ? -bw / 2 : i === last && kind !== 'line' ? bw / 2 : 0}>{dayLabel(data[i].day)}</text>
            ))}
            {kind === 'line' ? (
              <>
                <path d={area} className="tchart-area" />
                <path d={line} className="tchart-line" />
                {endLabel && n > 0 && hover === null && (
                  <>
                    <circle cx={xAt(last)} cy={yAt(values[last])} r="4" className="tchart-dot" />
                    <text x={xAt(last) + 8} y={yAt(values[last])} dy="0.32em" className="tchart-end">{compact(values[last])}</text>
                  </>
                )}
              </>
            ) : (
              values.map((v, i) => (
                <path key={i} d={barPath(xAt(i) - bw / 2, yAt(v), bw, base)} className={`tchart-bar${hover !== null && hover !== i ? ' dim' : ''}`} />
              ))
            )}
            <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} className="tchart-base" />
            {hover !== null && (
              <>
                {kind === 'line' && <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={base} className="tchart-cross" />}
                {kind === 'line' && <circle cx={xAt(hover)} cy={yAt(values[hover])} r="4" className="tchart-dot" />}
              </>
            )}
          </svg>
        )}
        {hover !== null && n > 0 && (
          <div className="tchart-tip" style={{ left: tipX }} role="status">
            <b>{values[hover]}</b>{noun && <span> {noun}</span>}
            <small>{dayLabel(data[hover].day)}</small>
          </div>
        )}
      </div>
    </figure>
  )
}

// შეჯამების ბარათი: მნიშვნელობა + ცვლილება წინა პერიოდთან (ისრით და ნიშნით, არა მხოლოდ ფერით)
export function StatTile({ label, value, prev = null, suffix = '' }) {
  let delta = null
  if (prev !== null && prev !== undefined && value !== null && value !== undefined) {
    if (prev > 0) delta = Math.round(((value - prev) / prev) * 100)
    else if (value > 0) delta = null
  }
  return (
    <div className="stile">
      <span className="stile-label">{label}</span>
      <b className="stile-value">{value === null || value === undefined ? '—' : `${compact(value)}${suffix}`}</b>
      {delta !== null && (
        <span className={`stile-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
          {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {delta > 0 ? '+' : ''}{delta}% <span className="faint">წინა პერიოდთან</span>
        </span>
      )}
    </div>
  )
}

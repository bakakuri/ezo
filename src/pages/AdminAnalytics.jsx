import { useEffect, useState } from 'react'
import { Loader } from '../components/ui.jsx'
import { TimeChart, StatTile, dayLabel } from '../components/Charts.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'

// ადმინის ანალიტიკა: ზრდა და აქტიურობა დღეების მიხედვით (თბილისის დროით)
const PERIODS = [[7, '7 დღე'], [30, '30 დღე'], [90, '90 დღე']]

export default function AdminAnalytics() {
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    api.adminAnalytics(days)
      .then((r) => { if (live) setData(r) })
      .catch((e) => { if (live) { toast(e.message, 'error'); setData((d) => d || { days: [], totals: {} }) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [days, toast])

  if (!data) return <Loader />
  const t = data.totals || {}
  const rows = data.days || []
  const stick = t.mau ? Math.round((100 * (t.dau || 0)) / t.mau) : null

  return (
    <section className={`analytics${loading ? ' refetch' : ''}`} aria-busy={loading}>
      <div className="chips admin-filter" role="group" aria-label="პერიოდი">
        {PERIODS.map(([d, l]) => <button key={d} className={`chip${days === d ? ' on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>)}
      </div>

      <div className="stiles">
        <StatTile label="აქტიური დღეს" value={t.dau} />
        <StatTile label="აქტიური 7 დღეში" value={t.wau} />
        <StatTile label="აქტიური 30 დღეში" value={t.mau} />
        <StatTile label="ახალი მომხმარებელი" value={t.signups} prev={t.signups_prev} />
        <StatTile label="პოსტი" value={t.posts} prev={t.posts_prev} />
        <StatTile label="დაბრუნდა 7 დღეში" value={t.retention_7d} suffix="%" />
      </div>
      <p className="analytics-note">სულ {t.users ?? 0} მომხმარებელი.{stick !== null && ` დღიური / თვიური აქტიურობა — ${stick}%.`} „დაბრუნდა“ — 8–14 დღის წინ დარეგისტრირებულებიდან რამდენი შემოვიდა ბოლო კვირაში.</p>

      <TimeChart title="აქტიური მომხმარებლები დღეში" data={rows} field="active" kind="line" noun="აქტიური" height={150} />
      <TimeChart title="ახალი მომხმარებლები დღეში" data={rows} field="signups" kind="bar" noun="ახალი" height={110} />
      <div className="tchart-multiples">
        <TimeChart title="პოსტები" data={rows} field="posts" kind="bar" noun="პოსტი" height={90} />
        <TimeChart title="მესიჯები" data={rows} field="messages" kind="bar" noun="მესიჯი" height={90} />
        <TimeChart title="დასრულებული თამაშები" data={rows} field="games" kind="bar" noun="თამაში" height={90} />
      </div>

      <details className="analytics-table">
        <summary>ცხრილის სახით</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th scope="col">დღე</th><th scope="col">აქტიური</th><th scope="col">ახალი</th><th scope="col">პოსტი</th><th scope="col">პასუხი</th><th scope="col">მესიჯი</th><th scope="col">თამაში</th></tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.day}>
                  <th scope="row">{dayLabel(r.day)}</th>
                  <td>{r.active}</td><td>{r.signups}</td><td>{r.posts}</td><td>{r.replies}</td><td>{r.messages}</td><td>{r.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

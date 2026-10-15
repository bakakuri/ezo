import { useEffect, useState } from 'react'
import { PostCard } from '../components/PostCard.jsx'
import { TopBar, Empty, PostSkeleton, Avatar } from '../components/ui.jsx'
import { useComposer } from '../components/Composer.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'

export default function PostPage({ id }) {
  const { me } = useAuth()
  const { compose } = useComposer()
  const [data, setData] = useState(undefined)

  useEffect(() => {
    setData(undefined)
    api.thread(id).then(setData).catch(() => setData(null))
  }, [id])

  useEffect(() => {
    const onPosted = (e) => {
      const p = e.detail
      if (p.parent_id) setData((d) => (d ? { ...d, replies: [...d.replies, p] } : d))
    }
    window.addEventListener('ezo:posted', onPosted)
    return () => window.removeEventListener('ezo:posted', onPosted)
  }, [])

  const children = (pid) => data?.replies.filter((r) => r.parent_id === pid) || []

  return (
    <>
      <TopBar title="თრედი" backTo="/" />
      {data === undefined && <PostSkeleton n={2} />}
      {data === null && <Empty icon="search" title="პოსტი ვერ მოიძებნა" text="შეიძლება წაშლილია." action={<Link className="btn btn-outline" to="/">მთავარზე</Link>} />}
      {data && (
        <>
          {data.parent && <PostCard key={data.parent.id} post={data.parent} threaded />}
          <PostCard key={data.post.id} post={data.post} focus />
          <div className="composer-inline" onClick={() => compose({ parent: data.post })} role="button" tabIndex={0}>
            <Avatar user={me} size={36} />
            <span className="ph" style={{ paddingTop: 7 }}>უპასუხე @{data.post.author?.username}…</span>
          </div>
          {children(data.post.id).length === 0 && <p className="pad small faint" style={{ textAlign: 'center' }}>პასუხები ჯერ არ არის</p>}
          {children(data.post.id).map((r) => {
            const sub = children(r.id)
            return (
              <div key={r.id}>
                <PostCard post={r} threaded={sub.length > 0} />
                {sub.length > 0 && <PostCard post={sub[0]} />}
                {sub.length > 1 && <Link to={`/p/${r.id}`} className="pad small muted" style={{ display: 'block', paddingTop: 0, paddingLeft: 72, borderBottom: '1px solid var(--line)' }}>კიდევ {sub.length - 1} პასუხი</Link>}
              </div>
            )
          })}
        </>
      )}
    </>
  )
}

import { useEffect, useState } from 'react'
import { Empty, PostSkeleton, TopBar } from '../components/ui.jsx'
import { PostCard } from '../components/PostCard.jsx'
import { useComposer } from '../components/Composer.jsx'
import { api } from '../lib/api.js'

export default function TagPage({ tag }) {
  const t = tag.replace(/^#/, '').toLowerCase()
  const [posts, setPosts] = useState(null)
  const { compose } = useComposer()
  useEffect(() => { setPosts(null); api.tagPosts(t).then(setPosts).catch(() => setPosts([])) }, [t])
  return (
    <>
      <TopBar title={`#${t}`} backTo="/explore" />
      <div className="tag-head">
        <h1>#{t}</h1>
        <p className="small muted">{posts ? `${posts.length} პოსტი` : '…'}</p>
      </div>
      {posts === null && <PostSkeleton n={2} />}
      {posts?.length === 0 && <Empty icon="sparkle" title="ამ თეგით ჯერ არაფერია" action={<button className="btn btn-primary" onClick={() => compose({ prefill: `#${t} ` })}>დაწერე პირველი</button>} />}
      {posts?.map((p) => <PostCard key={p.id} post={p} />)}
    </>
  )
}

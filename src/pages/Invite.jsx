import { useEffect, useState } from 'react'
import { Avatar, Empty, Loader, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { ShareSheet } from '../components/Share.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { useToast } from '../components/Toast.jsx'

// მოწვევის ბმული შესული მომხმარებლისთვის
export default function Invite({ username }) {
  const { me } = useAuth()
  const toast = useToast()
  const [p, setP] = useState(undefined)
  const [rel, setRel] = useState(null)
  const [share, setShare] = useState(false)
  useEffect(() => {
    api.profileByUsername(username).then((x) => {
      setP(x)
      if (x && x.id !== me.id) api.relation(x.id).then(setRel).catch(() => {})
    }).catch(() => setP(null))
  }, [username, me.id])
  if (p === undefined) return <><TopBar title="მოწვევა" backTo="/" /><Loader /></>
  if (p === null) return <><TopBar title="მოწვევა" backTo="/" /><Empty icon="user" title="მომხმარებელი ვერ მოიძებნა" /></>
  const self = p.id === me.id
  const follow = async () => {
    try { const r = await api.follow(p.id, true); setRel((x) => ({ ...x, following: r === 'following', requested: r === 'requested' })); toast(r === 'requested' ? 'თხოვნა გაიგზავნა' : 'გამოიწერე') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <TopBar title="მოწვევა" backTo="/" />
      <section className="invite-hero">
        <Avatar user={p} size={96} />
        <h1>{self ? 'ეს შენი მოწვევის ბმულია' : `${p.full_name || p.username} გეპატიჟება`}</h1>
        <p>{self ? 'გაუგზავნე მეგობრებს — როცა დარეგისტრირდებიან, ერთმანეთს გამოიწერთ და ბროწეულს მიიღებთ.' : p.bio || 'შემოდი, გამოიწერე და ითამაშეთ ერთად.'}</p>
        {self ? (
          <button className="btn btn-accent lg" onClick={() => setShare(true)}><Icon name="share" size={18} />ბმულის გაზიარება</button>
        ) : (
          <div className="hstack" style={{ gap: 8 }}>
            {rel?.following ? <span className="btn btn-soft lg"><Icon name="check" size={18} />გამოწერილია</span>
              : <button className="btn btn-accent lg" onClick={follow}>{rel?.requested ? 'მოთხოვნილია' : 'გამოწერა'}</button>}
            <button className="btn btn-outline lg" onClick={() => navigate(`/u/${p.username}`)}>პროფილი</button>
          </div>
        )}
        {!self && <Link to="/" className="small muted">მთავარ გვერდზე</Link>}
      </section>
      {share && <ShareSheet user={me} invite onClose={() => setShare(false)} />}
    </>
  )
}

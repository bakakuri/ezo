import { lazy as reactLazy, Suspense, useEffect } from 'react'
import { RouterProvider, useLocation, match } from './lib/router.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { ComposerProvider } from './components/Composer.jsx'
import { UnreadProvider, BottomNav, SideNav, Aside } from './components/Shell.jsx'
import { Loader, Empty } from './components/ui.jsx'
import { CallProvider } from './components/Call.jsx'
import { RewardsProvider } from './components/Rewards.jsx'
import { Link } from './lib/router.jsx'
import { DEMO } from './lib/supabase.js'
import AuthPage from './pages/AuthPage.jsx'
import Onboarding from './pages/Onboarding.jsx'
import NewPassword from './pages/NewPassword.jsx'
import MfaPrompt from './pages/MfaPrompt.jsx'
import { InviteClaimer, OfflineBar } from './components/Growth.jsx'
import { InstallBanner } from './components/Install.jsx'
import { prefetchWhenIdle } from './lib/net.js'
import Home from './pages/Home.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

// ახალი ვერსიის გამოსვლის შემდეგ ღია გვერდის ძველი ნაწილები (chunk) აღარ არსებობს — ერთხელ თავიდან ჩავტვირთავთ
const lazy = (load) => reactLazy(() => load().catch((err) => {
  const KEY = 'ezo.chunk-reload'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* */ }
  if (Date.now() - last > 30000) {
    try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* */ }
    window.location.reload()
    return new Promise(() => {})
  }
  throw err
}))

const Explore = lazy(() => import('./pages/Explore.jsx'))
const Reels = lazy(() => import('./pages/Reels.jsx'))
const PostPage = lazy(() => import('./pages/PostPage.jsx'))
const ProfileMod = () => import('./pages/Profile.jsx')
const Profile = lazy(ProfileMod)
const FollowList = lazy(() => ProfileMod().then((m) => ({ default: m.FollowList })))
const Guests = lazy(() => ProfileMod().then((m) => ({ default: m.Guests })))
const Notifications = lazy(() => import('./pages/Notifications.jsx'))
const ChatMod = () => import('./pages/Chat.jsx')
const Inbox = lazy(() => ChatMod().then((m) => ({ default: m.Inbox })))
const ChatRoom = lazy(() => ChatMod().then((m) => ({ default: m.ChatRoom })))
const Dating = lazy(() => import('./pages/Dating.jsx'))
const Games = lazy(() => import('./pages/Games.jsx'))
const RoomMod = () => import('./pages/GameRoom.jsx')
const OnlineGame = lazy(() => RoomMod().then((m) => ({ default: m.OnlineGame })))
const LocalGameRoute = lazy(() => RoomMod().then((m) => ({ default: m.LocalGameRoute })))
const TournamentPage = lazy(() => import('./pages/Tournament.jsx'))
const SocialMod = () => import('./pages/Social.jsx')
const Saved = lazy(() => SocialMod().then((m) => ({ default: m.Saved })))
const FollowRequests = lazy(() => SocialMod().then((m) => ({ default: m.FollowRequests })))
const CloseFriends = lazy(() => SocialMod().then((m) => ({ default: m.CloseFriends })))
const SettingsMod = () => import('./pages/Settings.jsx')
const Settings = lazy(SettingsMod)
const NotificationSettings = lazy(() => SettingsMod().then((m) => ({ default: m.NotificationSettings })))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const GroupsMod = () => import('./pages/Groups.jsx')
const Groups = lazy(GroupsMod)
const GroupPage = lazy(() => GroupsMod().then((m) => ({ default: m.GroupPage })))
const EventsMod = () => import('./pages/Events.jsx')
const Events = lazy(EventsMod)
const EventPage = lazy(() => EventsMod().then((m) => ({ default: m.EventPage })))
const TagPage = lazy(() => import('./pages/TagPage.jsx'))
const Rewards = lazy(() => import('./pages/Rewards.jsx'))
const InvitePage = lazy(() => import('./pages/Invite.jsx'))
const Puzzle = lazy(() => import('./pages/Puzzle.jsx'))
const MarketMod = () => import('./pages/Market.jsx')
const Market = lazy(MarketMod)
const ListingPage = lazy(() => MarketMod().then((m) => ({ default: m.ListingPage })))
const ListingForm = lazy(() => MarketMod().then((m) => ({ default: m.ListingForm })))
const LegalMod = () => import('./pages/Legal.jsx')
const Privacy = lazy(() => LegalMod().then((m) => ({ default: m.Privacy })))
const Terms = lazy(() => LegalMod().then((m) => ({ default: m.Terms })))
// შესვლის გარეშეც ხელმისაწვდომი გვერდები
const PUBLIC = { '/privacy': () => <Privacy />, '/terms': () => <Terms /> }

// მოწვევის ბმულით მოსული (ჯერ შესული არ არის) — დავიმახსოვროთ, რეგისტრაციის შემდეგ გამოვიყენებთ
{
  const inv = typeof location !== 'undefined' && location.pathname.match(/^\/invite\/([a-z0-9_.]{3,24})$/)
  if (inv) try { localStorage.setItem('ezo.invite', inv[1]) } catch { /* */ }
}

// [pattern, render, { full: ეკრანი ნავიგაციის გარეშე, dark: მუქი ქვედა ზოლი }]
const ROUTES = [
  ['/', () => <Home />],
  ['/explore', () => <Explore />],
  ['/reels', () => <Reels />, { flush: true, dark: true, noAside: true }],
  ['/p/:id', (p) => <PostPage key={p.id} id={p.id} />],
  ['/u/:username', (p) => <Profile key={p.username} username={p.username} />],
  ['/u/:username/followers', (p) => <FollowList username={p.username} which="followers" />],
  ['/u/:username/following', (p) => <FollowList username={p.username} which="following" />],
  ['/guests', () => <Guests />],
  ['/notifications', () => <Notifications />],
  ['/inbox', () => <Inbox />],
  ['/chat/:id', (p) => <ChatRoom key={p.id} id={p.id} />, { noNav: true }],
  ['/dating', () => <Dating />],
  ['/games', () => <Games />],
  ['/g/:id', (p) => <OnlineGame key={p.id} id={p.id} />, { noNav: true, noAside: true }],
  ['/play/:type', (p, q) => <LocalGameRoute type={p.type} query={q} />, { noNav: true, noAside: true }],
  ['/t/:id', (p) => <TournamentPage key={p.id} id={p.id} />],
  ['/saved', () => <Saved />],
  ['/requests', () => <FollowRequests />],
  ['/close-friends', () => <CloseFriends />],
  ['/settings', () => <Settings />],
  ['/settings/notifications', () => <NotificationSettings />],
  ['/admin', () => <Admin />],
  ['/groups', () => <Groups />],
  ['/groups/:slug', (p) => <GroupPage key={p.slug} slug={p.slug} />],
  ['/events', () => <Events />],
  ['/events/:id', (p) => <EventPage key={p.id} id={p.id} />],
  ['/tag/:tag', (p) => <TagPage key={p.tag} tag={p.tag} />],
  ['/rewards', () => <Rewards />],
  ['/invite/:username', (p) => <InvitePage key={p.username} username={p.username} />],
  ['/puzzle', () => <Puzzle />],
  ['/market', (p, q) => <Market query={q} />],
  ['/market/new', () => <ListingForm />],
  ['/market/:id', (p) => <ListingPage key={p.id} id={p.id} />],
  ['/market/:id/edit', (p) => <ListingForm key={p.id} id={p.id} />],
  ['/privacy', () => <Privacy />],
  ['/terms', () => <Terms />],
]

function Routes() {
  const { path, query } = useLocation()
  let found = null
  for (const [pattern, render, opts = {}] of ROUTES) {
    const params = match(pattern, path)
    if (params) { found = { el: render(params, query), opts }; break }
  }
  const opts = found?.opts || {}
  return (
    <div className={`app${opts.full ? '' : ' with-side'}`}>
      {!opts.full && <SideNav />}
      <main className={`main${opts.full ? ' full' : ''}${opts.flush ? ' flush' : ''}`} style={opts.noNav ? { paddingBottom: 0 } : undefined}>
        <ErrorBoundary resetKey={path}>
          <Suspense fallback={<Loader />}>
            <div className="page" key={path}>
              {found ? found.el : <Empty icon="search" title="გვერდი ვერ მოიძებნა" action={<Link to="/" className="btn btn-primary">მთავარზე</Link>} />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!opts.full && !opts.noAside && <Aside />}
      {!opts.noNav && !opts.full && <InstallBanner />}
      {!opts.noNav && <BottomNav dark={opts.dark} />}
    </div>
  )
}

function Gate() {
  const { loading, session, me, recovery, mfa } = useAuth()
  const { path } = useLocation()
  // ამ მოწყობილობაზე უკვე შესულა — სტუმრის გვერდზე „შესვლა“ წინ იქნება
  useEffect(() => { if (session) try { localStorage.setItem('ezo.returning', '1') } catch { /* */ } }, [session])
  if (loading) return <Loader />
  if (recovery && session) return <NewPassword />
  if (!session && PUBLIC[path]) {
    return (
      <main className="main full">
        <ErrorBoundary resetKey={path}><Suspense fallback={<Loader />}>{PUBLIC[path]()}</Suspense></ErrorBoundary>
      </main>
    )
  }
  if (!session) return <AuthPage />
  if (mfa) return <MfaPrompt />
  if (!me) return <Loader />
  if (!me.onboarded) return <Onboarding />
  return <SignedIn />
}

// შესული მომხმარებელი: ხშირი გვერდების კოდი ფონზე ჩამოიტვირთება (კარგ ინტერნეტზე), რომ გადასვლა მყისიერი იყოს
function SignedIn() {
  useEffect(() => prefetchWhenIdle([
    () => import('./pages/Notifications.jsx'), ChatMod, ProfileMod, () => import('./pages/Explore.jsx'),
    () => import('./pages/Games.jsx'), () => import('./pages/Reels.jsx'), () => import('./pages/PostPage.jsx'),
  ]), [])
  return (
    <UnreadProvider>
      <RewardsProvider>
        <InviteClaimer />
        <ComposerProvider>
          <CallProvider>
            <Routes />
          </CallProvider>
        </ComposerProvider>
      </RewardsProvider>
    </UnreadProvider>
  )
}

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          {DEMO && <div className="demo-banner">დემო რეჟიმი</div>}
          <OfflineBar />
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  )
}

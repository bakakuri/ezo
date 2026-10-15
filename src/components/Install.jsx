import { useState } from 'react'
import { Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { useToast } from './Toast.jsx'
import { useInstall, promptInstall, bannerWanted, snoozeBanner } from '../lib/install.js'
import { useLocation } from '../lib/router.jsx'

const mobile = () => typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)

// დაყენების ღილაკის საერთო ლოგიკა: Chrome-ზე სისტემური ფანჯარა, iPhone-ზე ინსტრუქცია
function useInstallAction(onDone) {
  const state = useInstall()
  const toast = useToast()
  const [ios, setIos] = useState(false)
  const run = async () => {
    if (state === 'ios') { setIos(true); return }
    const r = await promptInstall()
    if (r === 'accepted') { toast('ეზო დაყენდა — მთავარ ეკრანზე ნახავ'); onDone?.() }
  }
  const sheet = ios ? <IosSheet onClose={() => setIos(false)} /> : null
  return { state, run, sheet }
}

// ქვემოთ, ნავიგაციის ზემოთ — მეორე ვიზიტიდან; „არა ახლა“ — 14 დღე აღარ ჩანს
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => !bannerWanted())
  const { state, run, sheet } = useInstallAction(() => setHidden(true))
  const { path } = useLocation()
  // პარამეტრებში ცალკე ღილაკი აქვს
  const show = !hidden && (state === 'prompt' || state === 'ios') && !path.startsWith('/settings')
  if (!show && !sheet) return null
  const close = () => { snoozeBanner(); setHidden(true) }
  return (
    <>
      {show && (
        <aside className="install-banner" aria-label="ეზოს დაყენება">
          <img src="/icon-192.png" alt="" width="44" height="44" />
          <div className="grow">
            <b>დააყენე ეზო</b>
            <p>{state === 'ios' ? 'მთავარ ეკრანზე — შეტყობინებებიც მოვა.' : mobile() ? 'ტელეფონზე, სრულ ეკრანზე — როგორც აპი.' : 'ცალკე ფანჯარაში, როგორც აპი.'}</p>
          </div>
          <button type="button" className="btn btn-primary sm" onClick={run}>დაყენება</button>
          <button type="button" className="install-x" onClick={close} aria-label="არა ახლა"><Icon name="close" size={16} /></button>
        </aside>
      )}
      {sheet}
    </>
  )
}

// პარამეტრებში — ყოველთვის, სანამ დაყენებული არაა
export function InstallRow() {
  const { state, run, sheet } = useInstallAction()
  if (state !== 'prompt' && state !== 'ios') return null
  return (
    <>
      <button type="button" className="setting-row" onClick={run}>
        <Icon name="download" />
        <div className="grow">დააყენე ეზო{mobile() ? ' ტელეფონზე' : ''}<small>{state === 'ios' ? 'მთავარ ეკრანზე დამატება — iPhone-ზე შეტყობინებებიც ასე მოდის' : 'სრულ ეკრანზე, როგორც აპი, ხატულით'}</small></div>
      </button>
      {sheet}
    </>
  )
}

function IosSheet({ onClose }) {
  return (
    <Sheet title="ეზო მთავარ ეკრანზე" onClose={onClose}>
      <div className="sheet-body">
        <ol className="ios-steps">
          <li>ბრაუზერის ზოლში დააჭირე <span className="nowrap"><b>გაზიარებას</b> <span className="ios-ico" aria-hidden="true"><Icon name="share" size={17} /></span></span></li>
          <li>ჩამოსქროლე და აირჩიე <b>„Add to Home Screen“</b> (მთავარ ეკრანზე დამატება).</li>
          <li>დააჭირე <b>„Add“</b> — ეზოს ხატულა მთავარ ეკრანზე გამოჩნდება.</li>
        </ol>
        <p className="small muted">მერე ეზო იქიდან გახსენი: სრულ ეკრანზე იმუშავებს და შეტყობინებების ჩართვაც შეგეძლება (iOS 16.4 და ახალი).</p>
        <button type="button" className="btn btn-primary lg block" onClick={onClose}>გასაგებია</button>
      </div>
    </Sheet>
  )
}

import { useState } from 'react'
import { Sheet } from './ui.jsx'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'

export const REPORT_CATEGORIES = [
  ['spam', 'სპამი ან რეკლამა'],
  ['abuse', 'შეურაცხყოფა ან მუქარა'],
  ['hate', 'სიძულვილის ენა'],
  ['nudity', 'შიშველი ან სექსუალური კონტენტი'],
  ['violence', 'ძალადობა'],
  ['fake', 'ყალბი პროფილი ან თაღლითობა'],
  ['minor', 'არასრულწლოვანი გაცნობაში'],
  ['other', 'სხვა'],
]
// ბაზრის განცხადებისთვის
export const LISTING_REPORT_CATEGORIES = [
  ['fake', 'თაღლითობა ან ყალბი ნივთი'],
  ['prohibited', 'აკრძალული ნივთი ან მომსახურება'],
  ['spam', 'სპამი ან განმეორებითი განცხადება'],
  ['abuse', 'შეურაცხმყოფელი შინაარსი'],
  ['other', 'სხვა'],
]
export const categoryName = (k) => [...REPORT_CATEGORIES, ['prohibited', 'აკრძალული ნივთი']].find((c) => c[0] === k)?.[1] || k

export function ReportSheet({ user = null, post = null, listing = null, onClose }) {
  const toast = useToast()
  const [cat, setCat] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      await api.report({ user, post, listing, category: cat, reason: note.trim() })
      toast('მადლობა — მოდერატორი განიხილავს')
      onClose()
    } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title={listing ? 'განცხადების დარეპორტება' : post ? 'პოსტის დარეპორტება' : 'პროფილის დარეპორტება'} onClose={onClose}>
      <div className="sheet-body vstack" style={{ gap: 14 }}>
        <p className="small muted">რა არის პრობლემა? დამრღვევი ვერ გაიგებს, ვინ დაარეპორტა.</p>
        <div className="vstack" style={{ gap: 6 }}>
          {(listing ? LISTING_REPORT_CATEGORIES : REPORT_CATEGORIES).map(([k, l]) => (
            <label key={k} className="hstack" style={{ padding: '6px 0', cursor: 'pointer' }}>
              <input type="radio" name="report" checked={cat === k} onChange={() => setCat(k)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
              <span>{l}</span>
            </label>
          ))}
        </div>
        {cat && <textarea className="textarea" maxLength={500} placeholder="დეტალები (არასავალდებულო)" value={note} onChange={(e) => setNote(e.target.value)} />}
        <button className="btn btn-accent lg block" disabled={!cat || busy} onClick={send}>გაგზავნა</button>
      </div>
    </Sheet>
  )
}

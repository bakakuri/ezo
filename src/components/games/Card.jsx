import { isJoker, rankOf, suitOf, RANK_LABEL, SUIT_NAME } from '../../games/cards.js'

// მასტები SVG-ით — ყველა ტელეფონზე ერთნაირად ჩანს (შრიფტზე არ არის დამოკიდებული)
const SUIT_PATH = {
  h: 'M12 21.3s-7.6-4.7-9.7-9.3C.8 8.7 2.9 4.4 6.7 4.4c2.2 0 3.7 1.3 5.3 3.4 1.6-2.1 3.1-3.4 5.3-3.4 3.8 0 5.9 4.3 4.4 7.6-2.1 4.6-9.7 9.3-9.7 9.3z',
  d: 'M12 1.8 20.6 12 12 22.2 3.4 12z',
  s: 'M12 1.8C9 6.4 2.8 9.4 2.8 14c0 2.9 2.2 4.8 4.7 4.8 1.6 0 2.8-.6 3.5-1.6-.3 2-1.1 3.6-2.6 5h7.2c-1.5-1.4-2.3-3-2.6-5 .7 1 1.9 1.6 3.5 1.6 2.5 0 4.7-1.9 4.7-4.8 0-4.6-6.2-7.6-9.2-12.2z',
  c: 'M12 2.2a4.4 4.4 0 0 0-4.2 5.8 4.4 4.4 0 1 0 2.9 8c-.3 2.4-1.1 4.2-2.7 5.7h8c-1.6-1.5-2.4-3.3-2.7-5.7a4.4 4.4 0 1 0 2.9-8A4.4 4.4 0 0 0 12 2.2z',
}

export function Suit({ s, className = '', title }) {
  return (
    <svg viewBox="0 0 24 24" className={`suit ${s === 'h' || s === 'd' ? 'red' : 'blk'} ${className}`} aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined} aria-label={title}>
      <path d={SUIT_PATH[s]} />
    </svg>
  )
}

const STAR = 'M50 4 61 27 86 18 77 43 98 50 77 57 86 82 61 73 50 96 39 73 14 82 23 57 2 50 23 43 14 18 39 27z'

export function cardLabel(c) {
  if (!c) return 'დახურული კარტი'
  if (isJoker(c)) return c === 'X1' ? 'წითელი ჯოკერი' : 'შავი ჯოკერი'
  return `${RANK_LABEL[rankOf(c)]} ${SUIT_NAME[suitOf(c)]}`
}

// size: xs | sm | md | lg
export function Card({ c, size = 'md', className = '', style, ...rest }) {
  if (!c) return <span className={`pcard back ${size} ${className}`} style={style} aria-label="დახურული კარტი" {...rest}><i /></span>
  if (isJoker(c)) {
    const red = c === 'X1'
    return (
      <span className={`pcard face joker ${red ? 'red' : 'blk'} ${size} ${className}`} style={style} aria-label={cardLabel(c)} {...rest}>
        <span className="jk-idx">ჯოკ</span>
        <svg viewBox="0 0 100 100" className="jk-star" aria-hidden="true"><path d={STAR} /><circle cx="50" cy="50" r="13" /></svg>
        <span className="jk-idx br">ჯოკ</span>
      </span>
    )
  }
  const r = rankOf(c)
  const s = suitOf(c)
  const label = RANK_LABEL[r]
  const face = r >= 11 && r <= 13
  return (
    <span className={`pcard face ${s === 'h' || s === 'd' ? 'red' : 'blk'} ${size} ${className}`} style={style} aria-label={cardLabel(c)} {...rest}>
      <span className="idx"><b>{label}</b><Suit s={s} /></span>
      <span className={`mid${face ? ' face-l' : ''}`}>
        {face ? <><b>{label}</b><Suit s={s} /></> : <Suit s={s} />}
      </span>
      <span className="idx br"><b>{label}</b><Suit s={s} /></span>
    </span>
  )
}

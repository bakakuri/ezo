import { Piece } from './ChessBoard.jsx'
import { Die } from './NardiBoard.jsx'
import { Tile } from './DominoTable.jsx'
import { Card } from './Card.jsx'

// თამაშის პატარა „ნიმუში“ — მასალით: ხე, ძვალი, მაუდი, კარტი
export function Swatch({ type }) {
  return (
    <span className={`swatch sw-${type}`} aria-hidden="true">
      {type === 'nardi' && <span className="hstack" style={{ gap: 4, transform: 'scale(.62)' }}><Die n={6} /><Die n={5} /></span>}
      {type === 'longnardi' && <span className="ln-stack"><i /><i /><i /><i /></span>}
      {type === 'chess' && <Piece p="N" className="" />}
      {type === 'checkers' && <span className="disc w" style={{ width: 40, height: 40 }} />}
      {type === 'domino' && <span style={{ transform: 'rotate(-18deg)' }}><Tile a={6} b={4} v /></span>}
      {type === 'durak' && <span className="sw-cards"><Card c="6s" size="xs" /><Card c="Kh" size="xs" /></span>}
      {type === 'joker' && <span className="sw-cards"><Card c="Ad" size="xs" /><Card c="X1" size="xs" /></span>}
      {type === 'bura' && <span className="sw-cards three"><Card c="Kd" size="xs" /><Card c="Td" size="xs" /><Card c="Ad" size="xs" /></span>}
      {type === 'loto' && <span className="sw-keg"><b>90</b></span>}
    </span>
  )
}

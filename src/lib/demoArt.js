// დემო რეჟიმის ილუსტრაციები (SVG), რომ აპი ქსელის გარეშეც ცოცხლად ჩანდეს.

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PALETTES = [
  ['#1d2b53', '#7e2553', '#ff6f59', '#ffd29d', '#f7f3e3'],
  ['#0f3d3e', '#2c7a73', '#9fd3c7', '#f2e8cf', '#e76f51'],
  ['#2b193d', '#5c2a6b', '#c3183f', '#f4a259', '#fce9d0'],
  ['#14213d', '#3a5a8c', '#8fb3de', '#e5ecf4', '#fca311'],
  ['#3d2c1e', '#7a4e2d', '#c9a27a', '#efe1c6', '#9e1b32'],
]

const enc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

function ridge(r, y, amp, w, h) {
  let d = `M0 ${h} L0 ${y}`
  let x = 0
  while (x < w) {
    const nx = x + 60 + r() * 140
    const ny = y - r() * amp
    d += ` L${nx.toFixed(0)} ${ny.toFixed(0)}`
    x = nx
  }
  return `${d} L${w} ${h} Z`
}

function mountains(r, p, w, h) {
  const sunY = h * (0.25 + r() * 0.15)
  return `
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${p[1]}"/><stop offset=".6" stop-color="${p[3]}"/><stop offset="1" stop-color="${p[4]}"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#s)"/>
  <circle cx="${w * (0.3 + r() * 0.4)}" cy="${sunY}" r="${w * 0.09}" fill="${p[4]}" opacity=".9"/>
  <path d="${ridge(r, h * 0.55, h * 0.18, w, h)}" fill="${p[2]}" opacity=".55"/>
  <path d="${ridge(r, h * 0.68, h * 0.15, w, h)}" fill="${p[1]}" opacity=".8"/>
  <path d="${ridge(r, h * 0.8, h * 0.1, w, h)}" fill="${p[0]}"/>`
}

function city(r, p, w, h) {
  let houses = ''
  let x = -20
  const base = h * 0.78
  while (x < w) {
    const hw = 110 + r() * 120
    const hh = 220 + r() * 380
    const c = p[1 + Math.floor(r() * 4)]
    houses += `<rect x="${x}" y="${base - hh}" width="${hw}" height="${hh}" fill="${c}"/>`
    houses += `<path d="M${x - 8} ${base - hh} L${x + hw / 2} ${base - hh - 50 - r() * 40} L${x + hw + 8} ${base - hh} Z" fill="${p[0]}" opacity=".85"/>`
    for (let wy = base - hh + 40; wy < base - 60; wy += 90) {
      houses += `<rect x="${x + 18}" y="${wy}" width="${hw - 36}" height="10" fill="${p[0]}" opacity=".5"/>`
      for (let wx = x + 22; wx < x + hw - 40; wx += 42) houses += `<rect x="${wx}" y="${wy - 40}" width="22" height="34" rx="11" fill="${p[0]}" opacity=".7"/>`
    }
    x += hw + 6
  }
  return `<rect width="${w}" height="${h}" fill="${p[4]}"/>
  <circle cx="${w * 0.78}" cy="${h * 0.18}" r="${w * 0.07}" fill="${p[3]}"/>
  ${houses}
  <rect y="${base}" width="${w}" height="${h - base}" fill="${p[0]}"/>
  <rect y="${base + 40}" width="${w}" height="6" fill="${p[3]}" opacity=".4"/>
  <rect y="${base + 90}" width="${w * 0.7}" height="4" fill="${p[3]}" opacity=".3"/>`
}

function still(r, p, w, h) {
  let fruit = ''
  const n = 3 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const cx = w * (0.18 + (i / n) * 0.7 + r() * 0.05)
    const cy = h * (0.62 + r() * 0.08)
    const rad = 90 + r() * 70
    fruit += `<ellipse cx="${cx}" cy="${cy + rad * 0.9}" rx="${rad}" ry="${rad * 0.2}" fill="#000" opacity=".18"/>
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="#9e1b32"/>
    <circle cx="${cx - rad * 0.35}" cy="${cy - rad * 0.35}" r="${rad * 0.28}" fill="#fff" opacity=".18"/>
    <path d="M${cx - 22} ${cy - rad + 6} l10 -34 l12 22 l12 -22 l10 34 Z" fill="#6b0f22"/>`
  }
  return `<rect width="${w}" height="${h}" fill="${p[3]}"/>
  <rect y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="${p[2]}"/>
  <rect y="${h * 0.6}" width="${w}" height="8" fill="${p[0]}" opacity=".25"/>
  ${fruit}`
}

function sea(r, p, w, h) {
  let bands = ''
  for (let y = h * 0.55; y < h; y += 26 + r() * 30) {
    bands += `<rect x="${r() * w * 0.3}" y="${y}" width="${w * (0.4 + r() * 0.6)}" height="${4 + r() * 6}" rx="3" fill="${p[4]}" opacity="${0.15 + r() * 0.3}"/>`
  }
  return `<defs><linearGradient id="k" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#k)"/>
  <circle cx="${w / 2}" cy="${h * 0.52}" r="${w * 0.12}" fill="${p[4]}"/>
  <rect y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="${p[0]}"/>
  ${bands}`
}

function vine(r, p, w, h) {
  let g = ''
  for (let i = 0; i < 9; i++) {
    const cx = r() * w
    const cy = r() * h
    for (let k = 0; k < 14; k++) {
      g += `<circle cx="${cx + (r() - 0.5) * 120}" cy="${cy + k * 18 + r() * 10}" r="${22 - k}" fill="${i % 2 ? '#5b3a70' : '#2b193d'}"/>`
    }
    g += `<path d="M${cx} ${cy - 60} q60 -80 140 -30 q-40 70 -140 30 Z" fill="#3f7d3a"/>`
  }
  return `<rect width="${w}" height="${h}" fill="${p[3]}"/>${g}`
}

const KINDS = { mountains, city, still, sea, vine }

export function art(seed, kind, tall = false) {
  const r = rng(seed * 9973 + 17)
  const p = PALETTES[seed % PALETTES.length]
  const w = 1080
  const h = tall ? 1920 : 1350
  const draw = KINDS[kind] || KINDS[Object.keys(KINDS)[seed % 5]]
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${draw(r, p, w, h)}</svg>`)
}

// ---- ბაზრის დემო ფოტოები: ნივთები „სტუდიურ“ ფონზე (1080×1080)
const PP = [
  ['#f6e8ee', '#e6ecfb', '#df1f52', '#8a35e8', '#1d1a2b', '#ffffff'],
  ['#e6f4ee', '#fbf1df', '#0f9d8a', '#f4a259', '#173d3a', '#fffaf0'],
  ['#fbefe4', '#efe6fb', '#c77d12', '#6d4ad8', '#3a2614', '#fff8ef'],
  ['#e7eefa', '#f9e8ee', '#3a6df0', '#ff6f59', '#14213d', '#f7fbff'],
  ['#f2eee6', '#e3efee', '#7a4e2d', '#2c7a73', '#2b2118', '#fffdf8'],
]
const ITEMS = {
  phone: (p) => `<g transform="rotate(-9 540 520)"><rect x="392" y="170" width="296" height="640" rx="56" fill="${p[4]}"/>
    <rect x="410" y="188" width="260" height="604" rx="42" fill="url(#g)"/><rect x="496" y="204" width="88" height="24" rx="12" fill="${p[4]}"/>
    <circle cx="540" cy="470" r="70" fill="${p[5]}" opacity=".25"/><rect x="460" y="700" width="160" height="10" rx="5" fill="${p[5]}" opacity=".6"/></g>`,
  bike: (p) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="320" cy="640" r="150" stroke="${p[4]}" stroke-width="24"/><circle cx="760" cy="640" r="150" stroke="${p[4]}" stroke-width="24"/>
    <circle cx="320" cy="640" r="18" fill="${p[4]}"/><circle cx="760" cy="640" r="18" fill="${p[4]}"/>
    <path d="M320 640 540 640 465 395 320 640M465 395 700 395 540 640M700 395 760 640" stroke="${p[2]}" stroke-width="26"/>
    <path d="M700 395 690 330 755 320" stroke="${p[4]}" stroke-width="20"/><path d="M425 375h90" stroke="${p[4]}" stroke-width="26"/>
    <circle cx="540" cy="640" r="34" stroke="${p[3]}" stroke-width="14"/></g>`,
  sofa: (p) => `<rect x="250" y="350" width="580" height="230" rx="56" fill="${p[2]}" opacity=".8"/>
    <rect x="200" y="510" width="680" height="170" rx="44" fill="${p[2]}"/>
    <rect x="160" y="440" width="130" height="250" rx="56" fill="${p[2]}"/><rect x="790" y="440" width="130" height="250" rx="56" fill="${p[2]}"/>
    <rect x="300" y="460" width="230" height="90" rx="34" fill="${p[5]}" opacity=".35"/><rect x="550" y="460" width="230" height="90" rx="34" fill="${p[5]}" opacity=".35"/>
    <rect x="220" y="690" width="26" height="60" rx="8" fill="${p[4]}"/><rect x="834" y="690" width="26" height="60" rx="8" fill="${p[4]}"/>
    <rect x="610" y="390" width="150" height="110" rx="30" fill="${p[3]}" transform="rotate(-10 685 445)"/>`,
  guitar: (p) => `<g transform="rotate(-22 540 540)"><rect x="512" y="120" width="56" height="440" rx="10" fill="${p[4]}"/>
    <rect x="496" y="80" width="88" height="110" rx="20" fill="${p[4]}"/>
    <circle cx="540" cy="560" r="130" fill="${p[2]}"/><circle cx="540" cy="760" r="185" fill="${p[2]}"/>
    <circle cx="540" cy="610" r="52" fill="${p[4]}"/><rect x="470" y="770" width="140" height="28" rx="8" fill="${p[4]}"/>
    <path d="M528 190v600M540 190v600M552 190v600" stroke="${p[5]}" stroke-width="3" opacity=".8"/></g>`,
  camera: (p) => `<rect x="300" y="300" width="190" height="110" rx="28" fill="${p[4]}"/>
    <rect x="230" y="370" width="620" height="400" rx="64" fill="${p[4]}"/>
    <rect x="230" y="470" width="620" height="200" fill="${p[2]}" opacity=".9"/>
    <circle cx="540" cy="570" r="170" fill="#2a2733"/><circle cx="540" cy="570" r="130" fill="url(#g)"/>
    <circle cx="540" cy="570" r="70" fill="#15131c"/><circle cx="500" cy="530" r="20" fill="#fff" opacity=".7"/>
    <rect x="720" y="400" width="80" height="40" rx="12" fill="${p[3]}"/>`,
  car: (p) => `<path d="M190 640q0-80 80-92l110-12q70-110 180-110h120q80 0 140 110l60 16q30 10 30 55v40q0 20-20 20H210q-20 0-20-20z" fill="${p[2]}"/>
    <path d="M410 535q55-80 145-80h40v80zM625 455h50q70 6 115 80H625z" fill="${p[5]}" opacity=".85"/>
    <circle cx="330" cy="670" r="74" fill="${p[4]}"/><circle cx="330" cy="670" r="32" fill="#c9c6d2"/>
    <circle cx="770" cy="670" r="74" fill="${p[4]}"/><circle cx="770" cy="670" r="32" fill="#c9c6d2"/>
    <rect x="860" y="585" width="40" height="22" rx="8" fill="${p[3]}"/>`,
  lamp: (p) => `<path d="M410 230h260l90 230H320z" fill="${p[2]}"/><path d="M410 230h260l20 50H390z" fill="${p[5]}" opacity=".3"/>
    <rect x="525" y="460" width="30" height="300" rx="10" fill="${p[4]}"/><ellipse cx="540" cy="770" rx="150" ry="36" fill="${p[4]}"/>
    <circle cx="540" cy="470" r="40" fill="${p[3]}" opacity=".7"/>`,
  sneakers: (p) => `<path d="M200 650q0-130 110-150l150-36q50 60 140 60 120 0 200 66 60 40 60 80v30H200z" fill="${p[2]}"/>
    <rect x="190" y="660" width="680" height="54" rx="27" fill="${p[5]}"/><rect x="190" y="700" width="680" height="16" rx="8" fill="${p[4]}" opacity=".3"/>
    <path d="M470 500l40 40M520 488l40 40M570 482l40 40" stroke="${p[5]}" stroke-width="16" stroke-linecap="round"/>
    <path d="M640 600q100 0 180 40" stroke="${p[3]}" stroke-width="26" fill="none" stroke-linecap="round"/>`,
  books: (p) => `<rect x="280" y="640" width="520" height="90" rx="14" fill="${p[2]}"/><rect x="310" y="560" width="470" height="80" rx="14" fill="${p[3]}" transform="rotate(-3 545 600)"/>
    <rect x="270" y="470" width="500" height="90" rx="14" fill="${p[4]}" transform="rotate(2 520 515)"/><rect x="330" y="390" width="430" height="80" rx="14" fill="${p[2]}" opacity=".75" transform="rotate(-4 545 430)"/>
    <path d="M300 685h480M330 600h430M300 515h440" stroke="${p[5]}" stroke-width="8" opacity=".5"/>`,
  plant: (p) => `<ellipse cx="420" cy="380" rx="70" ry="150" fill="#2f8f5b" transform="rotate(-35 420 380)"/>
    <ellipse cx="660" cy="370" rx="70" ry="160" fill="#2f8f5b" transform="rotate(32 660 370)"/>
    <ellipse cx="540" cy="300" rx="80" ry="180" fill="#3fae6f"/><ellipse cx="460" cy="500" rx="60" ry="120" fill="#3fae6f" transform="rotate(-60 460 500)"/>
    <ellipse cx="630" cy="500" rx="60" ry="120" fill="#2f8f5b" transform="rotate(60 630 500)"/>
    <path d="M420 590h240l-30 210H450z" fill="${p[2]}"/><rect x="405" y="570" width="270" height="44" rx="14" fill="${p[4]}"/>`,
  apartment: (p) => `<rect x="300" y="200" width="480" height="610" rx="12" fill="${p[2]}"/>
    ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => `<rect x="${345 + c * 140}" y="${240 + r * 100}" width="90" height="64" rx="10" fill="${p[5]}" opacity="${(r + c) % 3 ? 0.85 : 0.45}"/>`).join('')).join('')}
    <rect x="300" y="420" width="480" height="14" fill="${p[4]}" opacity=".4"/><rect x="495" y="730" width="90" height="80" rx="10" fill="${p[4]}"/>
    <circle cx="230" cy="700" r="80" fill="#3fae6f"/><rect x="222" y="700" width="16" height="110" fill="${p[4]}"/>`,
  headphones: (p) => `<path d="M330 600V520a210 210 0 0 1 420 0v80" fill="none" stroke="${p[4]}" stroke-width="44" stroke-linecap="round"/>
    <rect x="270" y="560" width="130" height="220" rx="56" fill="${p[2]}"/><rect x="680" y="560" width="130" height="220" rx="56" fill="${p[2]}"/>
    <rect x="300" y="590" width="70" height="160" rx="35" fill="${p[5]}" opacity=".25"/><rect x="710" y="590" width="70" height="160" rx="35" fill="${p[5]}" opacity=".25"/>`,
  console: (p) => `<rect x="380" y="200" width="320" height="560" rx="36" fill="${p[5]}"/><rect x="380" y="200" width="320" height="560" rx="36" fill="none" stroke="${p[4]}" stroke-width="10" opacity=".25"/>
    <circle cx="540" cy="300" r="80" fill="${p[4]}"/><circle cx="540" cy="300" r="56" fill="#2a2733"/>
    <path d="M470 430h140M470 455h140M470 480h140" stroke="${p[4]}" stroke-width="8" opacity=".25"/>
    <path d="M250 640q0-60 70-60h160q70 0 70 60l30 120q10 50-40 50-30 0-50-40l-20-40H320l-20 40q-20 40-50 40-50 0-40-50z" fill="${p[4]}"/>
    <circle cx="340" cy="650" r="16" fill="${p[2]}"/><circle cx="470" cy="640" r="12" fill="${p[3]}"/><circle cx="500" cy="670" r="12" fill="${p[2]}"/>`,
  jacket: (p) => `<path d="M420 210l120 60 120-60 150 70 70 330-80 20-40-180v380H320V450l-40 180-80-20 70-330z" fill="${p[4]}"/>
    <path d="M540 270v560" stroke="${p[5]}" stroke-width="8" opacity=".5"/><path d="M420 210l120 140 120-140" fill="none" stroke="${p[2]}" stroke-width="20"/>
    <rect x="370" y="560" width="90" height="18" rx="9" fill="${p[5]}" opacity=".4"/><rect x="620" y="560" width="90" height="18" rx="9" fill="${p[5]}" opacity=".4"/>`,
}

export function product(seed, kind) {
  const p = PP[seed % PP.length]
  const draw = ITEMS[kind] || ITEMS.phone
  const tilt = (seed * 37) % 360
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="b" gradientTransform="rotate(${tilt} .5 .5)"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/></linearGradient>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient>
  <radialGradient id="f" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${p[4]}" stop-opacity=".28"/><stop offset="1" stop-color="${p[4]}" stop-opacity="0"/></radialGradient></defs>
  <rect width="1080" height="1080" fill="url(#b)"/><rect y="800" width="1080" height="280" fill="${p[4]}" opacity=".04"/>
  <ellipse cx="540" cy="830" rx="380" ry="60" fill="url(#f)"/>${draw(p)}</svg>`)
}

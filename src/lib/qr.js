// QR კოდის გენერატორი (ISO/IEC 18004, მოდელი 2): ბაიტური რეჟიმი (UTF-8), შეცდომის გასწორება M, ვერსიები 1–10.
// დამოკიდებულებების გარეშე — პროფილის/მოწვევის ბმულისთვის და 2FA-ს დემოსთვის საკმარისია.
const RAW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346] // კოდური სიტყვები ვერსიაზე
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] // ბლოკები (M)
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] // EC სიტყვები ბლოკზე (M)
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

const utf8 = (s) => Array.from(new TextEncoder().encode(s))

function encodeData(bytes, version) {
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = (RAW[version] - ECC[version] * BLOCKS[version]) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const out = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  return out
}

function interleave(data, version) {
  const numBlocks = BLOCKS[version]
  const ecLen = ECC[version]
  const raw = RAW[version]
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const div = rsDivisor(ecLen)
  const blocks = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= numShort) result.push(b[i]) })
  }
  return result
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function build(version, codewords, mask) {
  const size = version * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const pos = ALIGN[version]
  pos.forEach((ay, i) => pos.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))

  const drawFormat = (msk) => {
    const data = (0 << 3) | msk // M = 00
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    const bit = (i) => ((bits >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, dark)
      set(b, a, dark)
    }
  }

  let bitIndex = 0
  const total = codewords.length * 8 + REMAINDER_BITS[version]
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (fn[y][x] || bitIndex >= total) continue
        const byte = codewords[bitIndex >>> 3]
        m[y][x] = byte !== undefined && ((byte >>> (7 - (bitIndex & 7))) & 1) === 1
        bitIndex++
      }
    }
  }
  const f = MASKS[mask]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x]
  drawFormat(mask)
  return m
}

function penalty(m) {
  const n = m.length
  let p = 0
  const runs = (line) => {
    let s = 0
    let run = 1
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++
      else { if (run >= 5) s += 3 + (run - 5); run = 1 }
    }
    return s
  }
  const finderLike = (line) => {
    let s = 0
    const str = line.map((v) => (v ? '1' : '0')).join('')
    for (const pat of ['10111010000', '00001011101']) {
      let i = str.indexOf(pat)
      while (i >= 0) { s += 40; i = str.indexOf(pat, i + 1) }
    }
    return s
  }
  for (let y = 0; y < n; y++) {
    const col = m.map((r) => r[y])
    p += runs(m[y]) + runs(col) + finderLike(m[y]) + finderLike(col)
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x]
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3
  }
  const dark = m.flat().filter(Boolean).length
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return p
}

// აბრუნებს boolean მატრიცას (true = შავი მოდული)
export function qrMatrix(text) {
  const bytes = utf8(text)
  let version = 1
  for (; version <= 10; version++) {
    const capacityBits = (RAW[version] - ECC[version] * BLOCKS[version]) * 8
    if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= capacityBits) break
  }
  if (version > 10) throw new Error('ტექსტი QR კოდისთვის ძალიან გრძელია')
  const codewords = interleave(encodeData(bytes, version), version)
  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = build(version, codewords, mask)
    const score = penalty(m)
    if (score < bestScore) { bestScore = score; best = m }
  }
  return best
}

// SVG path (ერთი path, მოდულების მართკუთხედები) — quiet zone-ით
export function qrPath(matrix, border = 4) {
  let d = ''
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + border} ${y + border}h1v1h-1z` }))
  return { d, size: matrix.length + border * 2 }
}

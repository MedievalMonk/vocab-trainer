// Draws the app icon (an index card on the ink-navy desk) to PNG with no image library.
// Run once: node scripts/make-icons.mjs   Output goes to public/.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const NAVY = [12, 23, 38]
const PAPER = [228, 225, 208]
const RED = [140, 44, 49]
const INK = [20, 34, 58]

function render(size, { cardScale }) {
  const px = new Uint8Array(size * size * 4)
  const rect = (x, y, w, h, [r, g, b]) => {
    for (let j = Math.round(y); j < Math.round(y + h); j++)
      for (let i = Math.round(x); i < Math.round(x + w); i++) {
        const o = (j * size + i) * 4
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255
      }
  }
  rect(0, 0, size, size, NAVY)
  const cw = size * cardScale
  const ch = cw * 0.62
  const cx = (size - cw) / 2
  const cy = (size - ch) / 2
  rect(cx, cy, cw, ch, PAPER)
  rect(cx, cy + ch * 0.2, cw, Math.max(2, size * 0.008), RED)
  rect(cx + cw * 0.1, cy + ch * 0.42, cw * 0.58, ch * 0.09, INK)
  rect(cx + cw * 0.1, cy + ch * 0.62, cw * 0.36, ch * 0.09, INK)
  return px
}

function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// "maskable" icons are cropped to a circle/squircle by Android, so the card stays well inside the safe zone.
for (const [name, size, cardScale] of [
  ['icon-192.png', 192, 0.7],
  ['icon-512.png', 512, 0.7],
  ['icon-maskable-512.png', 512, 0.5],
]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, render(size, { cardScale })))
  console.log('wrote public/' + name)
}

#!/usr/bin/env node
/**
 * Generates PWA icons as valid PNG files using only Node.js built-ins (zlib).
 * No external dependencies required.
 */
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// --- PNG encoder (pure Node.js, no deps) ---

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c
    }
    return t
  })())
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])))
  return Buffer.concat([len, t, d, crcBuf])
}

function encodePNG(width, height, getRGB) {
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB

  // Raw scanlines with filter=0 byte prefix
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0 // filter none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getRGB(x, y, width, height)
      const off = y * (1 + width * 3) + 1 + x * 3
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Icon drawing ---

function drawIcon(x, y, w, h) {
  const cx = w / 2, cy = h / 2
  const size = Math.min(w, h)

  // Background color: #0d0f12
  let r = 13, g = 15, b = 18

  // Rounded rect background: #13161b from 10%–90%
  const margin = size * 0.1
  const inBg = x >= margin && x < w - margin && y >= margin && y < h - margin
  if (inBg) { r = 19; g = 22; b = 27 }

  // Hexagon (flat-top) centered, radius = 30% of size
  const hexR = size * 0.30
  const hexRinner = hexR * 0.82
  const inHex = isInHexRing(x - cx, y - cy, hexR, hexRinner, size * 0.025)
  if (inHex) { r = 0; g = 229; b = 255 }

  // Glow around hex ring
  const hexDist = hexRingDist(x - cx, y - cy, hexR)
  if (hexDist < size * 0.025 && hexDist >= 0) {
    const t = 1 - hexDist / (size * 0.025)
    r = Math.round(r + (0 - r) * t * 0.5)
    g = Math.round(g + (229 - g) * t * 0.5)
    b = Math.round(b + (255 - b) * t * 0.5)
  }

  // Dot grid inside hex (point cloud style)
  const dots = [
    [0, 0], [-0.18, 0.10], [0.18, 0.10],
    [-0.09, -0.13], [0.09, -0.13],
    [-0.22, -0.04], [0.22, -0.04],
    [0, 0.22],
  ]
  for (const [dx, dy] of dots) {
    const dotR = size * 0.035
    const dist = Math.sqrt((x - cx - dx * size) ** 2 + (y - cy - dy * size) ** 2)
    if (dist < dotR) {
      const t = 1 - dist / dotR
      r = Math.round(r + (0 - r) * t); g = Math.round(g + (229 - g) * t); b = Math.round(b + (255 - b) * t)
    }
  }

  // Accent line below hex
  const lineY = cy + hexR * 0.65
  if (Math.abs(y - lineY) < size * 0.007 && x > cx - hexR * 0.7 && x < cx + hexR * 0.7) {
    r = 0; g = Math.round(229 * 0.4); b = Math.round(255 * 0.4)
  }

  return [clamp(r), clamp(g), clamp(b)]
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }

function hexRingDist(px, py, R) {
  // Distance from point to regular hexagon perimeter (6-sided, flat-top)
  const angle = Math.atan2(py, px)
  const sector = Math.floor((angle + Math.PI) / (Math.PI / 3))
  const a0 = (sector - 1) * (Math.PI / 3)
  const a1 = sector * (Math.PI / 3)
  // Closest point on hex edge
  const v0x = R * Math.cos(a0), v0y = R * Math.sin(a0)
  const v1x = R * Math.cos(a1), v1y = R * Math.sin(a1)
  const t = Math.max(0, Math.min(1, ((px - v0x) * (v1x - v0x) + (py - v0y) * (v1y - v0y)) / ((v1x - v0x) ** 2 + (v1y - v0y) ** 2)))
  const cx = v0x + t * (v1x - v0x), cy2 = v0y + t * (v1y - v0y)
  return Math.sqrt((px - cx) ** 2 + (py - cy2) ** 2)
}

function isInHexRing(px, py, R, Rinner, thickness) {
  const d = hexRingDist(px, py, R)
  return d < thickness
}

// --- Generate icons ---

const iconsDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(iconsDir, { recursive: true })

const sizes = [
  { size: 512, file: 'icon-512.png' },
  { size: 192, file: 'icon-192.png' },
  { size: 180, file: 'apple-touch-icon.png' },
]

for (const { size, file } of sizes) {
  const buf = encodePNG(size, size, (x, y, w, h) => drawIcon(x, y, w, h))
  fs.writeFileSync(path.join(iconsDir, file), buf)
  console.log(`✓ Generated ${file} (${size}×${size}, ${(buf.length / 1024).toFixed(1)} KB)`)
}

console.log('\nIcons generated successfully!')

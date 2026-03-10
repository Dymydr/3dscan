/**
 * Script to generate PWA icons using SVG + sharp or canvas
 * Run: node scripts/generate-icons.mjs
 */

import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(iconsDir, { recursive: true })

function generateIcon(size, filename) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#0d0f12'
  ctx.fillRect(0, 0, size, size)

  // Rounded rect background
  const r = size * 0.22
  ctx.fillStyle = '#13161b'
  roundRect(ctx, size * 0.08, size * 0.08, size * 0.84, size * 0.84, r)
  ctx.fill()

  // Hexagon wireframe icon
  ctx.strokeStyle = '#00e5ff'
  ctx.lineWidth = size * 0.03
  ctx.shadowColor = '#00e5ff'
  ctx.shadowBlur = size * 0.1

  const cx = size / 2
  const cy = size / 2
  const hexR = size * 0.28

  // Draw hexagon
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 6
    const x = cx + hexR * Math.cos(angle)
    const y = cy + hexR * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()

  // Inner dot grid (point cloud representation)
  ctx.fillStyle = '#00e5ff'
  ctx.shadowBlur = size * 0.05
  const dots = [
    [0, 0], [-0.2, 0.12], [0.2, 0.12],
    [-0.1, -0.15], [0.1, -0.15],
    [-0.25, -0.05], [0.25, -0.05],
    [0, 0.25],
  ]
  dots.forEach(([dx, dy]) => {
    ctx.beginPath()
    ctx.arc(cx + dx * size, cy + dy * size, size * 0.025, 0, Math.PI * 2)
    ctx.fill()
  })

  // Accent line
  ctx.strokeStyle = 'rgba(0,229,255,0.3)'
  ctx.lineWidth = size * 0.01
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.moveTo(size * 0.2, cy + hexR * 0.6)
  ctx.lineTo(size * 0.8, cy + hexR * 0.6)
  ctx.stroke()

  const buffer = canvas.toBuffer('image/png')
  writeFileSync(join(iconsDir, filename), buffer)
  console.log(`Generated ${filename} (${size}x${size})`)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

try {
  generateIcon(192, 'icon-192.png')
  generateIcon(512, 'icon-512.png')
  generateIcon(180, 'apple-touch-icon.png')
  console.log('✓ Icons generated successfully')
} catch (e) {
  console.error('Icon generation failed (canvas module may not be installed):', e.message)
  console.log('Creating placeholder icons...')
  // Create minimal 1x1 PNG as fallback
  const placeholder = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  writeFileSync(join(iconsDir, 'icon-192.png'), placeholder)
  writeFileSync(join(iconsDir, 'icon-512.png'), placeholder)
  writeFileSync(join(iconsDir, 'apple-touch-icon.png'), placeholder)
}

import { app, BrowserWindow, nativeImage } from 'electron'
import { deflateSync } from 'zlib'
import { getDb } from './db'

// PNG de 32×32 generado a mano (sin canvas en el proceso principal) para el icono de superposición de Windows.
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}
const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function badgePng(label: string): Buffer {
  const S = 32, px = Buffer.alloc(S * S * 4)
  const scale = label.length >= 3 ? 2 : 3
  const w = label.length * 3 * scale + (label.length - 1) * scale, h = 5 * scale
  const x0 = Math.round((S - w) / 2), y0 = Math.round((S - h) / 2)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2), a = Math.max(0, Math.min(1, S / 2 - d))
    const i = (y * S + x) * 4
    px[i] = 0xe1; px[i + 1] = 0x1d; px[i + 2] = 0x48; px[i + 3] = Math.round(a * 255)
  }
  ;[...label].forEach((ch, ci) => {
    const g = FONT[ch]; if (!g) return
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = x0 + ci * 4 * scale + gx * scale + dx, y = y0 + gy * scale + dy, i = (y * S + x) * 4
        px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = 255
      }
  })
  const raw = Buffer.alloc((S * 4 + 1) * S)
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export function unreadCount(): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE role='inbox' AND seen=0 AND (snoozed_until IS NULL OR snoozed_until<=?)").get(Date.now()) as { n: number }).n
}
export function counts(): { unread: number; spam: number } {
  const spam = (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE role='spam' AND seen=0").get() as { n: number }).n
  return { unread: unreadCount(), spam }
}

let last = -1
/** Contador en el Dock (macOS) y en la barra de tareas (Windows). */
export function refreshBadge(): void {
  const n = unreadCount()
  if (n === last) return
  last = n
  if (process.platform === 'darwin') app.setBadgeCount(n)
  else if (process.platform === 'win32') {
    const label = n > 99 ? '99+' : String(n)
    const img = n > 0 ? nativeImage.createFromBuffer(badgePng(label)) : null
    for (const w of BrowserWindow.getAllWindows()) w.setOverlayIcon(img, n > 0 ? `${n} sin leer` : '')
  }
}

// MailForge Relay: envía correos programados aunque tu ordenador esté apagado.
// Escucha en 127.0.0.1; se expone de forma privada con `tailscale serve` (HTTPS).
import http from 'node:http'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

const DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(DIR, 'relay.config.json')
const STORE = join(DIR, 'jobs.json')
const MAX_BODY = 30 * 1024 * 1024
const MAX_ATTEMPTS = 3

if (!existsSync(CONFIG)) {
  writeFileSync(CONFIG, JSON.stringify({ token: randomBytes(32).toString('hex'), port: 8787, salt: randomBytes(16).toString('hex') }, null, 2))
  console.log('Configuración creada en relay.config.json')
}
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
const key = scryptSync(cfg.token, Buffer.from(cfg.salt, 'hex'), 32)

const seal = obj => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
}
const open = s => {
  const b = Buffer.from(s, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'))
}

let jobs = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : []
const save = () => { writeFileSync(STORE + '.tmp', JSON.stringify(jobs)); renameSync(STORE + '.tmp', STORE) }
const pub = j => ({ id: j.id, sendAt: j.sendAt, status: j.status, error: j.error, meta: j.meta, attempts: j.attempts })

async function appendToSent(imap, raw) {
  const c = new ImapFlow({ host: imap.host, port: imap.port, secure: imap.port === 993, auth: { user: imap.user, pass: imap.pass }, logger: false })
  await c.connect()
  try {
    const boxes = await c.list()
    const f = boxes.find(b => b.specialUse === '\\Sent')?.path
      ?? boxes.find(b => /^(sent|enviados|sent items|sent messages|elementos enviados)$/i.test(b.name))?.path
    if (f) await c.append(f, raw, ['\\Seen'])
  } finally { await c.logout().catch(() => {}) }
}

async function deliver(job) {
  const { smtp, imap, envelope, raw, skipSent } = open(job.blob)
  const tr = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } })
  const buf = Buffer.from(raw, 'base64')
  await tr.sendMail({ envelope, raw: buf })
  if (imap && !skipSent) await appendToSent(imap, buf).catch(e => console.error('Enviado, pero no se pudo copiar a Enviados:', e.message))
}

let busy = false
async function tick() {
  if (busy) return
  busy = true
  try {
    const now = Date.now()
    for (const j of jobs.filter(x => x.status === 'pending' && x.sendAt <= now && (x.retryAt ?? 0) <= now)) {
      j.status = 'sending'; save()
      try {
        await deliver(j)
        j.status = 'sent'; j.blob = null; j.sentAt = Date.now()
      } catch (e) {
        j.attempts = (j.attempts ?? 0) + 1
        j.error = String(e.message ?? e)
        if (j.attempts >= MAX_ATTEMPTS) { j.status = 'error'; j.blob = null } // se borran las credenciales
        else { j.status = 'pending'; j.retryAt = Date.now() + 60_000 * j.attempts }
      }
      save()
    }
    // Limpia historial de más de 30 días
    const cut = now - 30 * 864e5
    const before = jobs.length
    jobs = jobs.filter(j => j.status === 'pending' || j.status === 'sending' || (j.sentAt ?? j.sendAt) > cut)
    if (jobs.length !== before) save()
  } finally { busy = false }
}
// Si el servicio se cayó a mitad de un envío, no lo damos por enviado: vuelve a pendiente.
for (const j of jobs) if (j.status === 'sending') j.status = 'pending'

const authed = req => {
  const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''))
  const want = Buffer.from(cfg.token)
  return got.length === want.length && timingSafeEqual(got, want)
}
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = []
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/health') return send(res, 200, { ok: true, version: '0.1.0', pending: jobs.filter(j => j.status === 'pending').length })
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' })
    if (req.method === 'GET' && url.pathname === '/jobs') return send(res, 200, jobs.map(pub))
    if (req.method === 'POST' && url.pathname === '/jobs') {
      const b = JSON.parse(await readBody(req))
      if (!b.sendAt || !b.raw || !b.smtp || !b.envelope) return send(res, 400, { error: 'invalid' })
      const job = {
        id: randomUUID(), sendAt: Number(b.sendAt), status: 'pending', attempts: 0,
        meta: { to: b.meta?.to ?? '', subject: b.meta?.subject ?? '', from: b.meta?.from ?? '' },
        blob: seal({ smtp: b.smtp, imap: b.imap, envelope: b.envelope, raw: b.raw, skipSent: !!b.skipSent })
      }
      jobs.push(job); save()
      return send(res, 201, pub(job))
    }
    const m = url.pathname.match(/^\/jobs\/([\w-]+)$/)
    if (req.method === 'DELETE' && m) {
      const j = jobs.find(x => x.id === m[1])
      if (!j) return send(res, 404, { error: 'not found' })
      if (j.status !== 'pending') return send(res, 409, { error: 'ya no se puede cancelar', status: j.status })
      j.status = 'cancelled'; j.blob = null; save()
      return send(res, 200, pub(j))
    }
    send(res, 404, { error: 'not found' })
  } catch (e) { send(res, 400, { error: String(e.message ?? e) }) }
}).listen(cfg.port, '127.0.0.1', () => {
  console.log(`MailForge Relay escuchando en 127.0.0.1:${cfg.port}`)
  console.log('Token (cópialo en la app, Ajustes → Relay):', cfg.token)
})

setInterval(() => { void tick() }, 10_000)
void tick()

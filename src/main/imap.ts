import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { Account, imapAuth, listAccounts } from './accounts'
import { getDb, getSetting } from './db'
import { classify, train } from './spam'
import { refreshBadge } from './badge'

const client = async (a: Account): Promise<ImapFlow> =>
  new ImapFlow({
    host: a.imap_host, port: a.imap_port, secure: a.imap_port === 993,
    auth: await imapAuth(a), logger: false
  })

export async function testConnection(a: Account): Promise<void> {
  const c = await client(a)
  await c.connect()
  await c.logout()
}

/** Sincroniza los últimos `limit` mensajes de INBOX (incremental por UID). */
export async function syncAccount(a: Account, folder = 'INBOX', limit = 200, role = 'inbox'): Promise<number> {
  const db = getDb()
  const c = await client(a)
  await c.connect()
  let added = 0
  const toSpam: { uid: number; id: string; reason: string }[] = []
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      const last = (db.prepare('SELECT MAX(uid) m FROM messages WHERE account_id=? AND folder=?').get(a.id, folder) as { m: number | null }).m
      const total = (c.mailbox as { exists: number }).exists
      const range = last ? `${last + 1}:*` : `${Math.max(1, total - limit + 1)}:*`
      const ins = db.prepare(`INSERT OR IGNORE INTO messages
        (account_id,folder,uid,message_id,thread_id,subject,from_name,from_addr,to_addrs,date,snippet,html,text,seen,starred,role,att)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for await (const m of c.fetch(range, { uid: true, source: true, flags: true }, { uid: true })) {
        if (last && m.uid <= last) continue
        if (!m.source) continue
        const p = await simpleParser(m.source)
        const from = p.from?.value[0]
        const refs = ([] as string[]).concat(p.references ?? [])
        const thread = refs[0] ?? p.inReplyTo ?? p.messageId ?? `uid-${m.uid}`
        const text = p.text ?? ''
        // Imágenes incrustadas (cid:) → data URI para que se vean sin descargar nada más
        let html = typeof p.html === 'string' ? p.html : ''
        for (const at of p.attachments ?? []) {
          if (at.cid && /^image\//.test(at.contentType) && at.size < 3_000_000)
            html = html.split(`cid:${at.cid}`).join(`data:${at.contentType};base64,${at.content.toString('base64')}`)
        }
        const attCount = (p.attachments ?? []).filter(at => !(at.cid && at.related)).length
        const seen = m.flags?.has('\\Seen') ? 1 : 0
        const sp = { message_id: p.messageId, subject: p.subject ?? '', from_addr: from?.address ?? '', text }
        if (role === 'inbox' && !seen && getSetting('autoSpam', '1') !== '0') {
          const v = classify(a.id, sp, p.headers as Map<string, unknown>)
          if (v.spam) { toSpam.push({ uid: m.uid, id: p.messageId ?? '', reason: v.reason }) }
        }
        // Aprendizaje: lo que ya está en Junk es spam; lo que ya has leído en la bandeja es correo bueno
        if (role === 'spam' && !db.prepare('SELECT 1 FROM auto_spam WHERE message_id=?').get(p.messageId ?? '')) train(sp, true)
        else if (role === 'inbox' && seen) train(sp, false)
        const r = ins.run(a.id, folder, m.uid, p.messageId ?? null, thread, p.subject ?? '(sin asunto)',
          from?.name ?? '', from?.address ?? '', p.to ? [p.to].flat().map(t => t.text).join(', ') : '',
          (p.date ?? new Date()).getTime(), text.replace(/\s+/g, ' ').slice(0, 160),
          html, text,
          m.flags?.has('\\Seen') ? 1 : 0, m.flags?.has('\\Flagged') ? 1 : 0, role, attCount)
        if (r.changes) {
          added++
          db.prepare('INSERT INTO messages_fts(rowid,subject,from_addr,text) VALUES(?,?,?,?)')
            .run(r.lastInsertRowid, p.subject ?? '', from?.address ?? '', text)
        }
      }
    } finally { lock.release() }
    // Mover a Junk lo detectado como spam (fuera del bucle de descarga)
    if (toSpam.length) {
      const dest = await findFolder(c, 'spam')
      if (dest) {
        const l2 = await c.getMailboxLock(folder)
        try {
          await c.messageMove(toSpam.map(x => x.uid).join(','), dest, { uid: true })
          for (const x of toSpam) {
            if (x.id) db.prepare('INSERT OR REPLACE INTO auto_spam(message_id,reason) VALUES(?,?)').run(x.id, x.reason)
            db.prepare('DELETE FROM messages WHERE account_id=? AND folder=? AND uid=?').run(a.id, folder, x.uid)
          }
        } finally { l2.release() }
      }
    }
  } finally { await c.logout().catch(() => {}) }
  return added
}

async function sentFolder(c: ImapFlow): Promise<string | null> {
  const boxes = await c.list()
  return boxes.find(b => b.specialUse === '\\Sent')?.path
    ?? boxes.find(b => /^(sent|enviados|sent items|sent messages|elementos enviados)$/i.test(b.name))?.path ?? null
}
async function draftsFolder(c: ImapFlow): Promise<string | null> {
  const boxes = await c.list()
  return boxes.find(b => b.specialUse === '\\Drafts')?.path
    ?? boxes.find(b => /^(drafts|borradores|draft)$/i.test(b.name))?.path ?? null
}

/** Guarda un borrador en la carpeta Borradores del servidor (lo ven iOS y otros equipos). Reemplaza `prevUid` si se indica. */
export async function saveDraft(a: Account, raw: Buffer, prevUid?: number): Promise<number | null> {
  const c = await client(a)
  await c.connect()
  try {
    const f = await draftsFolder(c)
    if (!f) throw new Error('El servidor no tiene carpeta Borradores')
    const res = (await c.append(f, raw, ['\\Draft', '\\Seen'])) as { uid?: number } | false
    if (prevUid) {
      const lock = await c.getMailboxLock(f)
      try { await c.messageDelete({ uid: String(prevUid) } as never, { uid: true }) } finally { lock.release() }
    }
    return res && res.uid ? res.uid : null
  } finally { await c.logout().catch(() => {}) }
}

/** Guarda una copia en la carpeta Enviados del servidor (visible desde iOS y otros clientes). */
export async function appendToSent(a: Account, raw: Buffer): Promise<void> {
  const c = await client(a)
  await c.connect()
  try {
    const f = await sentFolder(c)
    if (f) await c.append(f, raw, ['\\Seen'])
  } finally { await c.logout().catch(() => {}) }
}

export async function deleteDraft(a: Account, uid: number): Promise<void> {
  const c = await client(a)
  await c.connect()
  try {
    const f = await draftsFolder(c)
    if (!f) return
    const lock = await c.getMailboxLock(f)
    try { await c.messageDelete({ uid: String(uid) } as never, { uid: true }) } finally { lock.release() }
  } finally { await c.logout().catch(() => {}) }
}

export async function syncAccountAll(a: Account): Promise<number> {
  let n = await syncAccount(a)
  const c = await client(a)
  await c.connect()
  const f = await sentFolder(c).catch(() => null)
  const d = await draftsFolder(c).catch(() => null)
  const j = await findFolder(c, 'spam').catch(() => null)
  await c.logout().catch(() => {})
  if (f) n += await syncAccount(a, f, 100, 'sent').catch(() => 0)
  if (d) {
    // Los borradores cambian y se borran: se resincronizan por completo
    getDb().prepare("DELETE FROM messages WHERE account_id=? AND role='drafts'").run(a.id)
    n += await syncAccount(a, d, 50, 'drafts').catch(() => 0)
  }
  if (j) {
    // Junk también se resincroniza por completo (puede cambiar desde otros clientes)
    getDb().prepare("DELETE FROM messages WHERE account_id=? AND role='spam'").run(a.id)
    n += await syncAccount(a, j, 100, 'spam').catch(() => 0)
  }
  return n
}

export const syncAll = async (): Promise<number> => {
  let n = 0
  for (const a of listAccounts()) n += await syncAccountAll(a).catch(() => 0)
  refreshBadge()
  return n
}

export async function setFlag(a: Account, folder: string, uid: number, flag: string, on: boolean): Promise<void> {
  const c = await client(a)
  await c.connect()
  const lock = await c.getMailboxLock(folder)
  try {
    if (on) await c.messageFlagsAdd({ uid: String(uid) }, [flag], { uid: true })
    else await c.messageFlagsRemove({ uid: String(uid) }, [flag], { uid: true })
  } finally { lock.release(); await c.logout().catch(() => {}) }
}

type Kind = 'archive' | 'trash' | 'spam' | 'inbox'
const KINDS: Record<Exclude<Kind, 'inbox'>, { use: string; name: RegExp }> = {
  archive: { use: '\\Archive', name: /^(archive|archivo|archived)$/i },
  trash: { use: '\\Trash', name: /^(trash|papelera|deleted items|elementos eliminados|bin)$/i },
  spam: { use: '\\Junk', name: /^(junk|spam|junk e-?mail|correo no deseado|no deseado|bulk mail)$/i }
}
async function findFolder(c: ImapFlow, kind: Kind): Promise<string | null> {
  if (kind === 'inbox') return 'INBOX'
  const boxes = await c.list()
  const k = KINDS[kind]
  return boxes.find(b => b.specialUse === k.use)?.path ?? boxes.find(b => k.name.test(b.name))?.path
    ?? (kind === 'archive' ? boxes.find(b => b.specialUse === '\\All')?.path ?? null : null) ?? null
}

/** Mueve un mensaje a Archivo, Papelera, Spam o Bandeja en el servidor. */
export async function moveMessage(a: Account, folder: string, uid: number, target: Kind): Promise<void> {
  const c = await client(a)
  await c.connect()
  try {
    const dest = await findFolder(c, target)
    if (!dest) throw new Error('No se encontró la carpeta de destino en el servidor')
    const lock = await c.getMailboxLock(folder)
    try { await c.messageMove({ uid: String(uid) } as never, dest, { uid: true }) } finally { lock.release() }
  } finally { await c.logout().catch(() => {}) }
}

export interface AttInfo { index: number; filename: string; size: number; contentType: string }

/** Descarga el mensaje del servidor y devuelve sus adjuntos (no los incrustados). */
export async function fetchAttachments(a: Account, folder: string, uid: number): Promise<{ info: AttInfo; content: Buffer }[]> {
  const c = await client(a)
  await c.connect()
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      const m = await c.fetchOne(String(uid), { source: true }, { uid: true })
      if (!m || !m.source) return []
      const p = await simpleParser(m.source)
      return (p.attachments ?? []).filter(x => !(x.cid && x.related))
        .map((x, i) => ({ info: { index: i, filename: x.filename ?? `adjunto-${i + 1}`, size: x.size, contentType: x.contentType }, content: x.content }))
    } finally { lock.release() }
  } finally { await c.logout().catch(() => {}) }
}

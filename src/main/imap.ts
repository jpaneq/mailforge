import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { Account, decrypt, listAccounts } from './accounts'
import { getDb } from './db'

const client = (a: Account): ImapFlow =>
  new ImapFlow({
    host: a.imap_host, port: a.imap_port, secure: a.imap_port === 993,
    auth: { user: a.user, pass: decrypt(a.pass_enc) }, logger: false
  })

export async function testConnection(a: Account): Promise<void> {
  const c = client(a)
  await c.connect()
  await c.logout()
}

/** Sincroniza los últimos `limit` mensajes de INBOX (incremental por UID). */
export async function syncAccount(a: Account, folder = 'INBOX', limit = 200, role = 'inbox'): Promise<number> {
  const db = getDb()
  const c = client(a)
  await c.connect()
  let added = 0
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      const last = (db.prepare('SELECT MAX(uid) m FROM messages WHERE account_id=? AND folder=?').get(a.id, folder) as { m: number | null }).m
      const total = (c.mailbox as { exists: number }).exists
      const range = last ? `${last + 1}:*` : `${Math.max(1, total - limit + 1)}:*`
      const ins = db.prepare(`INSERT OR IGNORE INTO messages
        (account_id,folder,uid,message_id,thread_id,subject,from_name,from_addr,to_addrs,date,snippet,html,text,seen,starred,role)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for await (const m of c.fetch(range, { uid: true, source: true, flags: true }, { uid: true })) {
        if (last && m.uid <= last) continue
        if (!m.source) continue
        const p = await simpleParser(m.source)
        const from = p.from?.value[0]
        const refs = ([] as string[]).concat(p.references ?? [])
        const thread = refs[0] ?? p.inReplyTo ?? p.messageId ?? `uid-${m.uid}`
        const text = p.text ?? ''
        const r = ins.run(a.id, folder, m.uid, p.messageId ?? null, thread, p.subject ?? '(sin asunto)',
          from?.name ?? '', from?.address ?? '', p.to ? [p.to].flat().map(t => t.text).join(', ') : '',
          (p.date ?? new Date()).getTime(), text.replace(/\s+/g, ' ').slice(0, 160),
          typeof p.html === 'string' ? p.html : '', text,
          m.flags?.has('\\Seen') ? 1 : 0, m.flags?.has('\\Flagged') ? 1 : 0, role)
        if (r.changes) {
          added++
          db.prepare('INSERT INTO messages_fts(rowid,subject,from_addr,text) VALUES(?,?,?,?)')
            .run(r.lastInsertRowid, p.subject ?? '', from?.address ?? '', text)
        }
      }
    } finally { lock.release() }
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
  const c = client(a)
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
  const c = client(a)
  await c.connect()
  try {
    const f = await sentFolder(c)
    if (f) await c.append(f, raw, ['\\Seen'])
  } finally { await c.logout().catch(() => {}) }
}

export async function deleteDraft(a: Account, uid: number): Promise<void> {
  const c = client(a)
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
  const c = client(a)
  await c.connect()
  const f = await sentFolder(c).catch(() => null)
  const d = await draftsFolder(c).catch(() => null)
  await c.logout().catch(() => {})
  if (f) n += await syncAccount(a, f, 100, 'sent').catch(() => 0)
  if (d) {
    // Los borradores cambian y se borran: se resincronizan por completo
    getDb().prepare("DELETE FROM messages WHERE account_id=? AND role='drafts'").run(a.id)
    n += await syncAccount(a, d, 50, 'drafts').catch(() => 0)
  }
  return n
}

export const syncAll = async (): Promise<number> => {
  let n = 0
  for (const a of listAccounts()) n += await syncAccountAll(a).catch(() => 0)
  return n
}

export async function setFlag(a: Account, folder: string, uid: number, flag: string, on: boolean): Promise<void> {
  const c = client(a)
  await c.connect()
  const lock = await c.getMailboxLock(folder)
  try {
    if (on) await c.messageFlagsAdd({ uid: String(uid) }, [flag], { uid: true })
    else await c.messageFlagsRemove({ uid: String(uid) }, [flag], { uid: true })
  } finally { lock.release(); await c.logout().catch(() => {}) }
}

/** Mueve un mensaje a Archivo o Papelera (carpetas especiales del servidor) y lo quita de la base local. */
export async function moveMessage(a: Account, folder: string, uid: number, target: 'archive' | 'trash'): Promise<void> {
  const c = client(a)
  await c.connect()
  try {
    const boxes = await c.list()
    const use = target === 'trash' ? '\\Trash' : '\\Archive'
    const dest = boxes.find(b => b.specialUse === use)?.path
      ?? boxes.find(b => (target === 'trash' ? /^(trash|papelera|deleted items|elementos eliminados|bin)$/i : /^(archive|archivo|archived)$/i).test(b.name))?.path
      ?? (target === 'archive' ? boxes.find(b => b.specialUse === '\\All')?.path : undefined)
    if (!dest) throw new Error('No se encontró la carpeta de destino en el servidor')
    const lock = await c.getMailboxLock(folder)
    try { await c.messageMove({ uid: String(uid) } as never, dest, { uid: true }) } finally { lock.release() }
  } finally { await c.logout().catch(() => {}) }
}

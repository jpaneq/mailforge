import { Notification } from 'electron'
import { getDb, getSetting } from './db'
import { getAccount } from './accounts'
import { sendMail, sendToRelay, cancelRelay, Outgoing } from './smtp'
import { syncAll } from './imap'

export async function scheduleSend(accountId: number, m: Outgoing, sendAt: number): Promise<void> {
  const db = getDb()
  if (getSetting('relayUrl') && getSetting('relayToken')) {
    // Con relay: sale aunque este equipo esté apagado. Guardamos solo el resumen (sin adjuntos).
    const jobId = await sendToRelay(getAccount(accountId), m, sendAt)
    const { attachments: _a, ...light } = m
    db.prepare("INSERT INTO scheduled(account_id,payload,send_at,status,error) VALUES(?,?,?,'relay',?)")
      .run(accountId, JSON.stringify(light), sendAt, jobId)
    return
  }
  db.prepare('INSERT INTO scheduled(account_id,payload,send_at) VALUES(?,?,?)').run(accountId, JSON.stringify(m), sendAt)
}
export const listScheduled = (): unknown[] =>
  getDb().prepare("SELECT id,account_id,payload,send_at,status,error FROM scheduled WHERE status NOT IN ('sent','cancelled') ORDER BY send_at").all()
export async function cancelScheduled(id: number): Promise<void> {
  const db = getDb()
  const r = db.prepare('SELECT status, error FROM scheduled WHERE id=?').get(id) as { status: string; error: string } | undefined
  if (r?.status === 'relay') await cancelRelay(r.error)
  db.prepare("UPDATE scheduled SET status='cancelled' WHERE id=? AND status IN ('pending','relay')").run(id)
}

/** Actualiza el estado de los envíos delegados al relay. */
async function pollRelay(): Promise<void> {
  const url = getSetting('relayUrl').replace(/\/$/, ''), token = getSetting('relayToken')
  const db = getDb()
  const rows = db.prepare("SELECT id, error AS job FROM scheduled WHERE status='relay'").all() as { id: number; job: string }[]
  if (!url || !rows.length) return
  try {
    const list = (await (await fetch(`${url}/jobs`, { headers: { authorization: `Bearer ${token}` } })).json()) as
      { id: string; status: string; error?: string }[]
    for (const r of rows) {
      const j = list.find(x => x.id === r.job)
      if (j?.status === 'sent') db.prepare("UPDATE scheduled SET status='sent' WHERE id=?").run(r.id)
      else if (j?.status === 'error') db.prepare("UPDATE scheduled SET status='error', error=? WHERE id=?").run(j.error ?? 'error', r.id)
    }
  } catch { /* relay no accesible: se reintenta */ }
}

async function pollTracker(): Promise<void> {
  const url = getSetting('trackerUrl'), key = getSetting('trackerKey')
  if (!url) return
  const db = getDb()
  const rows = db.prepare('SELECT id FROM tracked WHERE replied=0').all() as { id: string }[]
  if (!rows.length) return
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/stats?ids=${rows.map(r => r.id).join(',')}`, {
      headers: key ? { authorization: `Bearer ${key}` } : {}
    })
    const stats = (await res.json()) as Record<string, { opens: number; first: number; last: number }>
    for (const [id, s] of Object.entries(stats)) {
      const prev = db.prepare('SELECT opens, subject FROM tracked WHERE id=?').get(id) as { opens: number; subject: string } | undefined
      if (!prev || s.opens === prev.opens) continue
      db.prepare('UPDATE tracked SET opens=?, first_open=?, last_open=? WHERE id=?').run(s.opens, s.first, s.last, id)
      if (prev.opens === 0) new Notification({ title: 'Correo abierto', body: prev.subject }).show()
    }
  } catch { /* sin red: se reintenta */ }
}

function tick(): void {
  const db = getDb()
  const now = Date.now()
  // Envíos programados
  const due = db.prepare("SELECT * FROM scheduled WHERE status='pending' AND send_at<=?").all(now) as
    { id: number; account_id: number; payload: string }[]
  for (const s of due) {
    db.prepare("UPDATE scheduled SET status='sending' WHERE id=?").run(s.id)
    sendMail(getAccount(s.account_id), JSON.parse(s.payload))
      .then(() => db.prepare("UPDATE scheduled SET status='sent' WHERE id=?").run(s.id))
      .catch(e => db.prepare("UPDATE scheduled SET status='error', error=? WHERE id=?").run(String(e), s.id))
  }
  // Snooze: reaparece en bandeja
  db.prepare('UPDATE messages SET snoozed_until=NULL, seen=0 WHERE snoozed_until IS NOT NULL AND snoozed_until<=?').run(now)
  // Recordatorios de seguimiento sin respuesta
  const fu = db.prepare('SELECT id,subject,to_addrs FROM tracked WHERE replied=0 AND follow_up_at IS NOT NULL AND follow_up_at<=?')
    .all(now) as { id: string; subject: string; to_addrs: string }[]
  for (const f of fu) {
    new Notification({ title: 'Seguimiento pendiente', body: `Sin respuesta de ${f.to_addrs}: ${f.subject}` }).show()
    db.prepare('UPDATE tracked SET follow_up_at=NULL WHERE id=?').run(f.id)
  }
  // Marcar respondidos: si llega un mensaje del destinatario con "Re: asunto"
  db.prepare(`UPDATE tracked SET replied=1 WHERE replied=0 AND EXISTS (
    SELECT 1 FROM messages m WHERE m.date>tracked.sent_at AND lower(m.subject) LIKE '%'||lower(tracked.subject)
    AND instr(lower(tracked.to_addrs), lower(m.from_addr))>0)`).run()
}

export function startBackground(): void {
  setInterval(tick, 15_000)
  setInterval(() => { void pollTracker(); void pollRelay() }, 60_000)
  setInterval(() => { void syncAll() }, 120_000)
  tick()
}

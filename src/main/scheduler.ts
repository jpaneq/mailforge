import { Notification } from 'electron'
import { getDb, getSetting } from './db'
import { getAccount } from './accounts'
import { sendMail, Outgoing } from './smtp'
import { syncAll } from './imap'

export function scheduleSend(accountId: number, m: Outgoing, sendAt: number): void {
  getDb().prepare('INSERT INTO scheduled(account_id,payload,send_at) VALUES(?,?,?)')
    .run(accountId, JSON.stringify(m), sendAt)
}
export const listScheduled = (): unknown[] =>
  getDb().prepare("SELECT id,account_id,payload,send_at,status,error FROM scheduled WHERE status!='sent' ORDER BY send_at").all()
export const cancelScheduled = (id: number): void => {
  getDb().prepare("UPDATE scheduled SET status='cancelled' WHERE id=? AND status='pending'").run(id)
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
  setInterval(() => { void pollTracker() }, 60_000)
  setInterval(() => { void syncAll() }, 120_000)
  tick()
}

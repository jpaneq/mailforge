import nodemailer from 'nodemailer'
import { Account, decrypt } from './accounts'
import { getDb, getSetting } from './db'
import { randomUUID } from 'crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { appendToSent, saveDraft, deleteDraft } from './imap'

export interface Outgoing {
  to: string; cc?: string; bcc?: string; subject: string; html: string
  track?: boolean; followUpDays?: number; inReplyTo?: string
  attachments?: { filename: string; base64: string }[]
}

const isGmail = (a: Account): boolean => /gmail\.com|googlemail\.com/.test(a.smtp_host)

export async function buildRaw(a: Account, m: Outgoing): Promise<{ raw: Buffer; rcpt: string[] }> {
  let html = m.html + (a.signature ? `<br><br>${a.signature}` : '')
  const trackerUrl = getSetting('trackerUrl')
  if (m.track && trackerUrl) {
    const id = randomUUID()
    html += `<img src="${trackerUrl.replace(/\/$/, '')}/o/${id}.gif" width="1" height="1" alt="" style="display:none">`
    getDb().prepare('INSERT INTO tracked(id,account_id,to_addrs,subject,sent_at,follow_up_at) VALUES(?,?,?,?,?,?)')
      .run(id, a.id, m.to, m.subject, Date.now(), m.followUpDays ? Date.now() + m.followUpDays * 864e5 : null)
  }
  const mail = {
    from: `"${a.name}" <${a.email}>`, to: m.to, cc: m.cc, bcc: m.bcc,
    subject: m.subject, html, inReplyTo: m.inReplyTo, date: new Date(),
    attachments: m.attachments?.map(x => ({ filename: x.filename, content: Buffer.from(x.base64, 'base64') }))
  }
  const raw = await new MailComposer(mail).compile().build()
  const rcpt = [m.to, m.cc, m.bcc].filter(Boolean).join(',').split(',').map(x => x.trim()).filter(Boolean)
  return { raw, rcpt }
}

export async function sendMail(a: Account, m: Outgoing): Promise<void> {
  const { raw, rcpt } = await buildRaw(a, m)
  const tr = nodemailer.createTransport({
    host: a.smtp_host, port: a.smtp_port, secure: a.smtp_port === 465,
    auth: { user: a.user, pass: decrypt(a.pass_enc) }
  })
  await tr.sendMail({ envelope: { from: a.email, to: rcpt }, raw })
  // Gmail guarda solo el enviado por SMTP; el resto necesitan que lo copiemos a "Enviados".
  if (!isGmail(a)) await appendToSent(a, raw).catch(() => { /* el correo ya salió */ })
}

/** Envía la tarea al relay para que salga con el PC apagado. */
export async function sendToRelay(a: Account, m: Outgoing, sendAt: number): Promise<string> {
  const url = getSetting('relayUrl').replace(/\/$/, ''), token = getSetting('relayToken')
  const { raw, rcpt } = await buildRaw(a, m)
  const res = await fetch(`${url}/jobs`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      sendAt, raw: raw.toString('base64'), envelope: { from: a.email, to: rcpt }, skipSent: isGmail(a),
      smtp: { host: a.smtp_host, port: a.smtp_port, user: a.user, pass: decrypt(a.pass_enc) },
      imap: { host: a.imap_host, port: a.imap_port, user: a.user, pass: decrypt(a.pass_enc) },
      meta: { to: m.to, subject: m.subject, from: a.email }
    })
  })
  if (!res.ok) throw new Error(`Relay: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { id: string }).id
}

export async function cancelRelay(jobId: string): Promise<void> {
  const url = getSetting('relayUrl').replace(/\/$/, ''), token = getSetting('relayToken')
  const res = await fetch(`${url}/jobs/${jobId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Relay: ${res.status} ${await res.text()}`)
}

export async function saveDraftMail(a: Account, m: Outgoing, prevUid?: number): Promise<number | null> {
  const { raw } = await buildRaw(a, { ...m, track: false })
  return saveDraft(a, raw, prevUid)
}
export const removeDraft = deleteDraft

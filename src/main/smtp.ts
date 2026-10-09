import nodemailer from 'nodemailer'
import { Account, decrypt } from './accounts'
import { getDb, getSetting } from './db'
import { randomUUID } from 'crypto'

export interface Outgoing {
  to: string; cc?: string; bcc?: string; subject: string; html: string
  track?: boolean; followUpDays?: number; inReplyTo?: string
}

export async function sendMail(a: Account, m: Outgoing): Promise<void> {
  const tr = nodemailer.createTransport({
    host: a.smtp_host, port: a.smtp_port, secure: a.smtp_port === 465,
    auth: { user: a.user, pass: decrypt(a.pass_enc) }
  })
  let html = m.html + (a.signature ? `<br><br>${a.signature}` : '')
  const trackerUrl = getSetting('trackerUrl')
  if (m.track && trackerUrl) {
    const id = randomUUID()
    html += `<img src="${trackerUrl.replace(/\/$/, '')}/o/${id}.gif" width="1" height="1" alt="" style="display:none">`
    getDb().prepare('INSERT INTO tracked(id,account_id,to_addrs,subject,sent_at,follow_up_at) VALUES(?,?,?,?,?,?)')
      .run(id, a.id, m.to, m.subject, Date.now(), m.followUpDays ? Date.now() + m.followUpDays * 864e5 : null)
  }
  await tr.sendMail({
    from: `"${a.name}" <${a.email}>`, to: m.to, cc: m.cc, bcc: m.bcc,
    subject: m.subject, html, inReplyTo: m.inReplyTo
  })
}

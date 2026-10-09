import { safeStorage } from 'electron'
import { getDb } from './db'
import { refreshGoogle, GoogleProfile } from './oauth'

export interface Account {
  id: number; email: string; name: string
  imap_host: string; imap_port: number; smtp_host: string; smtp_port: number
  user: string; pass_enc: string; signature: string
  auth_type?: 'password' | 'google'; oauth_enc?: string | null
}

export const PRESETS: Record<string, Partial<Account>> = {
  'gmail.com': { imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465 },
  'outlook.com': { imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  'hotmail.com': { imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  'icloud.com': { imap_host: 'imap.mail.me.com', imap_port: 993, smtp_host: 'smtp.mail.me.com', smtp_port: 587 },
  'yahoo.com': { imap_host: 'imap.mail.yahoo.com', imap_port: 993, smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465 }
}

export const encrypt = (s: string): string =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : 'plain:' + s
export const decrypt = (s: string): string =>
  s.startsWith('plain:') ? s.slice(6) : safeStorage.decryptString(Buffer.from(s, 'base64'))

export const listAccounts = (): Account[] => getDb().prepare('SELECT * FROM accounts').all() as Account[]
export const getAccount = (id: number): Account =>
  getDb().prepare('SELECT * FROM accounts WHERE id=?').get(id) as Account

export function addAccount(a: Omit<Account, 'id' | 'pass_enc' | 'signature'> & { password: string }): number {
  const r = getDb().prepare(
    'INSERT INTO accounts(email,name,imap_host,imap_port,smtp_host,smtp_port,user,pass_enc) VALUES(?,?,?,?,?,?,?,?)'
  ).run(a.email, a.name, a.imap_host, a.imap_port, a.smtp_host, a.smtp_port, a.user, encrypt(a.password))
  return Number(r.lastInsertRowid)
}
export const removeAccount = (id: number): void => {
  getDb().prepare('DELETE FROM messages WHERE account_id=?').run(id)
  getDb().prepare('DELETE FROM accounts WHERE id=?').run(id)
}

export function addGoogleAccount(p: GoogleProfile): number {
  const db = getDb()
  const enc = encrypt(JSON.stringify({ refresh_token: p.refresh_token, access_token: p.access_token, expiry: p.expiry }))
  const ex = db.prepare('SELECT id FROM accounts WHERE email=?').get(p.email) as { id: number } | undefined
  if (ex) { db.prepare("UPDATE accounts SET auth_type='google', oauth_enc=? WHERE id=?").run(enc, ex.id); return ex.id }
  const r = db.prepare("INSERT INTO accounts(email,name,imap_host,imap_port,smtp_host,smtp_port,user,pass_enc,auth_type,oauth_enc) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(p.email, p.name, 'imap.gmail.com', 993, 'smtp.gmail.com', 465, p.email, '', 'google', enc)
  return Number(r.lastInsertRowid)
}

/** Token de acceso vigente para una cuenta de Google (se renueva solo). */
async function googleAccessToken(a: Account): Promise<string> {
  let t = JSON.parse(decrypt(a.oauth_enc!)) as { refresh_token: string; access_token: string; expiry: number }
  if (t.expiry - 60_000 > Date.now()) return t.access_token
  t = await refreshGoogle(t.refresh_token)
  getDb().prepare('UPDATE accounts SET oauth_enc=? WHERE id=?').run(encrypt(JSON.stringify(t)), a.id)
  return t.access_token
}
export const googleRefreshToken = (a: Account): string => (JSON.parse(decrypt(a.oauth_enc!)) as { refresh_token: string }).refresh_token

export async function imapAuth(a: Account): Promise<{ user: string; pass: string } | { user: string; accessToken: string }> {
  return a.auth_type === 'google' ? { user: a.user, accessToken: await googleAccessToken(a) } : { user: a.user, pass: decrypt(a.pass_enc) }
}
export async function smtpAuth(a: Account): Promise<{ user: string; pass: string } | { type: 'OAuth2'; user: string; accessToken: string }> {
  return a.auth_type === 'google' ? { type: 'OAuth2', user: a.user, accessToken: await googleAccessToken(a) } : { user: a.user, pass: decrypt(a.pass_enc) }
}

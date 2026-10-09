import { safeStorage } from 'electron'
import { getDb } from './db'

export interface Account {
  id: number; email: string; name: string
  imap_host: string; imap_port: number; smtp_host: string; smtp_port: number
  user: string; pass_enc: string; signature: string
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

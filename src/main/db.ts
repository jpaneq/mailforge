import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'mailforge.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT,
      imap_host TEXT, imap_port INTEGER, smtp_host TEXT, smtp_port INTEGER,
      user TEXT, pass_enc TEXT, signature TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, account_id INTEGER, folder TEXT, uid INTEGER,
      message_id TEXT, thread_id TEXT, subject TEXT, from_name TEXT, from_addr TEXT,
      to_addrs TEXT, date INTEGER, snippet TEXT, html TEXT, text TEXT,
      seen INTEGER DEFAULT 0, starred INTEGER DEFAULT 0,
      snoozed_until INTEGER, labels TEXT DEFAULT '',
      UNIQUE(account_id, folder, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_date ON messages(date DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(subject, from_addr, text, content='messages', content_rowid='id');
    CREATE TABLE IF NOT EXISTS scheduled (
      id INTEGER PRIMARY KEY, account_id INTEGER, payload TEXT, send_at INTEGER,
      status TEXT DEFAULT 'pending', error TEXT
    );
    CREATE TABLE IF NOT EXISTS tracked (
      id TEXT PRIMARY KEY, account_id INTEGER, to_addrs TEXT, subject TEXT,
      sent_at INTEGER, opens INTEGER DEFAULT 0, first_open INTEGER, last_open INTEGER,
      follow_up_at INTEGER, replied INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY, name TEXT, subject TEXT, body TEXT
    );
    CREATE TABLE IF NOT EXISTS autodrafts (id TEXT PRIMARY KEY, data TEXT, updated INTEGER);
    CREATE TABLE IF NOT EXISTS bayes (token TEXT PRIMARY KEY, spam INTEGER DEFAULT 0, ham INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS trained (message_id TEXT PRIMARY KEY, cls INTEGER);
    CREATE TABLE IF NOT EXISTS trusted (sender TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS auto_spam (message_id TEXT PRIMARY KEY, reason TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  try { db.exec("ALTER TABLE messages ADD COLUMN role TEXT DEFAULT 'inbox'"); db.exec("UPDATE messages SET role='sent' WHERE folder<>'INBOX'") } catch { /* ya migrada */ }
  return db
}

export const getSetting = (k: string, d = ''): string =>
  (getDb().prepare('SELECT value FROM settings WHERE key=?').get(k) as { value: string } | undefined)?.value ?? d
export const setSetting = (k: string, v: string): void => {
  getDb().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)
}

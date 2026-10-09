import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { getDb, getSetting, setSetting } from './db'
import { addAccount, getAccount, listAccounts, PRESETS, removeAccount } from './accounts'
import { moveMessage, setFlag, syncAccountAll, syncAll, testConnection } from './imap'
import { sendMail, saveDraftMail, removeDraft, Outgoing } from './smtp'
import { cancelScheduled, listScheduled, scheduleSend, startBackground } from './scheduler'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

type Q = { account?: number; view: string; query?: string }

function registerIpc(): void {
  const db = getDb()
  ipcMain.handle('accounts:list', () => listAccounts().map(({ pass_enc, ...a }) => a))
  ipcMain.handle('accounts:presets', () => PRESETS)
  ipcMain.handle('accounts:add', async (_e, a) => {
    const id = addAccount(a)
    try { await testConnection(getAccount(id)) } catch (e) { removeAccount(id); throw new Error('No se pudo conectar: ' + String(e)) }
    void syncAccountAll(getAccount(id))
    return id
  })
  ipcMain.handle('accounts:remove', (_e, id: number) => removeAccount(id))
  ipcMain.handle('accounts:signature', (_e, id: number, sig: string) =>
    db.prepare('UPDATE accounts SET signature=? WHERE id=?').run(sig, id))

  ipcMain.handle('mail:list', (_e, q: Q) => {
    const now = Date.now()
    const where: string[] = []; const args: unknown[] = []
    if (q.account) { where.push('m.account_id=?'); args.push(q.account) }
    where.push(q.view === 'sent' ? "m.role='sent'" : q.view === 'drafts' ? "m.role='drafts'" : "m.role='inbox'")
    if (q.view === 'snoozed') where.push('m.snoozed_until>' + now)
    else where.push('(m.snoozed_until IS NULL OR m.snoozed_until<=' + now + ')')
    if (q.view === 'starred') where.push('m.starred=1')
    if (q.view === 'unread') where.push('m.seen=0')
    let from = 'messages m'
    if (q.query) {
      from = 'messages m JOIN messages_fts f ON f.rowid=m.id'
      where.push('messages_fts MATCH ?'); args.push(q.query.replace(/["']/g, ' ') + '*')
    }
    return db.prepare(`SELECT m.id,m.message_id,m.role,m.to_addrs,m.account_id,m.uid,m.folder,m.thread_id,m.subject,m.from_name,m.from_addr,m.date,m.snippet,m.seen,m.starred,m.snoozed_until
      FROM ${from} WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT 500`).all(...args)
  })
  ipcMain.handle('mail:thread', (_e, threadId: string) =>
    db.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY date').all(threadId))
  ipcMain.handle('mail:sync', () => syncAll())
  ipcMain.handle('mail:flag', async (_e, id: number, flag: 'seen' | 'starred', on: boolean) => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    db.prepare(`UPDATE messages SET ${flag}=? WHERE id=?`).run(on ? 1 : 0, id)
    await setFlag(getAccount(m.account_id), m.folder, m.uid, flag === 'seen' ? '\\Seen' : '\\Flagged', on).catch(() => {})
  })
  ipcMain.handle('mail:move', async (_e, id: number, target: 'archive' | 'trash') => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    await moveMessage(getAccount(m.account_id), m.folder, m.uid, target)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
  })
  ipcMain.handle('mail:snooze', (_e, id: number, until: number | null) =>
    db.prepare('UPDATE messages SET snoozed_until=? WHERE id=?').run(until, id))

  ipcMain.handle('send:now', (_e, accountId: number, m: Outgoing) => sendMail(getAccount(accountId), m))
  ipcMain.handle('send:schedule', (_e, accountId: number, m: Outgoing, at: number) => scheduleSend(accountId, m, at))
  ipcMain.handle('send:list', () => listScheduled())
  ipcMain.handle('send:draft', (_e, accountId: number, m: Outgoing, prevUid?: number) => saveDraftMail(getAccount(accountId), m, prevUid))
  ipcMain.handle('send:draftDelete', (_e, accountId: number, uid: number) => removeDraft(getAccount(accountId), uid))
  ipcMain.handle('autodraft:save', (_e, id: string, data: string) =>
    db.prepare('INSERT INTO autodrafts(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated').run(id, data, Date.now()))
  ipcMain.handle('autodraft:list', () => db.prepare('SELECT id,data,updated FROM autodrafts ORDER BY updated DESC').all())
  ipcMain.handle('autodraft:delete', (_e, id: string) => db.prepare('DELETE FROM autodrafts WHERE id=?').run(id))
  ipcMain.handle('send:cancel', (_e, id: number) => cancelScheduled(id))

  ipcMain.handle('tracked:list', () => db.prepare('SELECT * FROM tracked ORDER BY sent_at DESC LIMIT 200').all())

  ipcMain.handle('templates:list', () => db.prepare('SELECT * FROM templates').all())
  ipcMain.handle('templates:save', (_e, t: { name: string; subject: string; body: string }) =>
    db.prepare('INSERT INTO templates(name,subject,body) VALUES(?,?,?)').run(t.name, t.subject, t.body))
  ipcMain.handle('templates:delete', (_e, id: number) => db.prepare('DELETE FROM templates WHERE id=?').run(id))

  ipcMain.handle('settings:get', (_e, k: string) => getSetting(k))
  ipcMain.handle('settings:set', (_e, k: string, v: string) => setSetting(k, v))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  startBackground()
  void syncAll()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

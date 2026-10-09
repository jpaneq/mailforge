import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getDb, getSetting, setSetting } from './db'
import { addAccount, getAccount, listAccounts, PRESETS, removeAccount } from './accounts'
import { fetchAttachments, moveMessage, setFlag, syncAccountAll, syncAll, testConnection } from './imap'
import { sendMail, saveDraftMail, removeDraft, Outgoing } from './smtp'
import { refreshBadge, counts } from './badge'
import { train, trust } from './spam'
import { cancelScheduled, listScheduled, scheduleSend, startBackground } from './scheduler'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, spellcheck: true }
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
  ipcMain.handle('signatures:list', () => db.prepare('SELECT * FROM signatures ORDER BY account_id, id').all())
  ipcMain.handle('signatures:save', (_e, s: { id?: number; account_id: number; name: string; html: string; for_new: number; for_reply: number }) => {
    // Solo una firma por defecto por cuenta y tipo
    let id = s.id
    if (id) db.prepare('UPDATE signatures SET name=?, html=?, for_new=?, for_reply=? WHERE id=?').run(s.name, s.html, s.for_new, s.for_reply, id)
    else id = Number(db.prepare('INSERT INTO signatures(account_id,name,html,for_new,for_reply) VALUES(?,?,?,?,?)').run(s.account_id, s.name, s.html, s.for_new, s.for_reply).lastInsertRowid)
    if (s.for_new) db.prepare('UPDATE signatures SET for_new=0 WHERE account_id=? AND id<>?').run(s.account_id, id)
    if (s.for_reply) db.prepare('UPDATE signatures SET for_reply=0 WHERE account_id=? AND id<>?').run(s.account_id, id)
    return id
  })
  ipcMain.handle('signatures:delete', (_e, id: number) => db.prepare('DELETE FROM signatures WHERE id=?').run(id))
  ipcMain.handle('mail:attachments', async (_e, id: number) => {
    const m = db.prepare('SELECT account_id,folder,uid FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    return (await fetchAttachments(getAccount(m.account_id), m.folder, m.uid)).map(x => x.info)
  })
  ipcMain.handle('mail:saveAttachment', async (e, id: number, index: number) => {
    const m = db.prepare('SELECT account_id,folder,uid FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    const att = (await fetchAttachments(getAccount(m.account_id), m.folder, m.uid))[index]
    if (!att) throw new Error('Adjunto no encontrado')
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showSaveDialog(win!, { defaultPath: att.info.filename })
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, att.content)
    return true
  })

  ipcMain.handle('mail:list', (_e, q: Q) => {
    const now = Date.now()
    const where: string[] = []; const args: unknown[] = []
    if (q.account) { where.push('m.account_id=?'); args.push(q.account) }
    where.push(q.view === 'sent' ? "m.role='sent'" : q.view === 'drafts' ? "m.role='drafts'" : q.view === 'spam' ? "m.role='spam'" : "m.role='inbox'")
    if (q.view === 'snoozed') where.push('m.snoozed_until>' + now)
    else where.push('(m.snoozed_until IS NULL OR m.snoozed_until<=' + now + ')')
    if (q.view === 'starred') where.push('m.starred=1')
    if (q.view === 'unread') where.push('m.seen=0')
    let from = 'messages m'
    if (q.query) {
      from = 'messages m JOIN messages_fts f ON f.rowid=m.id'
      where.push('messages_fts MATCH ?'); args.push(q.query.replace(/["']/g, ' ') + '*')
    }
    return db.prepare(`SELECT m.id,m.message_id,m.att,m.role,(SELECT reason FROM auto_spam WHERE message_id=m.message_id) AS spam_reason,m.to_addrs,m.account_id,m.uid,m.folder,m.thread_id,m.subject,m.from_name,m.from_addr,m.date,m.snippet,m.seen,m.starred,m.snoozed_until
      FROM ${from} WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT 500`).all(...args)
  })
  ipcMain.handle('mail:thread', (_e, threadId: string) =>
    db.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY date').all(threadId))
  ipcMain.handle('mail:sync', () => syncAll())
  ipcMain.handle('mail:flag', async (_e, id: number, flag: 'seen' | 'starred', on: boolean) => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    db.prepare(`UPDATE messages SET ${flag}=? WHERE id=?`).run(on ? 1 : 0, id)
    refreshBadge()
    await setFlag(getAccount(m.account_id), m.folder, m.uid, flag === 'seen' ? '\\Seen' : '\\Flagged', on).catch(() => {})
  })
  ipcMain.handle('mail:move', async (_e, id: number, target: 'archive' | 'trash') => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    await moveMessage(getAccount(m.account_id), m.folder, m.uid, target)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
    refreshBadge()
  })
  type Row = { account_id: number; folder: string; uid: number; message_id: string; subject: string; from_addr: string; text: string }
  ipcMain.handle('mail:spam', async (_e, id: number) => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as Row
    await moveMessage(getAccount(m.account_id), m.folder, m.uid, 'spam')
    train(m, true)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
    refreshBadge(); void syncAccountAll(getAccount(m.account_id)).then(refreshBadge)
  })
  ipcMain.handle('mail:notspam', async (_e, id: number) => {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id) as Row
    await moveMessage(getAccount(m.account_id), m.folder, m.uid, 'inbox')
    train(m, false); trust(m.from_addr)
    db.prepare('DELETE FROM auto_spam WHERE message_id=?').run(m.message_id ?? '')
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
    refreshBadge(); void syncAccountAll(getAccount(m.account_id)).then(refreshBadge)
  })
  ipcMain.handle('mail:counts', () => counts())
  ipcMain.handle('mail:snooze', (_e, id: number, until: number | null) =>
    { db.prepare('UPDATE messages SET snoozed_until=? WHERE id=?').run(until, id); refreshBadge() })

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
  session.defaultSession.setSpellCheckerLanguages(['es-ES', 'en-US'])
  registerIpc()
  createWindow()
  startBackground()
  refreshBadge()
  void syncAll()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

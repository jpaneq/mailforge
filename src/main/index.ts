import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { basename, extname } from 'path'
import { join } from 'path'
import { getDb, getSetting, setSetting } from './db'
import { googleSignIn } from './oauth'
import { addAccount, addGoogleAccount, getAccount, listAccounts, PRESETS, removeAccount } from './accounts'
import { fetchAttachments, moveMessage, rescanInbox, setFlag, syncAccountAll, syncAll, testConnection } from './imap'
import { sendMail, saveDraftMail, removeDraft, Outgoing } from './smtp'
import { refreshBadge, counts } from './badge'
import { train, trust } from './spam'
import { cancelScheduled, listScheduled, scheduleSend, startBackground } from './scheduler'

function createComposeWindow(params: Record<string, unknown>): void {
  const win = new BrowserWindow({
    width: 1000, height: 800, minWidth: 720, minHeight: 520, title: 'Nuevo mensaje', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, spellcheck: true }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  const hash = 'compose=' + encodeURIComponent(JSON.stringify(params))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + '#' + hash)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

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
  ipcMain.handle('accounts:list', () => listAccounts().map(({ pass_enc, oauth_enc, ...a }) => a))
  ipcMain.handle('accounts:presets', () => PRESETS)
  ipcMain.handle('accounts:add', async (_e, a) => {
    const id = addAccount(a)
    try { await testConnection(getAccount(id)) } catch (e) {
      removeAccount(id)
      const gmail = /gmail|google/i.test(a.imap_host)
      throw new Error(gmail
        ? 'Gmail rechazó el acceso. Usa el botón «Iniciar sesión con Google», o una contraseña de aplicación de 16 letras (sin espacios; requiere verificación en dos pasos y IMAP activado). La contraseña normal de Gmail no funciona.'
        : 'No se pudo conectar: ' + String((e as Error).message ?? e))
    }
    void syncAccountAll(getAccount(id))
    return id
  })
  ipcMain.handle('accounts:google', async () => {
    const profile = await googleSignIn()
    const id = addGoogleAccount(profile)
    await testConnection(getAccount(id))
    void syncAccountAll(getAccount(id)).then(refreshBadge)
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
  ipcMain.handle('mail:saveAllAttachments', async (e, id: number) => {
    const m = db.prepare('SELECT account_id,folder,uid FROM messages WHERE id=?').get(id) as { account_id: number; folder: string; uid: number }
    const all = await fetchAttachments(getAccount(m.account_id), m.folder, m.uid)
    if (!all.length) return { count: 0 }
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, { title: 'Elige la carpeta donde guardar los adjuntos', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Guardar aquí' })
    if (r.canceled || !r.filePaths[0]) return { count: 0, canceled: true }
    let first = ''
    for (const a of all) {
      // basename evita que un nombre de adjunto malicioso (../../) escriba fuera de la carpeta elegida
      const safe = basename(a.info.filename).replace(/[\\/:*?"<>|]/g, '_') || 'adjunto'
      const ext = extname(safe), stem = safe.slice(0, safe.length - ext.length)
      let target = join(r.filePaths[0], safe), n = 1
      while (existsSync(target)) target = join(r.filePaths[0], `${stem} (${n++})${ext}`)
      writeFileSync(target, a.content)
      first ||= target
    }
    shell.showItemInFolder(first)
    return { count: all.length, folder: r.filePaths[0] }
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
    where.push(q.view === 'sent' ? "m.role='sent'" : q.view === 'drafts' ? "m.role='drafts'" : q.view === 'spam' ? "(m.role='spam' OR m.spam_local=1)" : "m.role='inbox' AND m.spam_local=0")
    if (q.view === 'snoozed') where.push('m.snoozed_until>' + now)
    else where.push('(m.snoozed_until IS NULL OR m.snoozed_until<=' + now + ')')
    if (q.view === 'starred') where.push('m.starred=1')
    if (q.view === 'unread') where.push('m.seen=0')
    let from = 'messages m'
    if (q.query) {
      from = 'messages m JOIN messages_fts f ON f.rowid=m.id'
      where.push('messages_fts MATCH ?'); args.push(q.query.replace(/["']/g, ' ') + '*')
    }
    return db.prepare(`SELECT m.id,m.message_id,m.att,m.role,m.spam_local,(SELECT reason FROM auto_spam WHERE message_id=m.message_id) AS spam_reason,m.to_addrs,m.account_id,m.uid,m.folder,m.thread_id,m.subject,m.from_name,m.from_addr,m.date,m.snippet,m.seen,m.starred,m.snoozed_until
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
    try { await moveMessage(getAccount(m.account_id), m.folder, m.uid, 'spam') } catch (e) {
      // Sin carpeta de spam en el servidor: se oculta solo en este equipo
      train(m, true); db.prepare('UPDATE messages SET spam_local=1 WHERE id=?').run(id); refreshBadge(); return
    }
    train(m, true)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
    refreshBadge(); void syncAccountAll(getAccount(m.account_id)).then(refreshBadge)
  })
  ipcMain.handle('mail:notspam', async (_e, id: number) => {
    const m = db.prepare('SELECT *, role AS _role, spam_local AS _local FROM messages WHERE id=?').get(id) as Row & { _role: string; _local: number }
    if (m._role === 'inbox' && m._local) {   // solo estaba oculto en local: basta con devolverlo a la bandeja
      train(m, false); trust(m.from_addr)
      db.prepare('DELETE FROM auto_spam WHERE message_id=?').run(m.message_id ?? ''); db.prepare('UPDATE messages SET spam_local=0 WHERE id=?').run(id); refreshBadge(); return
    }
    await moveMessage(getAccount(m.account_id), m.folder, m.uid, 'inbox')
    train(m, false); trust(m.from_addr)
    db.prepare('DELETE FROM auto_spam WHERE message_id=?').run(m.message_id ?? '')
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
    refreshBadge(); void syncAccountAll(getAccount(m.account_id)).then(refreshBadge)
  })
  ipcMain.handle('spam:rescan', () => rescanInbox())
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  // Autocompletado de destinatarios: gente que te ha escrito o a quien has escrito (sin spam)
  ipcMain.handle('contacts:search', (_e, q: string) => {
    const term = q.trim().toLowerCase()
    if (term.length < 1) return []
    const own = new Set(listAccounts().map(a => a.email.toLowerCase()))
    const like = `%${term.replace(/[%_]/g, '')}%`
    const map = new Map<string, { email: string; name: string; n: number; last: number }>()
    const bump = (email: string, name: string, date: number, w: number): void => {
      email = email.toLowerCase().trim()
      if (!email.includes('@') || own.has(email)) return
      const c = map.get(email) ?? { email, name: '', n: 0, last: 0 }
      c.n += w; c.last = Math.max(c.last, date); if (name && !c.name) c.name = name
      map.set(email, c)
    }
    for (const r of db.prepare("SELECT from_addr, from_name, date FROM messages WHERE role='inbox' AND spam_local=0 AND (lower(from_addr) LIKE ? OR lower(from_name) LIKE ?) ORDER BY date DESC LIMIT 400").all(like, like) as { from_addr: string; from_name: string; date: number }[])
      bump(r.from_addr, r.from_name, r.date, 1)
    // A quien has escrito pesa más: es lo que más se vuelve a usar
    for (const r of db.prepare("SELECT to_addrs, date FROM messages WHERE role='sent' AND lower(to_addrs) LIKE ? ORDER BY date DESC LIMIT 400").all(like) as { to_addrs: string; date: number }[]) {
      for (const part of r.to_addrs.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
        const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) ?? part.match(/^\s*()([^\s<>]+@[^\s<>]+)\s*$/)
        if (m && `${m[1]} ${m[2]}`.toLowerCase().includes(term)) bump(m[2], m[1], r.date, 3)
      }
    }
    return [...map.values()].sort((a, b) => (b.n - a.n) || (b.last - a.last)).slice(0, 8).map(({ email, name }) => ({ email, name }))
  })
  ipcMain.handle('compose:open', (_e, params: Record<string, unknown>) => createComposeWindow(params ?? {}))
  ipcMain.handle('mail:get', (_e, id: number) => db.prepare('SELECT * FROM messages WHERE id=?').get(id))
  ipcMain.handle('autodraft:get', (_e, id: string) => db.prepare('SELECT id,data,updated FROM autodrafts WHERE id=?').get(id))
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
  void syncAll().then(async () => {
    // Una vez tras esta actualización: aplicar los filtros a lo que ya había en la bandeja
    if (getSetting('spamRescan', '0') !== '2' && getSetting('autoSpam', '1') !== '0') { await rescanInbox().catch(() => 0); setSetting('spamRescan', '2') }
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

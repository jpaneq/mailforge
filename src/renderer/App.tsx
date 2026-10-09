import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = any
const api = () => window.api

/* ---------- Iconos (trazos tipo Lucide, sin dependencias) ---------- */
const PATHS: Record<string, string> = {
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z',
  unread: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 12h.01',
  star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  send: 'm22 2-7 20-4-9-9-4z M22 2 11 13',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 16h.01',
  shieldok: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z m-3-10 2 2 4-4',
  archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
  trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6',
  reply: 'M9 17 4 12l5-5 M20 18v-2a4 4 0 0 0-4-4H4',
  pen: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cal: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18 M12 14v3l2 1',
  plus: 'M12 5v14 M5 12h14',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z m10 2-4.3-4.3',
  x: 'M18 6 6 18 M6 6l12 12',
  clip: 'm21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8L15.8 6.7',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z m18 2-10 7L2 6'
}
function Icon({ n }: { n: string }): JSX.Element {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden>{PATHS[n].split(/ (?=M)/).map((d, i) => <path key={i} d={d} />)}</svg>
}

/* ---------- Avatar con color estable por remitente ---------- */
const GRADS = ['#5b5bf0,#8b5cf6', '#0ea5e9,#6366f1', '#10b981,#06b6d4', '#f59e0b,#ef4444', '#ec4899,#8b5cf6', '#14b8a6,#3b82f6', '#f97316,#ec4899', '#84cc16,#10b981']
function Avatar({ name, large }: { name: string; large?: boolean }): JSX.Element {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [a, b] = GRADS[h % GRADS.length].split(',')
  const ini = (name.replace(/<.*>/, '').trim().match(/[\p{L}\p{N}]/gu) ?? ['?']).slice(0, 2).join('').toUpperCase()
  return <div className={'avatar' + (large ? ' lg' : '')} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>{ini}</div>
}

const fmtTime = (t: number): string => {
  const d = new Date(t), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (now.getTime() - t < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

const VIEWS: [string, string, string][] = [
  ['inbox', 'Bandeja de entrada', 'inbox'], ['unread', 'No leídos', 'unread'], ['starred', 'Destacados', 'star'],
  ['sent', 'Enviados', 'send'], ['drafts', 'Borradores', 'file'], ['snoozed', 'Pospuestos', 'clock'], ['spam', 'Spam', 'shield']
]

export function App(): JSX.Element {
  const [accounts, setAccounts] = useState<any[]>([])
  const [account, setAccount] = useState<number | undefined>()
  const [view, setView] = useState('inbox')
  const [query, setQuery] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [counts, setCounts] = useState({ unread: 0, spam: 0 })
  const [sel, setSel] = useState<Msg | null>(null)
  const [thread, setThread] = useState<Msg[]>([])
  const [modal, setModal] = useState<'compose' | 'account' | 'scheduled' | 'tracking' | 'settings' | null>(null)
  const [reply, setReply] = useState<Msg | null>(null)
  const [draft, setDraft] = useState<Msg | null>(null)
  const [recover, setRecover] = useState<any[]>([])
  const [recovering, setRecovering] = useState<any | null>(null)
  useEffect(() => { void api().autodraft.list().then(setRecover) }, [modal])

  const load = useCallback(async () => {
    setMsgs(await api().mail.list({ account, view, query: query.trim() || undefined }))
    setCounts(await api().mail.counts())
  }, [account, view, query])

  useEffect(() => { void api().accounts.list().then(setAccounts) }, [modal])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const t = setInterval(() => void load(), 20000); return () => clearInterval(t) }, [load])
  useEffect(() => { document.title = counts.unread ? `(${counts.unread}) MailForge` : 'MailForge' }, [counts.unread])

  async function open(m: Msg): Promise<void> {
    setSel(m)
    setThread(await api().mail.thread(m.thread_id))
    if (!m.seen) { await api().mail.flag(m.id, 'seen', true); void load() }
  }
  const act = async (fn: () => Promise<unknown>): Promise<void> => { await fn(); setSel(null); void load() }
  const snooze = (hours: number): Promise<void> => act(() => api().mail.snooze(sel!.id, Date.now() + hours * 3600e3))
  const newMail = (): void => { setReply(null); setDraft(null); setRecovering(null); setModal('compose') }

  // Atajos: c redactar, / buscar
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return
      if (e.key === 'c') newMail()
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search')?.focus() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  const viewName = VIEWS.find(v => v[0] === view)?.[1] ?? ''
  const badge = (k: string): JSX.Element | null =>
    k === 'inbox' && counts.unread ? <span className="count">{counts.unread}</span>
      : k === 'spam' && counts.spam ? <span className="count warn">{counts.spam}</span> : null

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><i><Icon n="mail" /></i>MailForge</div>
        <button className="compose-btn" onClick={newMail}><Icon n="pen" />Redactar</button>
        {recover.length > 0 && <button className="recover" onClick={() => { setRecovering(recover[0]); setDraft(null); setReply(null); setModal('compose') }}><Icon n="refresh" />Recuperar borrador sin enviar ({recover.length})</button>}
        {VIEWS.map(([k, l, ic]) => (
          <button key={k} className={'nav' + (view === k ? ' on' : '')} onClick={() => { setView(k); setSel(null) }}>
            <Icon n={ic} /><span className="lbl">{l}</span>{badge(k)}
          </button>
        ))}
        <h4>Cuentas</h4>
        <button className={'nav' + (!account ? ' on' : '')} onClick={() => setAccount(undefined)}><Icon n="user" /><span className="lbl">Todas (unificada)</span></button>
        {accounts.map(a => <button key={a.id} className={'nav' + (account === a.id ? ' on' : '')} onClick={() => setAccount(a.id)}><Icon n="mail" /><span className="lbl">{a.email}</span></button>)}
        <button className="nav" onClick={() => setModal('account')}><Icon n="plus" /><span className="lbl">Añadir cuenta</span></button>
        <h4>Herramientas</h4>
        <button className="nav" onClick={() => setModal('scheduled')}><Icon n="cal" /><span className="lbl">Envíos programados</span></button>
        <button className="nav" onClick={() => setModal('tracking')}><Icon n="eye" /><span className="lbl">Seguimiento</span></button>
        <button className="nav" onClick={() => void api().mail.sync().then(load)}><Icon n="refresh" /><span className="lbl">Sincronizar</span></button>
        <div style={{ flex: 1 }} />
        <button className="nav" onClick={() => setModal('settings')}><Icon n="gear" /><span className="lbl">Ajustes</span></button>
      </aside>

      <section className="list">
        <div className="list-head">
          <h2>{viewName}{view === 'inbox' && counts.unread > 0 && <span className="count soft">{counts.unread} sin leer</span>}</h2>
          <label className="searchbox"><Icon n="search" /><input className="search" placeholder="Buscar en el correo  ( / )" value={query} onChange={e => setQuery(e.target.value)} /></label>
        </div>
        <div className="rows">
          {msgs.length === 0 && <div className="empty"><Icon n={view === 'spam' ? 'shieldok' : 'inbox'} /><div>{view === 'spam' ? 'Sin spam. Todo limpio.' : 'No hay mensajes aquí.'}</div>{accounts.length === 0 && <button className="btn primary" onClick={() => setModal('account')}>Añadir tu primera cuenta</button>}</div>}
          {msgs.map(m => {
            const who = view === 'sent' || view === 'drafts' ? (m.to_addrs || '(sin destinatario)') : (m.from_name || m.from_addr)
            return (
              <div key={m.id} className={'row' + (sel?.id === m.id ? ' on' : '') + (m.seen ? '' : ' unread')} onClick={() => void open(m)}>
                <Avatar name={who} />
                <div className="meta">
                  <div className="top"><span className="from">{who}</span><span className="time">{fmtTime(m.date)}</span></div>
                  <div className="subj">{m.starred ? <span style={{ color: '#f5b301' }}>★ </span> : null}{m.subject}{m.spam_reason && <span className="tag">auto</span>}</div>
                  <div className="snip">{m.snippet}</div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <main className="reader">
        <div className="reader-inner">
          {!sel ? <div className="empty" style={{ minHeight: '70vh' }}><Icon n="mail" /><div>Selecciona un mensaje para leerlo</div><div className="hint">Atajos: <b>c</b> redactar · <b>/</b> buscar</div></div> : (
            <>
              {sel.role === 'spam' && (
                <div className="banner"><Icon n="shield" /><div><b>{sel.spam_reason ? 'Movido a spam automáticamente' : 'Este mensaje está en spam'}</b><br /><small>{sel.spam_reason || 'Marcado como spam en tu servidor.'}</small></div>
                  <button className="tb ok" onClick={() => void act(() => api().mail.notSpam(sel.id))}><Icon n="shieldok" />No es spam</button></div>
              )}
              <h1>{sel.subject}</h1>
              <div className="toolbar">
                {sel.role === 'drafts'
                  ? <button className="tb primary" onClick={() => { setDraft(sel); setReply(null); setRecovering(null); setModal('compose') }}><Icon n="pen" />Editar borrador</button>
                  : <button className="tb primary" onClick={() => { setReply(sel); setDraft(null); setRecovering(null); setModal('compose') }}><Icon n="reply" />Responder</button>}
                <button className="tb" onClick={async () => { await api().mail.flag(sel.id, 'starred', !sel.starred); setSel({ ...sel, starred: sel.starred ? 0 : 1 }); void load() }}><Icon n="star" />{sel.starred ? 'Quitar' : 'Destacar'}</button>
                <span className="sep" />
                <button className="tb" onClick={() => void act(() => api().mail.move(sel.id, 'archive'))}><Icon n="archive" />Archivar</button>
                {sel.role !== 'spam' && sel.role !== 'drafts' && sel.role !== 'sent' && <button className="tb" onClick={() => void act(() => api().mail.spam(sel.id))}><Icon n="shield" />Spam</button>}
                <button className="tb danger" onClick={() => void act(() => api().mail.move(sel.id, 'trash'))}><Icon n="trash" />Borrar</button>
                <span className="sep" />
                <button className="tb" onClick={() => void snooze(3)}><Icon n="clock" />3 h</button>
                <button className="tb" onClick={() => void snooze(24)}>Mañana</button>
                <button className="tb" onClick={() => void snooze(168)}>1 semana</button>
              </div>
              {thread.map(t => (
                <div key={t.id} className="msg">
                  <div className="msg-head">
                    <Avatar name={t.from_name || t.from_addr} large />
                    <div><b>{t.from_name || t.from_addr}</b><small>{t.from_name ? t.from_addr + ' · ' : ''}{new Date(t.date).toLocaleString()}</small></div>
                  </div>
                  <iframe sandbox="" srcDoc={DOMPurify.sanitize(t.html || `<pre style="white-space:pre-wrap;font:inherit">${DOMPurify.sanitize(t.text)}</pre>`, { FORBID_TAGS: ['img'], FORBID_ATTR: ['srcset'] })} />
                </div>
              ))}
              <div className="hint">Las imágenes remotas se bloquean para evitar rastreadores de terceros.</div>
            </>
          )}
        </div>
      </main>

      {modal === 'compose' && <Compose accounts={accounts} reply={reply} draft={draft} recovering={recovering} onClose={() => { setModal(null); void load() }} />}
      {modal === 'account' && <AddAccount onClose={() => setModal(null)} />}
      {modal === 'scheduled' && <Scheduled onClose={() => setModal(null)} />}
      {modal === 'tracking' && <Tracking onClose={() => setModal(null)} />}
      {modal === 'settings' && <Settings accounts={accounts} onClose={() => setModal(null)} />}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): JSX.Element {
  return <div className="modal" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="card"><div className="card-head"><h3>{title}</h3><button className="iconbtn" onClick={onClose} aria-label="Cerrar"><Icon n="x" /></button></div>{children}</div>
  </div>
}

function Compose({ accounts, reply, draft, recovering, onClose }: { accounts: any[]; reply: Msg | null; draft: Msg | null; recovering: any | null; onClose: () => void }): JSX.Element {
  const rec = recovering ? JSON.parse(recovering.data) : null
  const draftId = useRef<string>(recovering?.id ?? crypto.randomUUID())
  const serverUid = useRef<number | undefined>(draft?.uid)
  const [from, setFrom] = useState(rec?.from ?? draft?.account_id ?? accounts[0]?.id)
  const [to, setTo] = useState(rec?.to ?? draft?.to_addrs ?? reply?.from_addr ?? '')
  const [cc, setCc] = useState(rec?.cc ?? ''); const [bcc, setBcc] = useState(rec?.bcc ?? '')
  const [subject, setSubject] = useState<string>(rec?.subject ?? draft?.subject ?? (reply ? 'Re: ' + reply.subject.replace(/^re:\s*/i, '') : ''))
  const [body, setBody] = useState<string>(rec?.body ?? draft?.text ?? '')
  const [track, setTrack] = useState(true)
  const [follow, setFollow] = useState(0)
  const [at, setAt] = useState('')
  const [tpls, setTpls] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [files, setFiles] = useState<{ filename: string; base64: string }[]>([])
  const [undo, setUndo] = useState(0)
  useEffect(() => { void api().templates.list().then(setTpls) }, [])

  const payload = () => ({
    to, cc: cc || undefined, bcc: bcc || undefined, subject,
    html: body.split('\n').map(l => DOMPurify.sanitize(l)).join('<br>'),
    track, followUpDays: follow || undefined, attachments: files, inReplyTo: reply?.message_id || undefined
  })
  async function addFiles(list: FileList | null): Promise<void> {
    const out = await Promise.all([...(list ?? [])].map(f => new Promise<{ filename: string; base64: string }>(res => {
      const r = new FileReader(); r.onload = () => res({ filename: f.name, base64: String(r.result).split(',')[1] }); r.readAsDataURL(f)
    })))
    setFiles(p => [...p, ...out])
  }
  const cancelled = useRef(false)
  async function send(): Promise<void> {
    try {
      if (at) { await api().send.schedule(from, payload(), new Date(at).getTime()); await discardAuto(); onClose(); return }
      // Deshacer envío: 8 s de margen antes de enviar de verdad
      setUndo(8)
      for (let i = 8; i > 0; i--) { setUndo(i); await new Promise(r => setTimeout(r, 1000)); if (cancelled.current) return }
      await api().send.now(from, payload())
      await discardAuto()
      onClose()
    } catch (e) { setErr(String(e)); setUndo(0) }
  }

  // Autoguardado: local a los 1,5 s de dejar de teclear; servidor cada 20 s si hubo cambios.
  const dirty = useRef(false)
  const latest = useRef({ from, to, cc, bcc, subject, body })
  latest.current = { from, to, cc, bcc, subject, body }
  const hasContent = !!(to || subject || body.trim())
  useEffect(() => {
    if (!hasContent) return
    dirty.current = true
    const t = setTimeout(() => { void api().autodraft.save(draftId.current, JSON.stringify(latest.current)) }, 1500)
    return () => clearTimeout(t)
  }, [from, to, cc, bcc, subject, body, hasContent])
  useEffect(() => {
    const t = setInterval(async () => {
      if (!dirty.current || !from) return
      dirty.current = false
      try { serverUid.current = (await api().send.draft(from, payload(), serverUid.current)) ?? serverUid.current } catch { dirty.current = true }
    }, 20000)
    return () => clearInterval(t)
  })
  async function discardAuto(): Promise<void> {
    await api().autodraft.delete(draftId.current)
    if (serverUid.current && from) await api().send.draftDelete(from, serverUid.current).catch(() => {})
  }

  return <Modal title={reply ? 'Responder' : 'Nuevo mensaje'} onClose={onClose}>
    <div className="hint" style={{ marginTop: -6 }}>Se guarda automáticamente. Si cierras sin enviar, podrás recuperarlo.</div>
    <label className="field"><span>De</span><select value={from} onChange={e => setFrom(Number(e.target.value))}>{accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
    <label className="field"><span>Para</span><input value={to} onChange={e => setTo(e.target.value)} autoFocus /></label>
    <label className="field"><span>Cc</span><input value={cc} onChange={e => setCc(e.target.value)} /></label>
    <label className="field"><span>Cco</span><input value={bcc} onChange={e => setBcc(e.target.value)} /></label>
    <label className="field"><span>Asunto</span><input value={subject} onChange={e => setSubject(e.target.value)} /></label>
    <select value="" onChange={e => { const t = tpls.find(x => x.id === Number(e.target.value)); if (t) { setSubject(s => s || t.subject); setBody(b => b + t.body) } }}>
      <option value="">Insertar plantilla…</option>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
    <textarea rows={11} value={body} onChange={e => setBody(e.target.value)} placeholder="Escribe tu mensaje…" />
    <div className="row-opts">
      <label className="toggle"><input type="checkbox" checked={track} onChange={e => setTrack(e.target.checked)} />Seguimiento de lectura</label>
      <label>Recordar si no responden en <select value={follow} onChange={e => setFollow(Number(e.target.value))}><option value={0}>nunca</option><option value={1}>1 día</option><option value={3}>3 días</option><option value={7}>7 días</option></select></label>
      <label>Programar: <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
    </div>
    <div className="row-opts"><Icon n="clip" /><input type="file" multiple onChange={e => void addFiles(e.target.files)} />{files.map((f, i) => <span key={i} className="pill">{f.filename}</span>)}</div>
    {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
    <div className="actions">
      {(draft || rec || hasContent) && <button className="btn" onClick={() => void discardAuto().then(onClose)}>Descartar</button>}
      <button className="btn" onClick={async () => { try { serverUid.current = (await api().send.draft(from, payload(), serverUid.current)) ?? serverUid.current; await api().autodraft.delete(draftId.current); await api().mail.sync(); onClose() } catch (e) { setErr(String(e)) } }}>Guardar borrador</button>
      {undo > 0
        ? <button className="btn" onClick={() => { cancelled.current = true; setUndo(0) }}>Deshacer envío ({undo})</button>
        : <button className="btn primary" disabled={!to || !from} onClick={() => { cancelled.current = false; void send() }}>{at ? 'Programar' : 'Enviar'}</button>}
    </div>
  </Modal>
}

function AddAccount({ onClose }: { onClose: () => void }): JSX.Element {
  const [f, setF] = useState({ email: '', name: '', password: '', imap_host: '', imap_port: 993, smtp_host: '', smtp_port: 465 })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: string, v: unknown): void => setF(p => ({ ...p, [k]: v }))
  async function email(v: string): Promise<void> {
    set('email', v)
    const preset = (await api().accounts.presets())[v.split('@')[1]?.toLowerCase()]
    if (preset) setF(p => ({ ...p, email: v, ...preset }))
  }
  async function add(): Promise<void> {
    setBusy(true); setErr('')
    try { await api().accounts.add({ ...f, user: f.email }); onClose() } catch (e) { setErr(String(e)) }
    setBusy(false)
  }
  return <Modal title="Añadir cuenta" onClose={onClose}>
    <input placeholder="Correo" value={f.email} onChange={e => void email(e.target.value)} />
    <input placeholder="Nombre" value={f.name} onChange={e => set('name', e.target.value)} />
    <input type="password" placeholder="Contraseña / contraseña de aplicación" value={f.password} onChange={e => set('password', e.target.value)} />
    <input placeholder="Servidor IMAP" value={f.imap_host} onChange={e => set('imap_host', e.target.value)} />
    <input placeholder="Servidor SMTP" value={f.smtp_host} onChange={e => set('smtp_host', e.target.value)} />
    <div className="hint">Gmail, Outlook e iCloud requieren una contraseña de aplicación. OAuth2 está en el roadmap.</div>
    {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
    <div className="actions"><button className="btn primary" disabled={busy || !f.email || !f.password} onClick={() => void add()}>{busy ? 'Conectando…' : 'Conectar'}</button></div>
  </Modal>
}

function Scheduled({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<any[]>([])
  const load = (): void => { void api().send.list().then(setRows) }
  useEffect(load, [])
  return <Modal title="Envíos programados" onClose={onClose}>
    <div className="hint">Con el relay configurado (Ajustes) se envía aunque el equipo esté apagado; sin él, la app debe estar abierta.</div>
    {rows.length === 0 ? <div className="empty"><Icon n="cal" />Nada programado</div> : <table><tbody>{rows.map(r => {
      const p = JSON.parse(r.payload)
      return <tr key={r.id}><td>{new Date(r.send_at).toLocaleString()}</td><td><b>{p.to}</b><br />{p.subject}</td>
        <td>{r.status === 'relay' ? <span className="pill ok">En el relay</span> : <span className="pill">{r.status}</span>}</td>
        <td>{(r.status === 'pending' || r.status === 'relay') && <button className="btn" onClick={() => void api().send.cancel(r.id).then(load)}>Cancelar</button>}</td></tr>
    })}</tbody></table>}
  </Modal>
}

function Tracking({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { void api().tracked.list().then(setRows) }, [])
  return <Modal title="Seguimiento de correos enviados" onClose={onClose}>
    {rows.length === 0 ? <div className="empty"><Icon n="eye" />Aún no hay correos con seguimiento</div> : <table>
      <thead><tr><th>Para / Asunto</th><th>Aperturas</th><th>Estado</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><b>{r.to_addrs}</b><br />{r.subject}</td>
        <td>{r.opens}{r.first_open ? <><br /><small>1ª: {new Date(r.first_open).toLocaleString()}</small></> : null}</td>
        <td>{r.replied ? <span className="pill ok">Respondido</span> : r.opens ? <span className="pill">Leído</span> : <span className="pill">Sin abrir</span>}</td></tr>)}</tbody></table>}
  </Modal>
}

function Settings({ accounts, onClose }: { accounts: any[]; onClose: () => void }): JSX.Element {
  const [url, setUrl] = useState(''); const [key, setKey] = useState('')
  const [relay, setRelay] = useState({ url: '', token: '' }); const [relayMsg, setRelayMsg] = useState('')
  const [autoSpam, setAutoSpam] = useState(true)
  const [tpl, setTpl] = useState({ name: '', subject: '', body: '' })
  const [tpls, setTpls] = useState<any[]>([])
  const [sigs, setSigs] = useState<Record<number, string>>({})
  const loadT = (): void => { void api().templates.list().then(setTpls) }
  useEffect(() => {
    void api().settings.get('trackerUrl').then(setUrl); void api().settings.get('trackerKey').then(setKey); loadT()
    void api().settings.get('autoSpam').then((v: string) => setAutoSpam(v !== '0'))
    void Promise.all([api().settings.get('relayUrl'), api().settings.get('relayToken')]).then(([u, t]) => setRelay({ url: u, token: t }))
  }, [])
  return <Modal title="Ajustes" onClose={onClose}>
    <h5>Spam</h5>
    <label className="toggle"><input type="checkbox" checked={autoSpam} onChange={e => { setAutoSpam(e.target.checked); void api().settings.set('autoSpam', e.target.checked ? '1' : '0') }} />
      Detección automática de spam (cabeceras del servidor, autenticación y aprendizaje de lo que marcas)</label>
    <div className="hint">Solo se mueven mensajes con evidencia fuerte. Todo queda en la carpeta Spam de tu servidor y puedes recuperarlo con «No es spam».</div>
    <h5>Servidor de seguimiento</h5>
    <input placeholder="https://mi-tracker.workers.dev" value={url} onChange={e => setUrl(e.target.value)} />
    <input placeholder="Clave (opcional)" value={key} onChange={e => setKey(e.target.value)} />
    <div className="actions"><button className="btn" onClick={() => { void api().settings.set('trackerUrl', url); void api().settings.set('trackerKey', key) }}>Guardar tracker</button></div>
    <h5>Relay de envíos programados (PC apagado)</h5>
    <input placeholder="https://mi-pc.tu-tailnet.ts.net" value={relay.url} onChange={e => setRelay({ ...relay, url: e.target.value })} />
    <input type="password" placeholder="Token del relay" value={relay.token} onChange={e => setRelay({ ...relay, token: e.target.value })} />
    <div className="actions"><small>{relayMsg}</small><button className="btn" onClick={async () => {
      await api().settings.set('relayUrl', relay.url); await api().settings.set('relayToken', relay.token)
      try { const r = await fetch(relay.url.replace(/\/$/, '') + '/health'); setRelayMsg(r.ok ? '✓ Relay conectado' : 'Respuesta ' + r.status) } catch { setRelayMsg('✗ No se pudo conectar') }
    }}>Guardar y probar</button></div>
    <h5>Firmas</h5>
    {accounts.map(a => <div key={a.id} style={{ display: 'grid', gap: 6 }}><small>{a.email}</small>
      <textarea rows={2} defaultValue={a.signature} onChange={e => setSigs(s => ({ ...s, [a.id]: e.target.value }))} />
      <div className="actions"><button className="btn" onClick={() => void api().accounts.signature(a.id, sigs[a.id] ?? a.signature)}>Guardar firma</button></div></div>)}
    <h5>Plantillas</h5>
    {tpls.map(t => <div key={t.id} className="actions" style={{ justifyContent: 'space-between' }}><span>{t.name}</span><button className="btn" onClick={() => void api().templates.delete(t.id).then(loadT)}>Borrar</button></div>)}
    <input placeholder="Nombre" value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })} />
    <input placeholder="Asunto" value={tpl.subject} onChange={e => setTpl({ ...tpl, subject: e.target.value })} />
    <textarea rows={3} placeholder="Cuerpo" value={tpl.body} onChange={e => setTpl({ ...tpl, body: e.target.value })} />
    <div className="actions"><button className="btn" disabled={!tpl.name} onClick={() => void api().templates.save(tpl).then(() => { setTpl({ name: '', subject: '', body: '' }); loadT() })}>Guardar plantilla</button></div>
  </Modal>
}

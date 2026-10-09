import { useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = any
const api = () => window.api

const VIEWS = [['inbox', 'Bandeja'], ['unread', 'No leídos'], ['starred', 'Destacados'], ['sent', 'Enviados'], ['drafts', 'Borradores'], ['snoozed', 'Pospuestos']] as const

export function App(): JSX.Element {
  const [accounts, setAccounts] = useState<any[]>([])
  const [account, setAccount] = useState<number | undefined>()
  const [view, setView] = useState('inbox')
  const [query, setQuery] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [sel, setSel] = useState<Msg | null>(null)
  const [thread, setThread] = useState<Msg[]>([])
  const [modal, setModal] = useState<'compose' | 'account' | 'scheduled' | 'tracking' | 'settings' | null>(null)
  const [reply, setReply] = useState<Msg | null>(null)
  const [draft, setDraft] = useState<Msg | null>(null)

  const load = useCallback(async () => {
    setMsgs(await api().mail.list({ account, view, query: query.trim() || undefined }))
  }, [account, view, query])

  useEffect(() => { void api().accounts.list().then(setAccounts) }, [modal])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const t = setInterval(() => void load(), 20000); return () => clearInterval(t) }, [load])

  async function open(m: Msg): Promise<void> {
    setSel(m)
    setThread(await api().mail.thread(m.thread_id))
    if (!m.seen) { await api().mail.flag(m.id, 'seen', true); void load() }
  }
  const snooze = async (hours: number): Promise<void> => {
    if (!sel) return
    await api().mail.snooze(sel.id, Date.now() + hours * 3600e3); setSel(null); void load()
  }

  // Atajos: c redactar, / buscar, s destacar
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return
      if (e.key === 'c') { setReply(null); setModal('compose') }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search')?.focus() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="app">
      <aside className="side">
        <button className="btn primary" style={{ width: '100%' }} onClick={() => { setReply(null); setDraft(null); setModal('compose') }}>✎ Redactar</button>
        <h4>Vistas</h4>
        {VIEWS.map(([k, l]) => <button key={k} className={'nav' + (view === k ? ' on' : '')} onClick={() => setView(k)}>{l}</button>)}
        <h4>Cuentas</h4>
        <button className={'nav' + (!account ? ' on' : '')} onClick={() => setAccount(undefined)}>Todas (unificada)</button>
        {accounts.map(a => <button key={a.id} className={'nav' + (account === a.id ? ' on' : '')} onClick={() => setAccount(a.id)}>{a.email}</button>)}
        <button className="nav" onClick={() => setModal('account')}>＋ Añadir cuenta</button>
        <h4>Herramientas</h4>
        <button className="nav" onClick={() => setModal('scheduled')}>⏱ Envíos programados</button>
        <button className="nav" onClick={() => setModal('tracking')}>👁 Seguimiento</button>
        <button className="nav" onClick={() => setModal('settings')}>⚙ Ajustes</button>
        <button className="nav" onClick={() => void api().mail.sync().then(load)}>⟳ Sincronizar</button>
      </aside>

      <section className="list">
        <input className="search" placeholder="Buscar (/)" value={query} onChange={e => setQuery(e.target.value)} />
        {msgs.length === 0 && <div className="empty">Sin mensajes. Añade una cuenta y sincroniza.</div>}
        {msgs.map(m => (
          <div key={m.id} className={'row' + (sel?.id === m.id ? ' on' : '') + (m.seen ? '' : ' unread')} onClick={() => void open(m)}>
            <div className="top"><span className="from">{m.from_name || m.from_addr}</span><span className="snip">{new Date(m.date).toLocaleDateString()}</span></div>
            <div className="subj">{m.starred ? '★ ' : ''}{m.subject}</div>
            <div className="snip">{m.snippet}</div>
          </div>
        ))}
      </section>

      <main className="reader">
        {!sel ? <div className="empty">Selecciona un mensaje</div> : (
          <>
            <h2>{sel.subject}</h2>
            <div className="bar">
              {sel.role === 'drafts'
                ? <button className="btn primary" onClick={() => { setDraft(sel); setReply(null); setModal('compose') }}>Editar borrador</button>
                : <button className="btn" onClick={() => { setReply(sel); setModal('compose') }}>Responder</button>}
              <button className="btn" onClick={async () => { await api().mail.flag(sel.id, 'starred', !sel.starred); void load() }}>★</button>
              <button className="btn" onClick={async () => { await api().mail.move(sel.id, 'archive'); setSel(null); void load() }}>Archivar</button>
              <button className="btn" onClick={async () => { await api().mail.move(sel.id, 'trash'); setSel(null); void load() }}>Borrar</button>
              <button className="btn" onClick={() => void snooze(3)}>Posponer 3 h</button>
              <button className="btn" onClick={() => void snooze(24)}>Mañana</button>
              <button className="btn" onClick={() => void snooze(168)}>1 semana</button>
            </div>
            {thread.map(t => (
              <div key={t.id} style={{ marginBottom: 20 }}>
                <b>{t.from_name || t.from_addr}</b> <span className="pill">{new Date(t.date).toLocaleString()}</span>
                <iframe sandbox="" srcDoc={DOMPurify.sanitize(t.html || `<pre style="white-space:pre-wrap;font:inherit">${DOMPurify.sanitize(t.text)}</pre>`, { FORBID_TAGS: ['img'], FORBID_ATTR: ['srcset'] })} />
              </div>
            ))}
            <small style={{ color: 'var(--muted)' }}>Las imágenes remotas se bloquean para evitar rastreadores de terceros.</small>
          </>
        )}
      </main>

      {modal === 'compose' && <Compose accounts={accounts} reply={reply} draft={draft} onClose={() => { setModal(null); void load() }} />}
      {modal === 'account' && <AddAccount onClose={() => setModal(null)} />}
      {modal === 'scheduled' && <Scheduled onClose={() => setModal(null)} />}
      {modal === 'tracking' && <Tracking onClose={() => setModal(null)} />}
      {modal === 'settings' && <Settings accounts={accounts} onClose={() => setModal(null)} />}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): JSX.Element {
  return <div className="modal" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="card"><div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{title}</h3><button className="btn" onClick={onClose}>✕</button></div>{children}</div>
  </div>
}

function Compose({ accounts, reply, draft, onClose }: { accounts: any[]; reply: Msg | null; draft: Msg | null; onClose: () => void }): JSX.Element {
  const [from, setFrom] = useState(draft?.account_id ?? accounts[0]?.id)
  const [to, setTo] = useState(draft?.to_addrs ?? reply?.from_addr ?? '')
  const [cc, setCc] = useState(''); const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState<string>(draft?.subject ?? (reply ? 'Re: ' + reply.subject.replace(/^re:\s*/i, '') : ''))
  const [body, setBody] = useState<string>(draft?.text ?? '')
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
  async function send(): Promise<void> {
    try {
      if (at) { await api().send.schedule(from, payload(), new Date(at).getTime()); onClose(); return }
      // Deshacer envío: 8 s de margen antes de enviar de verdad
      setUndo(8)
      for (let i = 8; i > 0; i--) { setUndo(i); await new Promise(r => setTimeout(r, 1000)); if (cancelled.current) return }
      await api().send.now(from, payload())
      if (draft) await api().mail.move(draft.id, 'trash').catch(() => {})
      onClose()
    } catch (e) { setErr(String(e)); setUndo(0) }
  }
  const cancelled = useRef(false)
  return <Modal title="Nuevo mensaje" onClose={onClose}>
    <select value={from} onChange={e => setFrom(Number(e.target.value))}>{accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select>
    <input placeholder="Para" value={to} onChange={e => setTo(e.target.value)} />
    <input placeholder="Cc" value={cc} onChange={e => setCc(e.target.value)} />
    <input placeholder="Cco" value={bcc} onChange={e => setBcc(e.target.value)} />
    <input placeholder="Asunto" value={subject} onChange={e => setSubject(e.target.value)} />
    <select value="" onChange={e => { const t = tpls.find(x => x.id === Number(e.target.value)); if (t) { setSubject(s => s || t.subject); setBody(b => b + t.body) } }}>
      <option value="">Insertar plantilla…</option>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
    <textarea rows={10} value={body} onChange={e => setBody(e.target.value)} />
    <label><input type="checkbox" style={{ width: 'auto' }} checked={track} onChange={e => setTrack(e.target.checked)} /> Seguimiento de lectura (requiere tracker en Ajustes)</label>
    <label>Recordarme si no responden en <select value={follow} onChange={e => setFollow(Number(e.target.value))}><option value={0}>nunca</option><option value={1}>1 día</option><option value={3}>3 días</option><option value={7}>7 días</option></select></label>
    <label>Programar envío: <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
    <input type="file" multiple onChange={e => void addFiles(e.target.files)} />
    {files.map((f, i) => <span key={i} className="pill">{f.filename}</span>)}
    {err && <div style={{ color: 'crimson' }}>{err}</div>}
    <button className="btn" onClick={async () => { try { await api().send.draft(from, payload()); await api().mail.sync(); onClose() } catch (e) { setErr(String(e)) } }}>Guardar borrador</button>
    {undo > 0
      ? <button className="btn" onClick={() => { cancelled.current = true; setUndo(0) }}>Deshacer envío ({undo})</button>
      : <button className="btn primary" disabled={!to || !from} onClick={() => { cancelled.current = false; void send() }}>{at ? 'Programar' : 'Enviar'}</button>}
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
  return <Modal title="Añadir cuenta IMAP/SMTP" onClose={onClose}>
    <input placeholder="Correo" value={f.email} onChange={e => void email(e.target.value)} />
    <input placeholder="Nombre" value={f.name} onChange={e => set('name', e.target.value)} />
    <input type="password" placeholder="Contraseña / contraseña de aplicación" value={f.password} onChange={e => set('password', e.target.value)} />
    <input placeholder="Servidor IMAP" value={f.imap_host} onChange={e => set('imap_host', e.target.value)} />
    <input placeholder="Servidor SMTP" value={f.smtp_host} onChange={e => set('smtp_host', e.target.value)} />
    <small>Gmail/Outlook/iCloud requieren una contraseña de aplicación. OAuth2 está en el roadmap.</small>
    {err && <div style={{ color: 'crimson' }}>{err}</div>}
    <button className="btn primary" disabled={busy || !f.email || !f.password} onClick={() => void add()}>{busy ? 'Conectando…' : 'Conectar'}</button>
  </Modal>
}

function Scheduled({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<any[]>([])
  const load = (): void => { void api().send.list().then(setRows) }
  useEffect(load, [])
  return <Modal title="Envíos programados" onClose={onClose}>
    <small>Con el relay configurado (Ajustes) se envía aunque el equipo esté apagado; sin él, la app debe estar abierta.</small>
    {rows.length === 0 ? <div className="empty">Nada programado</div> : <table><tbody>{rows.map(r => {
      const p = JSON.parse(r.payload)
      return <tr key={r.id}><td>{new Date(r.send_at).toLocaleString()}</td><td>{p.to}<br />{p.subject}</td><td>{r.status === 'relay' ? 'En el relay ✓' : r.status}</td>
        <td>{(r.status === 'pending' || r.status === 'relay') && <button className="btn" onClick={() => void api().send.cancel(r.id).then(load)}>Cancelar</button>}</td></tr>
    })}</tbody></table>}
  </Modal>
}

function Tracking({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { void api().tracked.list().then(setRows) }, [])
  return <Modal title="Seguimiento de correos enviados" onClose={onClose}>
    {rows.length === 0 ? <div className="empty">Aún no hay correos con seguimiento</div> : <table>
      <thead><tr><th>Para / Asunto</th><th>Aperturas</th><th>Estado</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.to_addrs}<br />{r.subject}</td>
        <td>{r.opens}{r.first_open ? <><br /><small>1ª: {new Date(r.first_open).toLocaleString()}</small></> : null}</td>
        <td>{r.replied ? <span className="pill">Respondido</span> : r.opens ? <span className="pill">Leído</span> : <span className="pill">Sin abrir</span>}</td></tr>)}</tbody></table>}
  </Modal>
}

function Settings({ accounts, onClose }: { accounts: any[]; onClose: () => void }): JSX.Element {
  const [url, setUrl] = useState(''); const [key, setKey] = useState('')
  const [relay, setRelay] = useState({ url: '', token: '' }); const [relayMsg, setRelayMsg] = useState('')
  const [tpl, setTpl] = useState({ name: '', subject: '', body: '' })
  const [tpls, setTpls] = useState<any[]>([])
  const [sigs, setSigs] = useState<Record<number, string>>({})
  const loadT = (): void => { void api().templates.list().then(setTpls) }
  useEffect(() => { void api().settings.get('trackerUrl').then(setUrl); void api().settings.get('trackerKey').then(setKey); loadT()
    void Promise.all([api().settings.get('relayUrl'), api().settings.get('relayToken')]).then(([u, t]) => setRelay({ url: u, token: t })) }, [])
  return <Modal title="Ajustes" onClose={onClose}>
    <b>Servidor de seguimiento</b>
    <input placeholder="https://mi-tracker.workers.dev" value={url} onChange={e => setUrl(e.target.value)} />
    <input placeholder="Clave (opcional)" value={key} onChange={e => setKey(e.target.value)} />
    <button className="btn" onClick={() => { void api().settings.set('trackerUrl', url); void api().settings.set('trackerKey', key) }}>Guardar tracker</button>
    <b>Relay de envíos programados (PC apagado)</b>
    <input placeholder="https://mi-pc.tu-tailnet.ts.net" value={relay.url} onChange={e => setRelay({ ...relay, url: e.target.value })} />
    <input type="password" placeholder="Token del relay" value={relay.token} onChange={e => setRelay({ ...relay, token: e.target.value })} />
    <button className="btn" onClick={async () => {
      await api().settings.set('relayUrl', relay.url); await api().settings.set('relayToken', relay.token)
      try { const r = await fetch(relay.url.replace(/\/$/, '') + '/health'); setRelayMsg(r.ok ? '✓ Relay conectado' : 'Respuesta ' + r.status) } catch { setRelayMsg('✗ No se pudo conectar') }
    }}>Guardar y probar</button> <small>{relayMsg}</small>
    <b>Firmas</b>
    {accounts.map(a => <div key={a.id}><small>{a.email}</small>
      <textarea rows={2} defaultValue={a.signature} onChange={e => setSigs(s => ({ ...s, [a.id]: e.target.value }))} />
      <button className="btn" onClick={() => void api().accounts.signature(a.id, sigs[a.id] ?? a.signature)}>Guardar firma</button></div>)}
    <b>Plantillas</b>
    {tpls.map(t => <div key={t.id}>{t.name} <button className="btn" onClick={() => void api().templates.delete(t.id).then(loadT)}>Borrar</button></div>)}
    <input placeholder="Nombre" value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })} />
    <input placeholder="Asunto" value={tpl.subject} onChange={e => setTpl({ ...tpl, subject: e.target.value })} />
    <textarea rows={3} placeholder="Cuerpo" value={tpl.body} onChange={e => setTpl({ ...tpl, body: e.target.value })} />
    <button className="btn" disabled={!tpl.name} onClick={() => void api().templates.save(tpl).then(() => { setTpl({ name: '', subject: '', body: '' }); loadT() })}>Guardar plantilla</button>
  </Modal>
}

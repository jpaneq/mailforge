import { getDb, getSetting } from './db'

export interface SpamInput {
  message_id?: string | null; subject: string; from_addr: string; text: string
}
export interface Verdict { spam: boolean; reason: string }

const MIN_TRAINING = 20      // mínimo de ejemplos de cada clase antes de fiarse del filtro bayesiano
const BAYES_THRESHOLD = 0.97 // muy conservador: preferimos un falso negativo a perder un correo bueno

function tokenize(m: SpamInput): string[] {
  const set = new Set<string>()
  const words = (t: string, prefix: string): void => {
    for (const w of t.toLowerCase().match(/[\p{L}\p{N}$€%!]{3,}/gu) ?? []) { set.add(prefix + w); if (set.size > 400) return }
  }
  words(m.subject, 's:')
  words(m.text.slice(0, 3000), '')
  const domain = m.from_addr.split('@')[1]
  if (domain) set.add('f:' + domain.toLowerCase())
  return [...set]
}

const count = (k: string): number => Number(getSetting(k, '0'))
const bump = (k: string, d: number): void => {
  const db = getDb()
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(0,CAST(value AS INTEGER)+?)').run(k, String(Math.max(0, d)), d)
}

/** Entrena el filtro. Si el mensaje ya se entrenó con otra clase, corrige. Devuelve false si no hizo nada. */
export function train(m: SpamInput, spam: boolean): boolean {
  if (!m.message_id) return false
  const db = getDb()
  const prev = db.prepare('SELECT cls FROM trained WHERE message_id=?').get(m.message_id) as { cls: number } | undefined
  const cls = spam ? 1 : 0
  if (prev?.cls === cls) return false
  const toks = tokenize(m)
  db.transaction(() => {
    if (prev) {
      const col = prev.cls ? 'spam' : 'ham'
      for (const t of toks) db.prepare(`UPDATE bayes SET ${col}=MAX(0,${col}-1) WHERE token=?`).run(t)
      bump(prev.cls ? 'bayes_spam' : 'bayes_ham', -1)
    }
    const col = spam ? 'spam' : 'ham'
    for (const t of toks) db.prepare(`INSERT INTO bayes(token,${col}) VALUES(?,1) ON CONFLICT(token) DO UPDATE SET ${col}=${col}+1`).run(t)
    bump(spam ? 'bayes_spam' : 'bayes_ham', 1)
    db.prepare('INSERT INTO trained(message_id,cls) VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET cls=excluded.cls').run(m.message_id, cls)
  })()
  return true
}

function bayes(m: SpamInput): number | null {
  const ns = count('bayes_spam'), nh = count('bayes_ham')
  if (ns < MIN_TRAINING || nh < MIN_TRAINING) return null
  const db = getDb()
  const probs: number[] = []
  for (const t of tokenize(m)) {
    const r = db.prepare('SELECT spam,ham FROM bayes WHERE token=?').get(t) as { spam: number; ham: number } | undefined
    if (!r || r.spam + r.ham < 2) continue
    const ps = (r.spam + 0.5) / (ns + 1), ph = (r.ham + 0.5) / (nh + 1)
    probs.push(Math.min(0.99, Math.max(0.01, ps / (ps + ph))))
  }
  const top = probs.sort((a, b) => Math.abs(b - 0.5) - Math.abs(a - 0.5)).slice(0, 15)
  if (top.length < 5) return null
  const ls = top.reduce((a, p) => a + Math.log(p), 0), lh = top.reduce((a, p) => a + Math.log(1 - p), 0)
  return 1 / (1 + Math.exp(lh - ls))
}

const hv = (h: Map<string, unknown> | undefined, k: string): string => {
  const v = h?.get(k)
  return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
}

export function isTrusted(accountId: number, from: string): boolean {
  const db = getDb(), f = from.toLowerCase()
  if (!f) return false
  if (db.prepare('SELECT 1 FROM trusted WHERE sender=?').get(f)) return true
  // Alguien a quien ya has escrito nunca es spam
  return !!db.prepare("SELECT 1 FROM messages WHERE account_id=? AND role='sent' AND instr(lower(to_addrs), ?)>0 LIMIT 1").get(accountId, f)
}
export const trust = (from: string): void => { getDb().prepare('INSERT OR IGNORE INTO trusted(sender) VALUES(?)').run(from.toLowerCase()) }

export function classify(accountId: number, m: SpamInput, headers?: Map<string, unknown>): Verdict {
  if (isTrusted(accountId, m.from_addr)) return { spam: false, reason: '' }
  const flag = hv(headers, 'x-spam-flag').toLowerCase(), status = hv(headers, 'x-spam-status').toLowerCase()
  if (flag.includes('yes') || status.startsWith('yes')) return { spam: true, reason: 'Marcado como spam por el servidor' }
  const auth = hv(headers, 'authentication-results').toLowerCase()
  const fails = ['spf=fail', 'dkim=fail', 'dmarc=fail'].filter(x => auth.includes(x)).length
  if (fails >= 2) return { spam: true, reason: 'Falla la autenticación del remitente (SPF/DKIM/DMARC)' }
  const p = bayes(m)
  if (p !== null && p >= BAYES_THRESHOLD) return { spam: true, reason: `Muy parecido a correos que marcaste como spam (${Math.round(p * 100)} %)` }
  return { spam: false, reason: '' }
}

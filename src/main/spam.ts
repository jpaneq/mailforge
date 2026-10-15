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

const SIGNALS: [RegExp, number, string][] = [
  [/viagra|cialis|casino|jackpot|loter[ií]a|lottery|bet365|apuestas? gratis/i, 3, 'apuestas/medicamentos'],
  [/gana(r)? dinero|dinero r[aá]pido|ingresos? pasivos?|trabaja desde casa|work from home|hazte rico|duplica tu (dinero|inversi[oó]n)/i, 3, 'promesas de dinero fácil'],
  [/has ganado|ganador|felicidades[^.]{0,40}(premio|gan)|you('ve| have) won|reclama tu premio|claim your (prize|reward)/i, 3, 'premio inesperado'],
  [/herencia|beneficiario|pr[eé]stamo (aprobado|r[aá]pido|sin)|transferencia (urgente|pendiente)|nigeria|mill[oó]n(es)? de (d[oó]lares|euros)/i, 3, 'estafa de dinero'],
  [/verifica(r)? tu cuenta|cuenta (suspendida|bloqueada|limitada)|tu contrase[nñ]a (caduca|ha caducado|expira)|confirm your (account|password|identity)|actividad sospechosa|unusual (sign-?in|activity)|security alert/i, 3, 'posible phishing'],
  [/oferta limitada|solo hoy|[úu]ltimas? horas|act now|limited time|100 ?% gratis|gratis!|haz clic aqu[ií]|click here|pulsa aqu[ií] para/i, 2, 'urgencia/ofertas'],
  [/bitcoin|cripto(moneda)?s?|crypto|invierte hoy|forex|trading (bot|signals)/i, 1, 'inversiones'],
  [/adelgaz|pierde \d+ ?kilos|aumenta (tu|el) (tama|rendimiento)|pastillas?|miracle|milagro/i, 2, 'salud milagro'],
  [/unsubscribe|darse de baja|cancelar suscripci[oó]n/i, -1, 'lista de correo']
]
const BAD_TLD = /\.(top|xyz|click|loan|win|icu|buzz|monster|gq|cf|tk|ml|ga|biz|work|rest|fit)$/i

/** Puntuación tipo SpamAssassin simplificada: varias señales débiles suman; una sola no basta. */
export function heuristic(m: SpamInput & { from_name?: string }): { score: number; reasons: string[] } {
  const reasons: string[] = []; let score = 0
  const add = (n: number, r: string): void => { score += n; if (n > 0) reasons.push(r) }
  const hay = `${m.subject}\n${m.text.slice(0, 4000)}`
  for (const [re, w, label] of SIGNALS) {
    if (!re.test(hay)) continue
    // Categorías de estafa (peso 3): cada coincidencia distinta suma, hasta un máximo de dos
    const distinct = w >= 3 ? new Set((hay.match(new RegExp(re.source, 'gi')) ?? []).map(x => x.toLowerCase())).size : 1
    add(w * Math.min(2, Math.max(1, distinct)), label)
  }
  const letters = m.subject.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 10 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6) add(2, 'asunto en mayúsculas')
  if (/!{2,}|¡{2,}/.test(m.subject)) add(1, 'exclamaciones')
  if (/[$€£]{2,}|\d+ ?[$€] ?(gratis|free)/i.test(m.subject)) add(2, 'símbolos de dinero')
  const domain = m.from_addr.split('@')[1] ?? ''
  if (BAD_TLD.test(domain)) add(1, 'dominio sospechoso')
  const nm = (m.from_name ?? '').match(/[\w.+-]+@([\w.-]+)/)
  if (nm && nm[1].toLowerCase() !== domain.toLowerCase()) add(3, 'el nombre simula otro remitente')
  if ((hay.match(/https?:\/\//g) ?? []).length >= 6) add(1, 'muchos enlaces')
  return { score, reasons }
}
const HEURISTIC_THRESHOLD = 5

export function classify(accountId: number, m: SpamInput & { from_name?: string }, headers?: Map<string, unknown>): Verdict {
  if (isTrusted(accountId, m.from_addr)) return { spam: false, reason: '' }
  const flag = hv(headers, 'x-spam-flag').toLowerCase(), status = hv(headers, 'x-spam-status').toLowerCase()
  if (flag.includes('yes') || status.startsWith('yes')) return { spam: true, reason: 'Marcado como spam por el servidor' }
  const auth = hv(headers, 'authentication-results').toLowerCase()
  const fails = ['spf=fail', 'dkim=fail', 'dmarc=fail'].filter(x => auth.includes(x)).length
  if (fails >= 2) return { spam: true, reason: 'Falla la autenticación del remitente (SPF/DKIM/DMARC)' }
  const p = bayes(m)
  if (p !== null && p >= BAYES_THRESHOLD) return { spam: true, reason: `Muy parecido a correos que marcaste como spam (${Math.round(p * 100)} %)` }
  const h = heuristic(m)
  if (h.score >= HEURISTIC_THRESHOLD) return { spam: true, reason: `Contenido típico de spam: ${h.reasons.join(', ')}` }
  return { spam: false, reason: '' }
}

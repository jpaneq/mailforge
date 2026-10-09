import { shell } from 'electron'
import http from 'http'
import { createHash, randomBytes } from 'crypto'
import { getSetting } from './db'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://mail.google.com/ openid email profile'

export interface GoogleTokens { refresh_token: string; access_token: string; expiry: number }
export interface GoogleProfile extends GoogleTokens { email: string; name: string }

const b64url = (b: Buffer): string => b.toString('base64url')
export const googleClient = (): { id: string; secret: string } => ({ id: getSetting('googleClientId'), secret: getSetting('googleClientSecret') })

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }> {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const j = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(`Google: ${j.error_description ?? j.error ?? res.status}`)
  return j as never
}

/** Inicio de sesión con Google (flujo de escritorio con PKCE y redirección a localhost). */
export async function googleSignIn(): Promise<GoogleProfile> {
  const { id, secret } = googleClient()
  if (!id || !secret) throw new Error('NO_CLIENT')
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset=utf-8><title>MailForge</title><body style="font:16px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f5f9;color:#181a24"><div style="text-align:center"><h2>${ok ? '✓ Cuenta conectada' : 'No se pudo conectar'}</h2><p>${ok ? 'Ya puedes cerrar esta pestaña y volver a MailForge.' : (u.searchParams.get('error') ?? 'Respuesta no válida')}</p></div>`)
      clearTimeout(timer); server.close()
      if (ok) resolve({ code: u.searchParams.get('code')!, redirect: `http://127.0.0.1:${(server.address() as { port: number } | null)?.port ?? port}/callback` })
      else reject(new Error(u.searchParams.get('error') ?? 'Autorización cancelada'))
    })
    let port = 0
    const timer = setTimeout(() => { server.close(); reject(new Error('Tiempo agotado esperando el inicio de sesión')) }, 3 * 60_000)
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      const url = `${AUTH_URL}?` + new URLSearchParams({
        client_id: id, redirect_uri: `http://127.0.0.1:${port}/callback`, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent'
      })
      void shell.openExternal(url)
    })
  })

  const t = await tokenRequest({ code: code.code, client_id: id, client_secret: secret, redirect_uri: code.redirect, grant_type: 'authorization_code', code_verifier: verifier })
  if (!t.refresh_token) throw new Error('Google no devolvió permiso renovable. Quita el acceso de MailForge en myaccount.google.com/permissions y vuelve a intentarlo.')
  const claims = JSON.parse(Buffer.from((t.id_token ?? '..').split('.')[1] ?? '', 'base64url').toString() || '{}') as { email?: string; name?: string }
  if (!claims.email) throw new Error('No se pudo leer el correo de la cuenta de Google')
  return { email: claims.email, name: claims.name ?? claims.email, refresh_token: t.refresh_token, access_token: t.access_token, expiry: Date.now() + t.expires_in * 1000 }
}

export async function refreshGoogle(refresh_token: string): Promise<GoogleTokens> {
  const { id, secret } = googleClient()
  const t = await tokenRequest({ client_id: id, client_secret: secret, refresh_token, grant_type: 'refresh_token' })
  return { refresh_token, access_token: t.access_token, expiry: Date.now() + t.expires_in * 1000 }
}

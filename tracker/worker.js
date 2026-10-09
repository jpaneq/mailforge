// Servidor de seguimiento mínimo para Cloudflare Workers (plan gratuito).
// Despliegue: wrangler kv namespace create OPENS; enlazarlo como OPENS; var KEY opcional.
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/o\/([\w-]+)\.gif$/)
    if (m) {
      const id = m[1]
      const cur = JSON.parse((await env.OPENS.get(id)) || '{"opens":0}')
      const now = Date.now()
      // Evita contar el pre-fetch inmediato de proxies (Apple MPP, Gmail) como lectura real: se registra igual, el cliente decide.
      await env.OPENS.put(id, JSON.stringify({ opens: cur.opens + 1, first: cur.first || now, last: now }))
      return new Response(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' } })
    }
    if (url.pathname === '/stats') {
      if (env.KEY && req.headers.get('authorization') !== `Bearer ${env.KEY}`) return new Response('forbidden', { status: 403 })
      const out = {}
      for (const id of (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 200)) {
        const v = await env.OPENS.get(id)
        if (v) out[id] = JSON.parse(v)
      }
      return Response.json(out)
    }
    return new Response('MailForge tracker', { status: 200 })
  }
}

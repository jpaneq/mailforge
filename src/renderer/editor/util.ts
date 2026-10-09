import DOMPurify from 'dompurify'

/** Lee una imagen y la reduce (máx. `maxW` px de ancho) para que el correo no pese de más. */
export function fileToDataUrl(file: File, maxW = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(fr.error)
    fr.onload = () => {
      const src = String(fr.result)
      if (file.type === 'image/gif' || file.type === 'image/svg+xml') return resolve(src) // no se tocan (animación / vectorial)
      const img = new Image()
      img.onerror = () => reject(new Error('Imagen no válida'))
      img.onload = () => {
        if (img.width <= maxW) return resolve(src)
        const c = document.createElement('canvas')
        c.width = maxW; c.height = Math.round(img.height * maxW / img.width)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88))
      }
      img.src = src
    }
    fr.readAsDataURL(file)
  })
}

export function fileToBase64(file: File): Promise<{ filename: string; base64: string; size: number }> {
  return new Promise(res => {
    const r = new FileReader()
    r.onload = () => res({ filename: file.name, base64: String(r.result).split(',')[1], size: file.size })
    r.readAsDataURL(file)
  })
}

export const fmtSize = (n: number): string => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

/** Limpia el HTML y le pone estilos en línea: los clientes de correo ignoran las hojas de estilo. */
export function emailize(html: string): string {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['style', 'width', 'colspan', 'rowspan', 'data-mf-sig'], ADD_DATA_URI_TAGS: ['img'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i })
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
  const set = (sel: string, css: string): void => doc.querySelectorAll<HTMLElement>(sel).forEach(el => { el.style.cssText = css + ';' + el.style.cssText })
  set('table', 'border-collapse:collapse;margin:8px 0')
  set('td, th', 'border:1px solid #c9ccd6;padding:6px 10px;vertical-align:top')
  set('th', 'background:#f1f2f7;font-weight:600;text-align:left')
  set('blockquote', 'margin:8px 0 8px 4px;padding:2px 0 2px 12px;border-left:3px solid #c9ccd6;color:#5b6073')
  set('p', 'margin:0 0 .7em')
  set('pre', 'background:#f3f4f8;padding:10px;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;overflow:auto')
  set('code', 'font-family:Menlo,Consolas,monospace;background:#f3f4f8;padding:1px 4px;border-radius:4px')
  set('img', 'max-width:100%;height:auto')
  set('a', 'color:#4f46e5')
  set('hr', 'border:0;border-top:1px solid #c9ccd6;margin:14px 0')
  set('ul, ol', 'margin:0 0 .7em;padding-left:24px')
  doc.querySelectorAll('mark').forEach(m => { (m as HTMLElement).style.color = 'inherit' })
  return doc.body.innerHTML
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Cita del mensaje original para las respuestas. */
export function quoteHtml(m: { from_name?: string; from_addr: string; date: number; html?: string; text?: string }): string {
  const body = m.html
    ? DOMPurify.sanitize(m.html, { FORBID_TAGS: ['style', 'script', 'iframe', 'form'], ADD_DATA_URI_TAGS: ['img'] })
    : `<p>${esc(m.text ?? '').replace(/\n/g, '<br>')}</p>`
  const who = esc(m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr)
  return `<p></p><p>El ${esc(new Date(m.date).toLocaleString())}, ${who} escribió:</p><blockquote>${body}</blockquote>`
}

export const sigBlock = (html: string): string => (html ? `<div data-mf-sig="1">${html}</div>` : '')

/** HTML recibido para mostrar en el lector: sin scripts ni imágenes remotas (anti-rastreo); las incrustadas (data:) sí. */
export function readerHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['form'], FORBID_ATTR: ['srcset'], ADD_DATA_URI_TAGS: ['img'] })
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
  doc.querySelectorAll('img').forEach(i => { if (!/^data:image\//i.test(i.getAttribute('src') ?? '')) i.remove() })
  return doc.body.innerHTML
}

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'

type Tool = 'pen' | 'marker' | 'arrow' | 'rect' | 'ellipse' | 'text'
const TOOLS: [Tool, string, string][] = [['pen', 'brush', 'Lápiz'], ['marker', 'highlight', 'Marcador'], ['arrow', 'arrow', 'Flecha'], ['rect', 'square', 'Rectángulo'], ['ellipse', 'circle', 'Elipse'], ['text', 'text', 'Texto']]
const COLORS = ['#e5484d', '#f76808', '#f5b301', '#1fa971', '#0090ff', '#8e4ec6', '#000000', '#ffffff']
const SIZES = [3, 6, 10, 16]
const MAX_W = 1600

export function ImageAnnotator({ src, onSave, onCancel }: { src: string; onSave: (dataUrl: string) => void; onCancel: () => void }): JSX.Element {
  const cv = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [history, setHistory] = useState(0)
  const stack = useRef<ImageData[]>([])
  const drag = useRef<{ x: number; y: number; snap: ImageData } | null>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const original = useRef<HTMLImageElement | null>(null)

  const draw = (): void => {
    const c = cv.current!, img = original.current!
    const k = Math.min(1, MAX_W / img.naturalWidth)
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    stack.current = []; setHistory(0)
  }
  useEffect(() => {
    const img = new Image(); original.current = img
    img.onload = draw; img.src = src
  }, [src])  // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = (): CanvasRenderingContext2D => cv.current!.getContext('2d', { willReadFrequently: true })!
  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const r = cv.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * cv.current!.width / r.width, y: (e.clientY - r.top) * cv.current!.height / r.height }
  }
  const style = (g: CanvasRenderingContext2D): void => {
    g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'
    g.lineWidth = tool === 'marker' ? size * 3 : size
    g.globalAlpha = tool === 'marker' ? 0.35 : 1
  }
  const shape = (g: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void => {
    g.beginPath()
    if (tool === 'rect') g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    else if (tool === 'ellipse') { g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); g.stroke() }
    else if (tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x), h = Math.max(14, size * 4)
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke()
      g.beginPath(); g.moveTo(b.x, b.y)
      g.lineTo(b.x - h * Math.cos(ang - Math.PI / 6), b.y - h * Math.sin(ang - Math.PI / 6))
      g.lineTo(b.x - h * Math.cos(ang + Math.PI / 6), b.y - h * Math.sin(ang + Math.PI / 6)); g.closePath(); g.fill()
    }
  }

  const down = (e: React.PointerEvent): void => {
    if (textAt) return
    const g = ctx(), p = pos(e)
    if (tool === 'text') {
      const r = cv.current!.getBoundingClientRect()
      setTextAt({ x: p.x, y: p.y, left: e.clientX - r.left, top: e.clientY - r.top }); return
    }
    cv.current!.setPointerCapture(e.pointerId)
    drag.current = { ...p, snap: g.getImageData(0, 0, cv.current!.width, cv.current!.height) }
    if (tool === 'pen' || tool === 'marker') { style(g); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.01, p.y); g.stroke() }
  }
  const move = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const g = ctx(), p = pos(e)
    if (tool === 'pen' || tool === 'marker') {
      // El marcador es translúcido: se repinta desde la instantánea para que no se acumule opacidad
      if (tool === 'marker') { g.putImageData(drag.current.snap, 0, 0); style(g); g.beginPath(); pts.current.push(p); pts.current.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.stroke() }
      else { style(g); g.lineTo(p.x, p.y); g.stroke() }
    } else { g.putImageData(drag.current.snap, 0, 0); style(g); shape(g, drag.current, p) }
  }
  const pts = useRef<{ x: number; y: number }[]>([])
  const downWrap = (e: React.PointerEvent): void => { pts.current = [pos(e)]; down(e) }
  const up = (): void => {
    if (!drag.current) return
    stack.current.push(drag.current.snap); if (stack.current.length > 30) stack.current.shift()
    ctx().globalAlpha = 1; drag.current = null; setHistory(stack.current.length)
  }
  const undo = (): void => {
    const s = stack.current.pop(); if (s) ctx().putImageData(s, 0, 0); setHistory(stack.current.length)
  }
  const commitText = (value: string): void => {
    if (textAt && value.trim()) {
      const g = ctx()
      stack.current.push(g.getImageData(0, 0, cv.current!.width, cv.current!.height)); setHistory(stack.current.length)
      g.globalAlpha = 1; g.fillStyle = color; g.textBaseline = 'top'
      const fs = size * 4 + 12; g.font = `700 ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`
      // Contorno para que se lea sobre cualquier fondo
      g.lineWidth = Math.max(3, fs / 8); g.strokeStyle = color === '#ffffff' ? '#000000' : '#ffffff'; g.lineJoin = 'round'
      value.split('\n').forEach((ln, i) => { g.strokeText(ln, textAt.x, textAt.y + i * fs * 1.2); g.fillText(ln, textAt.x, textAt.y + i * fs * 1.2) })
    }
    setTextAt(null)
  }
  const save = (): void => onSave(cv.current!.toDataURL(src.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png', 0.92))

  return (
    <div className="modal annot" onMouseDown={e => e.stopPropagation()}>
      <div className="annot-box">
        <div className="annot-bar">
          <div className="group">{TOOLS.map(([t, ic, l]) => <button key={t} type="button" className={'tbtn' + (tool === t ? ' on' : '')} title={l} onClick={() => setTool(t)}><Icon n={ic} /></button>)}</div>
          <div className="group">{COLORS.map(c => <button key={c} type="button" className={'sw' + (color === c ? ' sel' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
          <div className="group">{SIZES.map(s => <button key={s} type="button" className={'dot' + (size === s ? ' on' : '')} onClick={() => setSize(s)} aria-label={`Grosor ${s}`}><i style={{ width: s + 2, height: s + 2 }} /></button>)}</div>
          <div className="group">
            <button type="button" className="chip" onClick={undo} disabled={!history}><Icon n="undo" />Deshacer</button>
            <button type="button" className="chip" onClick={draw}>Reiniciar</button>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn primary" onClick={save}><Icon n="check" />Guardar</button>
        </div>
        <div className="annot-stage">
          <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
            <canvas ref={cv} className={'annot-canvas' + (tool === 'text' ? ' text' : '')} onPointerDown={downWrap} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            {textAt && <textarea autoFocus className="annot-text" style={{ left: textAt.left, top: textAt.top, color }} placeholder="Escribe y pulsa Intro"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText((e.target as HTMLTextAreaElement).value) } if (e.key === 'Escape') setTextAt(null) }}
              onBlur={e => commitText(e.target.value)} />}
          </div>
        </div>
      </div>
    </div>
  )
}

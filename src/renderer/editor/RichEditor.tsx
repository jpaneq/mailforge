import { useEffect, useRef, useState } from 'react'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import { FontSize, ResizableImage, Signature } from './extensions'
import { fileToDataUrl } from './util'
import { ImageAnnotator } from './ImageAnnotator'
import { Icon } from '../icons'

const FONTS: [string, string][] = [
  ['Predeterminada', ''], ['Arial', 'Arial, Helvetica, sans-serif'], ['Verdana', 'Verdana, Geneva, sans-serif'], ['Tahoma', 'Tahoma, Geneva, sans-serif'],
  ['Trebuchet', '"Trebuchet MS", sans-serif'], ['Georgia', 'Georgia, serif'], ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Garamond', 'Garamond, serif'], ['Courier New', '"Courier New", Courier, monospace']
]
const SIZES = ['10px', '12px', '13px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px']
const PALETTE = ['#000000', '#5b6073', '#e5484d', '#f76808', '#f5b301', '#1fa971', '#0090ff', '#5b5bf0', '#8e4ec6', '#e93d82', '#ffffff']
const HILITE = ['#fff3a3', '#ffd8a8', '#ffc9c9', '#d3f9d8', '#c5f6fa', '#d0ebff', '#e5dbff', '#fcc2d7']

/* eslint-disable @typescript-eslint/no-explicit-any */
type Chain = any

function Btn({ ic, label, on, onClick, disabled }: { ic?: string; label?: string; on?: boolean; onClick: () => void; disabled?: boolean }): JSX.Element {
  return <button type="button" className={'tbtn' + (on ? ' on' : '')} title={label} aria-label={label} disabled={disabled}
    onMouseDown={e => e.preventDefault()} onClick={onClick}>{ic ? <Icon n={ic} /> : label}</button>
}

function Swatches({ colors, onPick, onClear, clearLabel }: { colors: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string }): JSX.Element {
  return <div className="pop" onMouseDown={e => e.preventDefault()}>
    <div className="swatches">{colors.map(c => <button key={c} type="button" className="sw" style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />)}</div>
    <input type="color" onChange={e => onPick(e.target.value)} title="Otro color" />
    <button type="button" className="link-btn" onClick={onClear}>{clearLabel}</button>
  </div>
}

export interface RichEditorProps {
  initialHtml: string
  placeholder?: string
  minHeight?: number
  onChange?: (html: string, text: string) => void
  onReady?: (ed: Editor) => void
  onAttachFiles?: (files: File[]) => void
  fill?: boolean
}

export function RichEditor({ initialHtml, placeholder, minHeight = 260, onChange, onReady, onAttachFiles, fill }: RichEditorProps): JSX.Element {
  const [menu, setMenu] = useState<'color' | 'hl' | 'table' | 'link' | null>(null)
  const [link, setLink] = useState('')
  const [annot, setAnnot] = useState<{ src: string; pos: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef(onAttachFiles); attachRef.current = onAttachFiles

  const insertImages = async (ed: Editor, files: File[]): Promise<void> => {
    for (const f of files) {
      const src = await fileToDataUrl(f)
      ed.chain().focus().setImage({ src, alt: f.name }).run()
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Underline, TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: placeholder ?? 'Escribe tu mensaje…' }),
      ResizableImage.configure({ allowBase64: true }), Signature
    ],
    content: initialHtml,
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML(), e.getText()),
    editorProps: {
      handlePaste: (_v, ev) => {
        const files = [...(ev.clipboardData?.files ?? [])]
        if (!files.length) return false
        const imgs = files.filter(f => f.type.startsWith('image/'))
        if (imgs.length && editorRef.current) void insertImages(editorRef.current, imgs)
        const rest = files.filter(f => !f.type.startsWith('image/'))
        if (rest.length) attachRef.current?.(rest)
        return true
      },
      handleDrop: (_v, ev) => {
        const files = [...((ev as DragEvent).dataTransfer?.files ?? [])]
        if (!files.length) return false
        const imgs = files.filter(f => f.type.startsWith('image/'))
        if (imgs.length && editorRef.current) void insertImages(editorRef.current, imgs)
        const rest = files.filter(f => !f.type.startsWith('image/'))
        if (rest.length) attachRef.current?.(rest)
        return true
      }
    }
  })
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor
  useEffect(() => { if (editor) onReady?.(editor) }, [editor])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return <div />
  const c = (): Chain => editor.chain().focus()
  const attrs = editor.getAttributes('textStyle')
  const heading = [1, 2, 3].find(l => editor.isActive('heading', { level: l })) ?? 0
  const inTable = editor.isActive('table')
  const img = editor.isActive('image')
  const close = (): void => setMenu(null)

  const applyLink = (): void => {
    if (!link.trim()) c().unsetLink().run()
    else c().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|tel:)/i.test(link) ? link : 'https://' + link }).run()
    setLink(''); close()
  }
  const setImgWidth = (w: string | null): void => { c().updateAttributes('image', { width: w }).run() }

  return (
    <div className={'editor-wrap' + (fill ? ' fill' : '')}>
      <div className="etoolbar" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
        <Btn ic="undo" label="Deshacer" onClick={() => c().undo().run()} disabled={!editor.can().undo()} />
        <Btn ic="redo" label="Rehacer" onClick={() => c().redo().run()} disabled={!editor.can().redo()} />
        <span className="vsep" />
        <select title="Estilo" value={heading} onChange={e => { const l = Number(e.target.value); l ? c().setHeading({ level: l as 1 | 2 | 3 }).run() : c().setParagraph().run() }}>
          <option value={0}>Párrafo</option><option value={1}>Título 1</option><option value={2}>Título 2</option><option value={3}>Título 3</option>
        </select>
        <select title="Tipo de letra" value={attrs.fontFamily ?? ''} onChange={e => e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run()} style={{ width: 118 }}>
          {FONTS.map(([n, v]) => <option key={n} value={v}>{n}</option>)}
        </select>
        <select title="Tamaño" value={attrs.fontSize ?? ''} onChange={e => e.target.value ? c().setMark('textStyle', { fontSize: e.target.value }).run() : c().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()} style={{ width: 66 }}>
          <option value="">Tamaño</option>{SIZES.map(s => <option key={s} value={s}>{parseInt(s)}</option>)}
        </select>
        <span className="vsep" />
        <Btn ic="bold" label="Negrita (⌘B)" on={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
        <Btn ic="italic" label="Cursiva (⌘I)" on={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
        <Btn ic="underline" label="Subrayado (⌘U)" on={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
        <Btn ic="strike" label="Tachado" on={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
        <div className="menu-anchor">
          <Btn ic="textcolor" label="Color del texto" on={menu === 'color'} onClick={() => setMenu(menu === 'color' ? null : 'color')} />
          <span className="cbar" style={{ background: attrs.color ?? 'var(--text)' }} />
          {menu === 'color' && <Swatches colors={PALETTE} onPick={col => { c().setColor(col).run(); close() }} onClear={() => { c().unsetColor().run(); close() }} clearLabel="Quitar color" />}
        </div>
        <div className="menu-anchor">
          <Btn ic="highlight" label="Resaltar" on={menu === 'hl' || editor.isActive('highlight')} onClick={() => setMenu(menu === 'hl' ? null : 'hl')} />
          {menu === 'hl' && <Swatches colors={HILITE} onPick={col => { c().setHighlight({ color: col }).run(); close() }} onClear={() => { c().unsetHighlight().run(); close() }} clearLabel="Quitar resaltado" />}
        </div>
        <Btn ic="clearfmt" label="Borrar formato" onClick={() => c().unsetAllMarks().clearNodes().run()} />
        <span className="vsep" />
        <Btn ic="alignl" label="Alinear a la izquierda" on={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()} />
        <Btn ic="alignc" label="Centrar" on={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()} />
        <Btn ic="alignr" label="Alinear a la derecha" on={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()} />
        <span className="vsep" />
        <Btn ic="list" label="Lista con viñetas" on={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
        <Btn ic="listol" label="Lista numerada" on={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
        <Btn ic="quote" label="Cita" on={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
        <Btn ic="code" label="Código" on={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()} />
        <Btn ic="minus" label="Línea horizontal" onClick={() => c().setHorizontalRule().run()} />
        <span className="vsep" />
        <div className="menu-anchor">
          <Btn ic="link" label="Enlace" on={editor.isActive('link') || menu === 'link'} onClick={() => { setLink(editor.getAttributes('link').href ?? ''); setMenu(menu === 'link' ? null : 'link') }} />
          {menu === 'link' && <div className="pop linkpop" onMouseDown={e => e.stopPropagation()}>
            <input autoFocus placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }} />
            <button type="button" className="link-btn" onClick={applyLink}>Aplicar</button>
          </div>}
        </div>
        <div className="menu-anchor">
          <Btn ic="table" label="Tabla" on={inTable || menu === 'table'} onClick={() => setMenu(menu === 'table' ? null : 'table')} />
          {menu === 'table' && <div className="pop menu-list" onMouseDown={e => e.preventDefault()}>
            {!inTable && <button type="button" onClick={() => { c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); close() }}>Insertar tabla 3×3</button>}
            {!inTable && <button type="button" onClick={() => { c().insertTable({ rows: 5, cols: 4, withHeaderRow: true }).run(); close() }}>Insertar tabla 5×4</button>}
            {inTable && <>
              <button type="button" onClick={() => { c().addRowBefore().run(); close() }}>Fila encima</button>
              <button type="button" onClick={() => { c().addRowAfter().run(); close() }}>Fila debajo</button>
              <button type="button" onClick={() => { c().addColumnBefore().run(); close() }}>Columna a la izquierda</button>
              <button type="button" onClick={() => { c().addColumnAfter().run(); close() }}>Columna a la derecha</button>
              <button type="button" onClick={() => { c().toggleHeaderRow().run(); close() }}>Alternar fila de cabecera</button>
              <button type="button" onClick={() => { c().mergeOrSplit().run(); close() }}>Combinar / dividir celdas</button>
              <button type="button" className="danger" onClick={() => { c().deleteRow().run(); close() }}>Eliminar fila</button>
              <button type="button" className="danger" onClick={() => { c().deleteColumn().run(); close() }}>Eliminar columna</button>
              <button type="button" className="danger" onClick={() => { c().deleteTable().run(); close() }}>Eliminar tabla</button>
            </>}
          </div>}
        </div>
        <Btn ic="image" label="Insertar imagen" onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { void insertImages(editor, [...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>

      {img && (
        <div className="etoolbar imgbar" onMouseDown={e => e.preventDefault()}>
          <span className="imgbar-l"><Icon n="image" />Imagen</span>
          {[['25%', '25 %'], ['50%', '50 %'], ['75%', '75 %'], ['100%', '100 %']].map(([w, l]) => (
            <button key={w} type="button" className={'chip' + (editor.getAttributes('image').width === w ? ' on' : '')} onClick={() => setImgWidth(w)}>{l}</button>
          ))}
          <button type="button" className="chip" onClick={() => setImgWidth(null)}>Original</button>
          <span className="vsep" />
          <button type="button" className="chip accent" onClick={() => setAnnot({ src: editor.getAttributes('image').src, pos: editor.state.selection.from })}><Icon n="brush" />Dibujar sobre la imagen</button>
          <button type="button" className="chip danger" onClick={() => c().deleteSelection().run()}><Icon n="trash" />Quitar</button>
        </div>
      )}

      <EditorContent editor={editor} className="ebody" style={{ ['--min-h' as string]: `${minHeight}px` }} onClick={close} />
      {annot && <ImageAnnotator src={annot.src} onCancel={() => setAnnot(null)} onSave={dataUrl => {
        editor.chain().focus().setNodeSelection(annot.pos).updateAttributes('image', { src: dataUrl }).run(); setAnnot(null)
      }} />}
    </div>
  )
}

import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'

/** Tamaño de letra como atributo de textStyle (font-size inline, compatible con clientes de correo). */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => (el as HTMLElement).style.fontSize || null,
          renderHTML: attrs => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {})
        }
      }
    }]
  }
})

/** Imagen con ancho ajustable. */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: el => el.getAttribute('width') || (el as HTMLElement).style.width || null,
        renderHTML: attrs => (attrs.width ? { width: attrs.width, style: `width: ${attrs.width}; max-width: 100%; height: auto` } : { style: 'max-width: 100%; height: auto' })
      }
    }
  }
})

/** Bloque de firma: editable, y localizable para poder cambiarla al cambiar de cuenta. */
export const Signature = Node.create({
  name: 'signature',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-mf-sig]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-mf-sig': '1', class: 'mf-sig' }), 0] }
})

import { createRoot } from 'react-dom/client'
import { App, ComposeWindow } from './App'
import './styles.css'

// Ventana de redacción independiente: se abre con #compose=<json>
const m = location.hash.match(/^#compose=(.*)$/)
let params: Record<string, unknown> | null = null
if (m) { try { params = JSON.parse(decodeURIComponent(m[1])) } catch { params = {} } }

createRoot(document.getElementById('root')!).render(params ? <ComposeWindow params={params} /> : <App />)

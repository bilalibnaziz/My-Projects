import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, useUi } from './ui/uiStore'
// Fonts ship inside the app: Jiro works fully offline
import '@fontsource-variable/inter'
import '@fontsource/caveat/500.css'
import '@fontsource/caveat/700.css'
import './index.css'

applyTheme(useUi.getState().theme)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useUi.getState().theme))
// The desktop app has its own menus; keep the webview's default context menu out of the way on the board
window.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { isTauri } from '@/lib/files'
import { openUrl } from '@/ui/boardIo'
import { whatsappUrl } from './collab'

/** 'app' = the WhatsApp desktop app (whatsapp:// links), 'inside' = WhatsApp Web in a Jiro window */
export type WhatsAppMode = 'inside' | 'app'
const KEY = 'jiro.whatsapp'

let appInstalled: boolean | null = null

/** Checks once whether the WhatsApp desktop app is installed (desktop only) */
export async function detectWhatsAppApp(): Promise<boolean> {
  if (!isTauri()) return false
  if (appInstalled === null) appInstalled = await invoke<boolean>('whatsapp_app_installed').catch(() => false)
  return appInstalled
}

const stored = (): WhatsAppMode | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'app' || v === 'inside' ? v : null
  } catch {
    return null
  }
}

/** Your choice if you made one; otherwise the app when it's installed, else the Jiro window */
export function whatsappMode(): WhatsAppMode {
  if (!isTauri()) return 'app'
  return stored() ?? (appInstalled ? 'app' : 'inside')
}
export function setWhatsappMode(m: WhatsAppMode) {
  try {
    localStorage.setItem(KEY, m)
  } catch { /* blocked */ }
}

const digitsOf = (phone?: string) => phone?.replace(/[^\d]/g, '') || undefined

/** web.whatsapp.com URL for a chat with the message typed in (needs a number; without one WhatsApp asks who) */
export function whatsappWebUrl(text: string, phone?: string): string {
  const d = digitsOf(phone)
  return d ? `https://web.whatsapp.com/send?phone=${d}&text=${encodeURIComponent(text)}` : 'https://web.whatsapp.com/'
}

/** whatsapp:// link the desktop app opens straight into the chat with the message typed in */
export function whatsappAppUrl(text: string, phone?: string): string {
  const d = digitsOf(phone)
  return `whatsapp://send?${d ? `phone=${d}&` : ''}text=${encodeURIComponent(text)}`
}

async function copyForPicking(text: string) {
  await navigator.clipboard.writeText(text).catch(() => {})
  toast.success('Message copied', { description: 'Pick a chat or group in WhatsApp and paste it (⌘V).' })
}

/** Open WhatsApp ready to send `text` to `phone`: the WhatsApp app, the Jiro window, or wa.me in a browser */
export async function sendWhatsApp(text: string, phone?: string) {
  if (!isTauri()) return void (await openUrl(whatsappUrl(text, phone)))
  const installed = await detectWhatsAppApp()
  const mode = whatsappMode()
  if (mode === 'app' && installed) {
    try {
      await invoke('open_whatsapp_app', { url: whatsappAppUrl(text, phone) })
      if (!digitsOf(phone)) await copyForPicking(text)
      return
    } catch (e) {
      toast.error('Could not open the WhatsApp app', { description: String(e) })
    }
  }
  try {
    await invoke('open_whatsapp', { url: whatsappWebUrl(text, phone) })
    if (!digitsOf(phone)) await copyForPicking(text)
  } catch (e) {
    toast.error('Could not open WhatsApp', { description: `${String(e)} — opening it in your browser instead.` })
    await openUrl(whatsappUrl(text, phone))
  }
}

/** The green WhatsApp button: open whichever WhatsApp you use (first time in Jiro: scan the QR code) */
export async function openWhatsAppWindow() {
  if (!isTauri()) return void (await openUrl('https://web.whatsapp.com/'))
  const installed = await detectWhatsAppApp()
  try {
    if (whatsappMode() === 'app' && installed) await invoke('open_whatsapp_app', { url: 'whatsapp://' })
    else await invoke('open_whatsapp', { url: 'https://web.whatsapp.com/' })
  } catch (e) {
    toast.error('Could not open WhatsApp', { description: String(e) })
  }
}

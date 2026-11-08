// File I/O that works in the Tauri desktop shell (native dialogs + Rust writes) and in a plain
// browser (download links / file inputs) for development.
import { invoke } from '@tauri-apps/api/core'

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Save a file. Returns the path (desktop) or file name (browser), or null if cancelled. */
export async function saveFile(name: string, data: Blob, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: name, filters: [filter] })
    if (!path) return null
    await invoke('write_file', { path, dataBase64: await blobToBase64(data) })
    return path
  }
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

/** Pick and read a text file. */
export async function openTextFile(filter: { name: string; extensions: string[] }): Promise<{ name: string; text: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ multiple: false, filters: [filter] })
    if (!path || Array.isArray(path)) return null
    const text = await invoke<string>('read_text_file', { path })
    return { name: path.split(/[\\/]/).pop() ?? path, text }
  }
  return new Promise((res) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = filter.extensions.map((e) => '.' + e).join(',')
    inp.onchange = async () => {
      const f = inp.files?.[0]
      res(f ? { name: f.name, text: await f.text() } : null)
    }
    inp.oncancel = () => res(null)
    inp.click()
  })
}

/** Pick image files (browser input works in Tauri's webview too) */
export function pickImages(): Promise<File[]> {
  return new Promise((res) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.multiple = true
    inp.onchange = () => res([...(inp.files ?? [])])
    inp.oncancel = () => res([])
    inp.click()
  })
}

export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'board'
}

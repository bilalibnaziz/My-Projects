import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUi } from '@/ui/uiStore'
import { hasShareLink } from './collab'

/** Ask the app to open a shared board from any text containing a Jiro link */
export const openSharedText = (text: string) => window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: text }))

export function OpenLinkDialog() {
  const open = useUi((s) => s.linkOpen)
  const [text, setText] = useState('')
  const ok = hasShareLink(text)
  return (
    <Dialog open={open} onOpenChange={(o) => { useUi.getState().set({ linkOpen: o }); if (!o) setText('') }}>
      <DialogContent data-ui data-link-dialog>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="size-5" /> Open a shared board</DialogTitle>
          <DialogDescription>Paste the Jiro link, or the whole email / WhatsApp message it came in.</DialogDescription>
        </DialogHeader>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={5} autoFocus placeholder="jiro://open?b=…" aria-label="Shared link" className="w-full resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => useUi.getState().set({ linkOpen: false })}>Cancel</Button>
          <Button disabled={!ok} onClick={() => { openSharedText(text); useUi.getState().set({ linkOpen: false }); setText('') }} data-open-link>Open board</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

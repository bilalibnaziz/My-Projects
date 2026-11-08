import { ToolButton } from '@/ui/ToolButton'
import { openWhatsAppWindow } from './whatsapp'

/** WhatsApp's mark, drawn inline (green), for the top bar / home screen */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
      <path fill="#fff" d="M17.3 14.6c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1l-.9 1.1c-.2.2-.3.2-.6.1a8.2 8.2 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 5 4.3 1.8.8 2.6.8 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  )
}

export function WhatsAppButton({ side = 'bottom' }: { side?: 'bottom' | 'top' }) {
  return (
    <ToolButton label="WhatsApp" side={side} className="size-9" onClick={() => void openWhatsAppWindow()} data-action="whatsapp">
      <WhatsAppIcon className="!size-[22px]" />
    </ToolButton>
  )
}

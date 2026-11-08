import { cn } from '@/lib/utils'

/** Jiro brand mark: a yellow tile with a "j" stroke and dot */
export function JiroMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#FFD02F" />
      <path d="M38 27v13a10 10 0 0 1-10 10h-6" fill="none" stroke="#1a1a2e" strokeWidth="7" strokeLinecap="round" />
      <circle cx="38" cy="15" r="4.5" fill="#1a1a2e" />
    </svg>
  )
}

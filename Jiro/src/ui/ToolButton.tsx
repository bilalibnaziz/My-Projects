import { forwardRef } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  shortcut?: string
  active?: boolean
  side?: 'right' | 'bottom' | 'top' | 'left'
}

/** Square icon button with a tooltip that shows its shortcut */
export const ToolButton = forwardRef<HTMLButtonElement, Props>(function ToolButton({ label, shortcut, active, side = 'right', className, children, ...rest }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          aria-label={label}
          aria-pressed={active}
          data-ui
          className={cn(
            'relative grid size-10 shrink-0 place-items-center rounded-lg text-foreground/80 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 [&_svg]:size-[20px]',
            active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} className="flex items-center gap-2">
        {label}
        {shortcut && <kbd className="rounded bg-background/20 px-1.5 font-sans text-[11px] opacity-80">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
})

export function Divider({ vertical = false }: { vertical?: boolean }) {
  return <div className={vertical ? 'mx-1 h-6 w-px bg-border' : 'my-1 h-px w-6 self-center bg-border'} />
}

import { useMemo } from 'react'
import type { Template } from '@/board/templates'
import { thumbnailSvg } from '@/board/thumbnail'
import { cn } from '@/lib/utils'

/** Live miniature of a template, rendered from its real objects */
export function TemplatePreview({ t, className }: { t: Template; className?: string }) {
  const src = useMemo(() => {
    const objs = t.build()
    return thumbnailSvg({
      id: t.id, name: t.name, createdAt: 0, updatedAt: 0, viewport: { x: 0, y: 0, zoom: 1 },
      objects: Object.fromEntries(objs.map((o) => [o.id, o])), order: objs.map((o) => o.id),
    })
  }, [t])
  return (
    <div className={cn('relative bg-[#f4f3ef] dark:bg-[#23232c]', className)}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: t.accent }} />
      {src && <img src={src} alt="" className="absolute inset-0 size-full object-contain p-3" draggable={false} />}
    </div>
  )
}

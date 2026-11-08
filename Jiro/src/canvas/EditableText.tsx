import { useEffect, useLayoutEffect, useRef } from 'react'
import { useBoard } from '@/board/store'

interface Props {
  value: string
  editing: boolean
  onChange(v: string): void
  onKey?(e: React.KeyboardEvent<HTMLDivElement>, el: HTMLDivElement): boolean | void
  className?: string
  style?: React.CSSProperties
  placeholder?: string
  /** Select all on start (new objects start empty, so the caret goes to the end) */
  selectAll?: boolean
  autoFocus?: boolean
}

/**
 * Plain-text contentEditable. While editing it's uncontrolled (React never rewrites the DOM under
 * the caret); outside editing it just renders the text. Edits are one undo step per session.
 */
export function EditableText({ value, editing, onChange, onKey, className, style, placeholder, selectAll = true, autoFocus = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !editing) return
    el.innerText = value
    if (!autoFocus) return
    el.focus({ preventScroll: true })
    const r = document.createRange()
    r.selectNodeContents(el)
    if (!selectAll || !value) r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // Someone else changed this text while we're typing (live session): show it without losing our
  // caret. Without this, our next keystroke would send our stale copy and erase their change.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !editing) return
    const cur = (el.innerText ?? '').replace(/\n$/, '')
    if (cur === value) return
    const caret = caretOffset(el)
    el.innerText = value
    if (caret === null) return
    let p = 0
    while (p < cur.length && p < value.length && cur[p] === value[p]) p++
    // A change before the caret moves it; one after it doesn't
    setCaret(el, caret > p ? Math.max(p, caret + value.length - cur.length) : caret)
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    useBoard.getState().beginGesture()
    return () => useBoard.getState().endGesture()
  }, [editing])

  if (!editing)
    return (
      <div className={className} style={style} data-placeholder={placeholder}>
        {value}
      </div>
    )
  return (
    <div
      ref={ref}
      className={className + ' jiro-editable'}
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-editor
      onInput={(e) => onChange((e.currentTarget.innerText ?? '').replace(/\n$/, ''))}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (onKey && onKey(e, e.currentTarget)) return
        if (e.key === 'Escape') {
          e.preventDefault()
          useBoard.getState().setEditing(null)
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Clicking inside our own toolbars keeps editing
        const to = e.relatedTarget as HTMLElement | null
        if (to?.closest('[data-keep-editing]')) return
        if (useBoard.getState().editingId) useBoard.getState().setEditing(null)
      }}
    />
  )
}

/** Caret position as an offset into the element's plain text (null when the caret isn't inside). */
function caretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return null
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(sel.anchorNode!, sel.anchorOffset)
  return textLength(r.cloneContents())
}

function textLength(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n as Text).data.length
  if (n.nodeName === 'BR') return 1
  let len = 0
  n.childNodes.forEach((c) => { len += textLength(c) })
  return len
}

function setCaret(el: HTMLElement, offset: number) {
  let left = offset
  const r = document.createRange()
  const walk = (n: Node): boolean => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n as Text).data.length
      if (left <= len) { r.setStart(n, left); return true }
      left -= len
      return false
    }
    if (n.nodeName === 'BR') {
      if (left === 0) { r.setStartBefore(n); return true }
      left -= 1
      return false
    }
    for (const c of Array.from(n.childNodes)) if (walk(c)) return true
    return false
  }
  if (!walk(el)) { r.selectNodeContents(el); r.collapse(false) } else r.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(r)
}

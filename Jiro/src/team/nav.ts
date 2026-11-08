import { rotatedBounds } from '@/board/geometry'
import { useBoard } from '@/board/store'
import { zoomToRect } from '@/canvas/viewport'

type Opener = (boardId: string) => Promise<void>
let opener: Opener | null = null

/** App registers how to open a board by id (the home screen and panels use it) */
export const setBoardOpener = (fn: Opener) => {
  opener = fn
}

/** Open a board (if needed) and fly to an item on it */
export async function openAt(boardId?: string, objectId?: string) {
  if (boardId && useBoard.getState().doc?.id !== boardId && opener) await opener(boardId)
  if (!objectId) return
  const go = () => {
    const s = useBoard.getState()
    const o = s.doc?.objects[objectId]
    if (!o) return
    s.select([objectId])
    zoomToRect(rotatedBounds(o), { pad: 200, maxZoom: 1.25 })
  }
  // after a board switch the stage needs a frame to measure itself
  requestAnimationFrame(() => requestAnimationFrame(go))
}

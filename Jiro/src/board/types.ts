// Jiro board model. Everything on a board is a flat record keyed by id; z-order is `order`.
export type ID = string

export type ShapeKind =
  | 'rect'
  | 'round'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'hexagon'
  | 'parallelogram'
  | 'cylinder'
  | 'arrow'
  | 'callout'
  | 'cross'

export type Align = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'
export type Anchor = 'top' | 'right' | 'bottom' | 'left' | 'auto'
export type LineStyle = 'straight' | 'elbow' | 'curve'
export type Cap = 'none' | 'arrow' | 'triangle' | 'dot' | 'bar'
export type Dash = 'solid' | 'dashed' | 'dotted'

interface Base {
  id: ID
  x: number
  y: number
  w: number
  h: number
  rotation: number
  locked?: boolean
  groupId?: ID
  /** Dot votes cast on this object */
  votes?: number
  link?: string
  /** Fractional index for CRDT z-ordering */
  order?: string
}

export interface TextStyle {
  fontSize: number // 0 = auto-fit
  color: string
  align: Align
  valign: VAlign
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: 'sans' | 'hand' | 'serif' | 'mono'
}

export interface StickyObj extends Base, TextStyle {
  kind: 'sticky'
  fill: string
  text: string
  author?: string
}

export interface ShapeObj extends Base, TextStyle {
  kind: 'shape'
  shape: ShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  dash: Dash
  text: string
}

export interface TextObj extends Base, TextStyle {
  kind: 'text'
  text: string
  /** Fixed-width text wraps; auto-width grows with the content */
  autoWidth: boolean
  highlight?: string
}

export interface FrameObj extends Base {
  kind: 'frame'
  title: string
  fill: string
}

export interface CardObj extends Base {
  kind: 'card'
  title: string
  body: string
  tag: string // accent colour on the card's left edge
  status?: 'todo' | 'doing' | 'done'
  /** Legacy free-text assignee (older boards); new boards use `assignees` */
  assignee?: string
  /** People this task is assigned to. Stored by value so the board stays meaningful when shared. */
  assignees?: Person[]
  due?: string
  priority?: 'low' | 'medium' | 'high'
}

/** A teammate as stored on a board (by value, so shared boards keep names and contacts) */
export interface Person {
  id: ID
  name: string
  email?: string
  phone?: string
  color: string
}

export interface PenObj extends Base {
  kind: 'pen'
  /** Flat [x0,y0,x1,y1,…] relative to the object's x/y */
  points: number[]
  color: string
  width: number
  highlighter?: boolean
}

export interface ImageObj extends Base {
  kind: 'image'
  src: string
  natW: number
  natH: number
}

export interface MindObj extends Base {
  kind: 'mind'
  text: string
  parent?: ID
  color: string
  /** Root only: which side children grow on */
  side?: 'right' | 'both'
  collapsed?: boolean
}

export interface EmojiObj extends Base {
  kind: 'emoji'
  char: string
}

export interface CommentObj extends Base {
  kind: 'comment'
  thread: { id: ID; author: string; authorEmail?: string; text: string; at: number; mentions?: Person[] }[]
  resolved?: boolean
}

export interface End {
  /** Attached object (follows it when it moves) */
  id?: ID
  anchor?: Anchor
  /** Free end in board coordinates (used when not attached) */
  x: number
  y: number
}

export interface ConnectorObj extends Base {
  kind: 'connector'
  from: End
  to: End
  style: LineStyle
  stroke: string
  strokeWidth: number
  dash: Dash
  startCap: Cap
  endCap: Cap
  label: string
}

export type BoardObj =
  | StickyObj
  | ShapeObj
  | TextObj
  | FrameObj
  | CardObj
  | PenObj
  | ImageObj
  | MindObj
  | EmojiObj
  | CommentObj
  | ConnectorObj

export type Kind = BoardObj['kind']

export interface Viewport {
  x: number // screen offset of board origin
  y: number
  zoom: number
}

export interface BoardDoc {
  id: ID
  name: string
  createdAt: number
  updatedAt: number
  starred?: boolean
  objects: Record<ID, BoardObj>
  order: ID[]
  viewport: Viewport
  background?: 'dots' | 'grid' | 'lines' | 'none'
  thumbnail?: string
  /** Board notes (plain text with "- [ ]" checklists) */
  notes?: string
  /** Who did what (assignments, comments, shares); newest last, capped */
  activity?: ActivityEntry[]
  /** Set when the board came from someone else's share link / file */
  sharedBy?: Person
}

export interface ActivityEntry {
  id: ID
  at: number
  who: string
  text: string
  objectId?: ID
}

export interface BoardMeta {
  id: ID
  name: string
  createdAt: number
  updatedAt: number
  starred?: boolean
  thumbnail?: string
  count: number
  sharedBy?: string
}

export type Tool =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'shape'
  | 'text'
  | 'connector'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'frame'
  | 'card'
  | 'mind'
  | 'comment'
  | 'emoji'
  | 'laser'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Pt {
  x: number
  y: number
}

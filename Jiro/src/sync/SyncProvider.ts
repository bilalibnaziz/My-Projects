import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/** Connection state of a live board. */
export type SyncStatus = 'connecting' | 'synced' | 'offline' | 'denied'

/**
 * Keeps a board's Y.Doc in sync with other people. Implementations: WebSocket relay
 * (`websocketProvider.ts`); peer-to-peer can be added behind the same interface.
 * The local y-indexeddb copy stays the source of truth: a provider only adds people.
 */
export interface SyncProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly status: SyncStatus
  /** Local changes made while not connected (sent on reconnect). */
  readonly pending: number
  /** True when the server only lets us read (a view-only invite). */
  readonly readOnly: boolean
  connect(): void
  disconnect(): void
  destroy(): void
  /** Rotate room encryption key (owner only). */
  rotateKey?(newKey: CryptoKey): Promise<void>
  on(event: 'status', cb: (s: SyncStatus) => void): () => void
}

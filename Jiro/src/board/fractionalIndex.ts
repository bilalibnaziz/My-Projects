import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { ID } from './types'

export { generateKeyBetween, generateNKeysBetween }

/**
 * Generate `count` sequential fractional index keys from scratch.
 */
export function generateInitialKeys(count: number): string[] {
  if (count <= 0) return []
  return generateNKeysBetween(null, null, count)
}

/**
 * Generate a key strictly greater than `lastOrderKey` (to append to the end of a list).
 */
export function generateKeyAfter(lastOrderKey?: string | null): string {
  return generateKeyBetween(lastOrderKey ?? null, null)
}

/**
 * Generate a key strictly smaller than `firstOrderKey` (to prepend to the beginning of a list).
 */
export function generateKeyBefore(firstOrderKey?: string | null): string {
  return generateKeyBetween(null, firstOrderKey ?? null)
}

/**
 * Generate a key strictly between `prev` and `next`.
 */
export function generateKeyBetweenKeys(prev?: string | null, next?: string | null): string {
  return generateKeyBetween(prev ?? null, next ?? null)
}

/**
 * Generate `n` keys strictly between `prev` and `next`.
 */
export function generateNKeysBetweenKeys(
  prev: string | null | undefined,
  next: string | null | undefined,
  n: number,
): string[] {
  if (n <= 0) return []
  return generateNKeysBetween(prev ?? null, next ?? null, n)
}

/**
 * Deterministically sort object IDs by their fractional index `order`.
 * Uses `id.localeCompare` as a fallback tie-breaker if two objects have equal or missing order.
 */
export function sortIdsByFractionalOrder(objects: Record<ID, { order?: string }>): ID[] {
  return Object.keys(objects).sort((a, b) => {
    const oa = objects[a]?.order
    const ob = objects[b]?.order
    if (oa !== undefined && ob !== undefined) {
      if (oa < ob) return -1
      if (oa > ob) return 1
    } else if (oa !== undefined) {
      return -1
    } else if (ob !== undefined) {
      return 1
    }
    return a.localeCompare(b)
  })
}

/**
 * Assign sequential fractional index keys to an array of object IDs in the given order.
 */
export function assignFractionalOrders(ids: ID[]): Record<ID, string> {
  const result: Record<ID, string> = {}
  if (!ids.length) return result
  const keys = generateNKeysBetween(null, null, ids.length)
  for (let i = 0; i < ids.length; i++) {
    result[ids[i]] = keys[i]
  }
  return result
}

/**
 * New order keys for `target` (the wanted bottom→top order) that change as few objects as possible.
 * Objects whose current keys already increase along `target` (a longest increasing run, found in
 * O(n log n)) keep their keys; only the others get fresh keys between their kept neighbours. Two peers
 * reordering different objects at the same time therefore don't overwrite each other's keys.
 * Pass `moved` (the objects the user moved) so the untouched ones keep their keys when there is a choice.
 * Returns only the ids whose key must change.
 */
export function minimalReorderKeys(
  current: Record<ID, string | undefined>,
  target: ID[],
  moved?: ReadonlySet<ID>,
): Record<ID, string> {
  const n = target.length
  // Longest strictly increasing subsequence of current keys along target (patience sorting)
  const tails: number[] = [] // index into target of the smallest tail for each length
  const prev = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const k = current[target[i]]
    // Objects the user moved always get new keys, so untouched objects are the ones that keep theirs
    if (k === undefined || moved?.has(target[i])) continue
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((current[target[tails[mid]]] as string) < k) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  const keep = new Uint8Array(n)
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = 1

  const out: Record<ID, string> = {}
  let i = 0
  let lastKept: string | null = null
  while (i < n) {
    if (keep[i]) {
      lastKept = current[target[i]] as string
      i++
      continue
    }
    let j = i
    while (j < n && !keep[j]) j++
    const nextKept = j < n ? (current[target[j]] as string) : null
    const keys = generateNKeysBetween(lastKept, nextKept, j - i)
    for (let t = i; t < j; t++) out[target[t]] = keys[t - i]
    i = j
  }
  return out
}

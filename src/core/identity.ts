import type { EntryContent } from './types'

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')

/** Identity of an entry for import/merge: full headword (with any qualifier), POS, collection. */
export function entryKey(c: Pick<EntryContent, 'collection' | 'word' | 'pos'>): string {
  return [norm(c.collection), norm(c.word), norm(c.pos)].join('|')
}

// cyrb53: small, fast, deterministic 53-bit string hash (no crypto dependency).
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Stable entry id derived from the key at creation time. Two devices importing the
 * same file therefore agree on ids, which keeps merged event logs consistent.
 * The id never changes afterwards, even if the user edits the headword.
 */
export function entryIdFor(key: string): string {
  return 'e' + cyrb53(key).toString(36)
}

/** Identity of a synonym cluster: its title, normalised. */
export const clusterKey = (title: string) => norm(title)

/** Stable cluster id from the key, like entryIdFor ('k' prefix keeps the two id spaces apart). */
export function clusterIdFor(key: string): string {
  return 'k' + cyrb53(key).toString(36)
}

export function normalizeCollection(c: string): string {
  return c
    .split('>')
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' > ')
}

/** Normalise any date-ish string to ISO UTC with milliseconds; null if unparseable. */
export function normalizeTs(s: string): string | null {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

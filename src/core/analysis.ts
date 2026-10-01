import type { EntryState } from './events'

export interface DuplicateGroup {
  word: string
  polish: string
  entries: { id: string; collection: string; word: string }[]
}

const fold = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
const baseWord = (s: string) => fold(s.replace(/\s*\(.*?\)/g, ''))

/**
 * Entries that share a headword (ignoring a "(qualifier)") AND the same Polish translation.
 * A qualifier with a different translation ("current (ocean)" vs "current (electric)") is a
 * different meaning and is never reported. Shown in the Library so the user can delete one.
 */
export function findSameMeaningDuplicates(entries: Iterable<EntryState>): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>()
  for (const e of entries) {
    if (e.deleted) continue
    const k = baseWord(e.content.word) + '|' + fold(e.content.polish)
    const g = groups.get(k) ?? { word: baseWord(e.content.word), polish: e.content.polish, entries: [] }
    g.entries.push({ id: e.id, collection: e.content.collection, word: e.content.word })
    groups.set(k, g)
  }
  return [...groups.values()].filter((g) => g.entries.length > 1).sort((a, b) => a.word.localeCompare(b.word))
}

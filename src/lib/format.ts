import type { VocabState } from '../core/events'

/** "School Subjects > Chemistry" -> "School Subjects › Chemistry" */
export const crumb = (collection: string) => collection.replace(/ > /g, ' › ')
export const lastPart = (collection: string) => collection.split(' > ').pop() ?? collection

export interface CollectionInfo {
  name: string
  total: number
  unseen: number
}

/** Every collection and every parent of one ("School Subjects"), with word counts. */
export function collectionList(state: VocabState): CollectionInfo[] {
  const map = new Map<string, CollectionInfo>()
  for (const e of state.entries.values()) {
    if (e.deleted) continue
    const parts = e.content.collection.split(' > ')
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join(' > ')
      const info = map.get(name) ?? { name, total: 0, unseen: 0 }
      info.total++
      if (!e.firstSeen && e.reviews.length === 0) info.unseen++
      map.set(name, info)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

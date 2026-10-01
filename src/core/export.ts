import type { VocabState } from './events'
import { serializeMarkdown, type ExportRow } from './markdown'

/** Full dictionary as Markdown: collections in name order, entries in creation order. */
export function exportMarkdown(state: VocabState, opts: { now: string; fsrs?: (id: string) => string | undefined }): string {
  const live = [...state.entries.values()].filter((e) => !e.deleted)
  live.sort((a, b) => a.content.collection.localeCompare(b.content.collection) || a.seq - b.seq)
  const rows: ExportRow[] = live.map((e) => ({
    content: e.content,
    status: e.status,
    dateAdded: e.dateAdded,
    firstSeen: e.firstSeen,
    fsrs: opts.fsrs?.(e.id),
    reviews: e.reviews.map((r) => ({ ts: r.ts, rating: r.rating })),
  }))
  return serializeMarkdown(rows, { exportedAt: opts.now })
}

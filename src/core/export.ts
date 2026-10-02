import { serializeClusters, type ClusterExportRow } from './clusters'
import type { VocabState } from './events'
import { serializeMarkdown, type ExportRow } from './markdown'

/**
 * The full backup as Markdown: dictionary collections in name order (entries in creation order),
 * then the Thesaurus clusters. Importing it back restores everything, history included.
 */
export function exportMarkdown(state: VocabState, opts: { now: string; fsrs?: (id: string) => string | undefined }): string {
  const live = [...state.entries.values()].filter((e) => !e.deleted)
  live.sort((a, b) => a.content.collection.localeCompare(b.content.collection) || a.seq - b.seq)
  const rows: ExportRow[] = live.map((e) => ({
    content: e.content,
    status: e.status,
    dateAdded: e.dateAdded,
    firstSeen: e.firstSeen,
    knownAt: e.knownAt,
    fsrs: opts.fsrs?.(e.id),
    reviews: e.reviews.map((r) => ({ ts: r.ts, rating: r.rating })),
  }))
  const words = serializeMarkdown(rows, { exportedAt: opts.now })

  const clusters = [...state.clusters.values()].filter((c) => !c.deleted)
  if (!clusters.length) return words
  clusters.sort((a, b) => a.content.collection.localeCompare(b.content.collection) || a.seq - b.seq)
  const clusterRows: ClusterExportRow[] = clusters.map((c) => ({
    content: c.content,
    firstSeen: c.firstSeen,
    reviews: c.reviews.map((r) => ({ ts: r.ts, rating: r.rating })),
  }))
  return words + '\n' + serializeClusters(clusterRows)
}

import { clusterIdFor, clusterKey } from './identity'
import { createEventFactory, type ClusterState, type VocabEvent, type VocabState } from './events'
import type { ClusterContent, ParsedCluster, ParsedClusters } from './clusters'
import type { ParseWarning } from './types'

export interface ClusterImportReport {
  added: number
  unchanged: number
  /** Already present with different content, left alone (updateExisting is off). */
  differing: string[]
  updated: number
  skippedDeleted: number
  skippedInvalid: number
  skippedRepeated: number
  reviewsRestored: number
  warnings: ParseWarning[]
}

export interface ClusterImportContext {
  /** Timestamp for the first added cluster; each following one gets +1 ms to keep file order. */
  now: string
  device: string
  updateExisting?: boolean
}

function toContent(p: ParsedCluster): ClusterContent {
  return { title: p.title, coreMeaning: p.coreMeaning, members: p.members, ordered: p.ordered, collection: p.collection }
}

const sameContent = (a: ClusterContent, b: ClusterContent) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const canon = (c: ClusterContent) => ({ ...c, collection: undefined })

/**
 * Turns parsed clusters into events, the same way word imports work: new clusters are added,
 * existing ones keep their review history and your edits unless asked, deleted ones stay
 * deleted, and practice history in a backup is restored without duplication.
 */
export function planClusterImport(
  state: VocabState,
  doc: ParsedClusters,
  ctx: ClusterImportContext,
): { events: VocabEvent[]; report: ClusterImportReport } {
  const factory = createEventFactory(ctx.device, () => ctx.now)
  const events: VocabEvent[] = []
  const report: ClusterImportReport = {
    added: 0, unchanged: 0, differing: [], updated: 0, skippedDeleted: 0, skippedInvalid: 0,
    skippedRepeated: 0, reviewsRestored: 0, warnings: [...doc.warnings],
  }
  const byKey = new Map<string, ClusterState>()
  for (const c of state.clusters.values()) byKey.set(clusterKey(c.content.title), c)
  const seen = new Set<string>()
  let added = 0

  for (const p of doc.clusters) {
    if (p.problems.length) {
      report.skippedInvalid++
      continue
    }
    const key = clusterKey(p.title)
    if (seen.has(key)) {
      report.skippedRepeated++
      report.warnings.push({ line: p.line, level: 'warn', message: `Cluster "${p.title}" appears twice in this import; first kept` })
      continue
    }
    seen.add(key)

    const content = toContent(p)
    const existing = byKey.get(key)
    let clusterId: string
    if (!existing) {
      clusterId = clusterIdFor(key)
      events.push(
        factory.make(
          { type: 'cluster.add', clusterId, content },
          { id: `cadd:${clusterId}`, ts: new Date(Date.parse(ctx.now) + added++).toISOString() },
        ),
      )
      report.added++
    } else if (existing.deleted) {
      report.skippedDeleted++
      continue
    } else {
      clusterId = existing.id
      if (sameContent(existing.content, content)) report.unchanged++
      else if (ctx.updateExisting) {
        events.push(factory.make({ type: 'cluster.update', clusterId, fields: { coreMeaning: content.coreMeaning, members: content.members, ordered: content.ordered } }))
        report.updated++
      } else report.differing.push(p.title)
    }

    for (const r of p.reviews) {
      const id = `crv:${clusterId}:${r.ts}:${r.rating}`
      if (state.seenEvents.has(id)) continue
      if (existing?.reviews.some((x) => x.ts === r.ts && x.rating === r.rating)) continue
      events.push(factory.make({ type: 'cluster.review', clusterId, rating: r.rating, mode: 'restored', restoredAt: ctx.now }, { id, ts: r.ts }))
      report.reviewsRestored++
    }
  }
  return { events, report }
}

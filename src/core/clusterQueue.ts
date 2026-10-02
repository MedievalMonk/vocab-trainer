import { State, type Card, type FSRS } from 'ts-fsrs'
import type { VocabState } from './events'
import { retrievability } from './scheduler'
import type { Settings } from './settings'

const DAY_MS = 86_400_000

export interface ClusterQueueContext {
  now: Date
  tzOffsetMin: number
  settings: Settings
  f: FSRS
  cards: Map<string, Card>
}

export interface ClusterDashboard {
  /** Practised before and falling due today (or overdue). */
  dueToday: number
  /** Never practised. Clusters are never gated, so these are always available. */
  newCount: number
  practised: number
  total: number
  doneToday: number
  remainingToday: number
  cap: number
  /** Clusters to practise now: most at risk first, never beyond what is left of today's cap. */
  queue: string[]
}

/** The Thesaurus's own mini-dashboard: separate from the word-level due count. */
export function clusterDashboard(state: VocabState, ctx: ClusterQueueContext): ClusterDashboard {
  const dayStart = Math.floor((ctx.now.getTime() + ctx.tzOffsetMin * 60_000) / DAY_MS) * DAY_MS - ctx.tzOffsetMin * 60_000
  const dayEnd = dayStart + DAY_MS
  const due: { id: string; r: number; due: number }[] = []
  let newCount = 0
  let practised = 0
  let total = 0
  let doneToday = 0
  for (const c of state.clusters.values()) {
    if (c.deleted) continue
    total++
    for (const r of c.reviews) {
      const t = Date.parse(r.ts)
      if (t >= dayStart && t < dayEnd) doneToday++
    }
    const card = ctx.cards.get(c.id)
    if (!card || card.state === State.New) {
      newCount++
      continue
    }
    practised++
    if (card.due.getTime() < dayEnd) due.push({ id: c.id, r: retrievability(card, ctx.f, ctx.now), due: card.due.getTime() })
  }
  due.sort((a, b) => a.r - b.r || a.due - b.due || (a.id < b.id ? -1 : 1))
  const remainingToday = Math.max(0, ctx.settings.clusterDailyCap - doneToday)
  return {
    dueToday: due.length,
    newCount,
    practised,
    total,
    doneToday,
    remainingToday,
    cap: ctx.settings.clusterDailyCap,
    queue: due.slice(0, remainingToday).map((d) => d.id),
  }
}

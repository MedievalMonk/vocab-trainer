import type { Card, FSRS } from 'ts-fsrs'
import type { EntryState, VocabState } from './events'
import { addDays, dayKey } from './history'
import { retrievability } from './scheduler'
import type { Settings } from './settings'

export interface QueueContext {
  now: Date
  /** Minutes east of UTC for "today" boundaries (Warsaw summer: 120). */
  tzOffsetMin: number
  settings: Settings
  f: FSRS
  cards: Map<string, Card>
}

const DAY_MS = 86_400_000

export function dayStartMs(ms: number, tzOffsetMin: number): number {
  return Math.floor((ms + tzOffsetMin * 60_000) / DAY_MS) * DAY_MS - tzOffsetMin * 60_000
}

export interface DueItem {
  id: string
  due: Date
  retrievability: number
}

/** Cards due at or before `cutoff`, most at risk of being forgotten first. */
export function dueItems(ctx: QueueContext, cutoff: Date): DueItem[] {
  const out: DueItem[] = []
  for (const [id, card] of ctx.cards) {
    if (card.due.getTime() <= cutoff.getTime()) {
      out.push({ id, due: card.due, retrievability: retrievability(card, ctx.f, ctx.now) })
    }
  }
  return out.sort((a, b) => a.retrievability - b.retrievability || a.due.getTime() - b.due.getTime() || (a.id < b.id ? -1 : 1))
}

/** Graded reviews done today. Reviews restored from a backup don't count against today. */
export function reviewsDoneToday(state: VocabState, ctx: QueueContext): number {
  const start = dayStartMs(ctx.now.getTime(), ctx.tzOffsetMin)
  const end = start + DAY_MS
  let n = 0
  for (const e of state.entries.values()) {
    if (e.deleted) continue
    for (const r of e.reviews) {
      const t = Date.parse(r.ts)
      if (t >= start && t < end && r.mode !== 'restored') n++
    }
  }
  return n
}

export interface BacklogInfo {
  dueNow: number
  doneToday: number
  remainingToday: number
  /** More is due than today's remaining cap can clear: new-word intake pauses. */
  active: boolean
}

export function backlogInfo(state: VocabState, ctx: QueueContext): BacklogInfo {
  const dueNow = dueItems(ctx, ctx.now).length
  const doneToday = reviewsDoneToday(state, ctx)
  const remainingToday = Math.max(0, ctx.settings.dailyCap - doneToday)
  return { dueNow, doneToday, remainingToday, active: dueNow > remainingToday }
}

/** Next Repetitions batch: most urgent first, never beyond the daily cap or the batch size. */
export function repetitionBatch(state: VocabState, ctx: QueueContext, batchSize = ctx.settings.batchSize): string[] {
  const { remainingToday } = backlogInfo(state, ctx)
  const size = Math.min(batchSize, remainingToday)
  return dueItems(ctx, ctx.now).slice(0, size).map((d) => d.id)
}

export interface Dashboard extends BacklogInfo {
  dueToday: number
  dailyCap: number
  /** Reviews due on each of the next 7 days; day 0 is today and includes anything overdue. */
  forecast: number[]
  perCollection: { collection: string; dueToday: number }[]
}

export function dashboard(state: VocabState, ctx: QueueContext): Dashboard {
  const todayStart = dayStartMs(ctx.now.getTime(), ctx.tzOffsetMin)
  const forecast = new Array<number>(7).fill(0)
  const byCollection = new Map<string, number>()
  for (const [id, card] of ctx.cards) {
    const day = Math.floor((dayStartMs(card.due.getTime(), ctx.tzOffsetMin) - todayStart) / DAY_MS)
    const idx = Math.max(0, day)
    if (idx < 7) forecast[idx]++
    if (idx === 0) {
      const c = state.entries.get(id)!.content.collection
      byCollection.set(c, (byCollection.get(c) ?? 0) + 1)
    }
  }
  const perCollection = [...byCollection]
    .map(([collection, dueToday]) => ({ collection, dueToday }))
    .sort((a, b) => b.dueToday - a.dueToday || a.collection.localeCompare(b.collection))
  return { ...backlogInfo(state, ctx), dueToday: forecast[0], dailyCap: ctx.settings.dailyCap, forecast, perCollection }
}

/**
 * Reviews due on each real calendar day, from today on. Today includes everything overdue,
 * as it does in the dashboard's due-today count.
 */
export function dueByDay(ctx: QueueContext, days: number): Record<string, number> {
  const today = dayKey(ctx.now.getTime(), ctx.tzOffsetMin)
  const out: Record<string, number> = {}
  for (const card of ctx.cards.values()) {
    let key = dayKey(card.due.getTime(), ctx.tzOffsetMin)
    if (key < today) key = today
    if (key <= addDays(today, days - 1)) out[key] = (out[key] ?? 0) + 1
  }
  return out
}

export type NewWordsMode = { kind: 'random' } | { kind: 'collection'; collection: string } | { kind: 'recent' }

const inCollection = (entryCollection: string, wanted: string) => entryCollection === wanted || entryCollection.startsWith(wanted + ' > ')

/** Never seen: no teach-first pass and no reviews. */
export const isUnseen = (e: EntryState) => !e.deleted && !e.firstSeen && e.reviews.length === 0

/**
 * Next teach-first batch. Empty (paused) while a backlog is active. Smaller than the batch
 * size only when fewer words are eligible; never padded with other content.
 */
export function newWordsBatch(
  state: VocabState,
  ctx: QueueContext,
  mode: NewWordsMode,
  rng: () => number = Math.random,
  batchSize = ctx.settings.batchSize,
): { ids: string[]; paused: boolean } {
  if (backlogInfo(state, ctx).active) return { ids: [], paused: true }
  let pool = [...state.entries.values()].filter(isUnseen)
  if (mode.kind === 'collection') pool = pool.filter((e) => inCollection(e.content.collection, mode.collection))
  if (mode.kind === 'recent') {
    pool.sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : a.dateAdded > b.dateAdded ? -1 : b.seq - a.seq))
  } else if (mode.kind === 'random') {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
  } else {
    pool.sort((a, b) => a.seq - b.seq)
  }
  return { ids: pool.slice(0, batchSize).map((e) => e.id), paused: false }
}

/**
 * Words that have had their teach-first pass but no quiz yet: the "New Words revisit" pool.
 * Quizzing them is allowed regardless of the backlog (it adds no new material).
 */
export function revisitBatch(state: VocabState, ctx: QueueContext, batchSize = ctx.settings.batchSize): string[] {
  return [...state.entries.values()]
    .filter((e) => !e.deleted && e.firstSeen && e.reviews.length === 0)
    .sort((a, b) => (a.firstSeen! < b.firstSeen! ? -1 : 1))
    .slice(0, batchSize)
    .map((e) => e.id)
}

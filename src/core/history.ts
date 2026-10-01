import type { VocabState } from './events'

export interface DayStat {
  /** Graded answers that day. */
  reviews: number
  /** Of those, answers that were not "Again". */
  correct: number
  /** Words whose teach-first pass happened that day. */
  taught: number
  /** Words filed as known that day (and still known). */
  known: number
}

export interface HistoryTotals extends DayStat {
  activeDays: number
}

export interface History {
  /** Keyed by local calendar date, "YYYY-MM-DD". Days with no activity are absent. */
  days: Record<string, DayStat>
  totals: HistoryTotals
  /** Local date the history counts from: the last reset, else the first recorded activity. */
  since: string | null
  /** True when `since` is a reset rather than just the first activity. */
  sinceReset: boolean
}

/** Local calendar date for a moment, given the zone's offset in minutes east of UTC. */
export function dayKey(ms: number, tzOffsetMin: number): string {
  return new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10)
}

/** Adds whole days to a "YYYY-MM-DD" key. Calendar arithmetic only, so DST never matters. */
export function addDays(key: string, n: number): string {
  const d = new Date(key + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * What was actually studied, per real calendar day, derived from the (already reset-aware)
 * entry state: reviews, teach-first passes and words filed as known.
 */
export function buildHistory(state: VocabState, tzOffsetMin: number): History {
  const days: Record<string, DayStat> = {}
  const day = (ts: string) => (days[dayKey(Date.parse(ts), tzOffsetMin)] ??= { reviews: 0, correct: 0, taught: 0, known: 0 })

  for (const e of state.entries.values()) {
    for (const r of e.reviews) {
      const d = day(r.ts)
      d.reviews++
      if (r.rating > 1) d.correct++
    }
    if (e.firstSeen) day(e.firstSeen).taught++
    if (e.knownAt && e.status === 'known') day(e.knownAt).known++
  }

  const totals: HistoryTotals = { reviews: 0, correct: 0, taught: 0, known: 0, activeDays: 0 }
  for (const d of Object.values(days)) {
    totals.reviews += d.reviews
    totals.correct += d.correct
    totals.taught += d.taught
    totals.known += d.known
    if (d.reviews || d.taught || d.known) totals.activeDays++
  }
  const keys = Object.keys(days).sort()
  const sinceReset = !!state.resetAt
  const since = sinceReset ? dayKey(Date.parse(state.resetAt), tzOffsetMin) : (keys[0] ?? null)
  return { days, totals, since, sinceReset }
}

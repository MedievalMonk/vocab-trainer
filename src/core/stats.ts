import { State, type Card, type FSRS, type Grade, createEmptyCard } from 'ts-fsrs'
import type { EntryState, VocabState } from './events'
import { addDays, buildHistory } from './history'
import type { Settings } from './settings'

export interface LibraryCounts {
  total: number
  /** Taught or reviewed at least once. */
  studied: number
  /** Not yet taught. */
  notStarted: number
  learning: number
  known: number
}

export interface DayPoint {
  day: string
  reviews: number
  taught: number
}

export interface CollectionProgress {
  collection: string
  total: number
  studied: number
  known: number
}

export interface ExerciseStat {
  kind: string
  total: number
  correct: number
}

export interface HardWord {
  id: string
  word: string
  collection: string
  lapses: number
  reviews: number
}

export interface Stats {
  library: LibraryCounts
  reviews: {
    total: number
    correct: number
    activeDays: number
    perActiveDay: number | null
    /** Answers given on words already past the learning stage, and how many were right. */
    matureTotal: number
    matureCorrect: number
  }
  /** Last 30 calendar days, oldest first, ending today. */
  last30: DayPoint[]
  collections: CollectionProgress[]
  exercises: ExerciseStat[]
  hardest: HardWord[]
  pace: { newPerActiveDay: number | null; notStarted: number; estimatedActiveDays: number | null }
  since: string | null
  sinceReset: boolean
}

const isStudied = (e: EntryState) => !!e.firstSeen || e.reviews.length > 0

export function libraryCounts(state: VocabState): LibraryCounts {
  const c: LibraryCounts = { total: 0, studied: 0, notStarted: 0, learning: 0, known: 0 }
  for (const e of state.entries.values()) {
    if (e.deleted) continue
    c.total++
    if (isStudied(e)) c.studied++
    else c.notStarted++
    if (e.status === 'known') c.known++
    else if (e.status === 'learning') c.learning++
  }
  return c
}

/** Replays one entry's reviews to see how many were answers on already-learned cards. */
function matureAnswers(e: EntryState, f: FSRS): { total: number; correct: number } {
  let card: Card = createEmptyCard(new Date(e.reviews[0]?.ts ?? Date.now()))
  let total = 0
  let correct = 0
  for (const r of e.reviews) {
    if (card.state === State.Review) {
      total++
      if (r.rating > 1) correct++
    }
    card = f.next(card, new Date(r.ts), r.rating as Grade).card
  }
  return { total, correct }
}

export function computeStats(
  state: VocabState,
  cards: Map<string, Card>,
  f: FSRS,
  _settings: Settings,
  tzOffsetMin: number,
  today: string,
): Stats {
  const history = buildHistory(state, tzOffsetMin)
  const library = libraryCounts(state)

  let matureTotal = 0
  let matureCorrect = 0
  const byCollection = new Map<string, CollectionProgress>()
  const byExercise = new Map<string, ExerciseStat>()
  const hardest: HardWord[] = []

  for (const e of state.entries.values()) {
    if (e.deleted) continue
    const m = matureAnswers(e, f)
    matureTotal += m.total
    matureCorrect += m.correct

    const col = byCollection.get(e.content.collection) ?? { collection: e.content.collection, total: 0, studied: 0, known: 0 }
    col.total++
    if (isStudied(e)) col.studied++
    if (e.status === 'known') col.known++
    byCollection.set(e.content.collection, col)

    for (const r of e.reviews) {
      if (!r.exercise) continue
      const x = byExercise.get(r.exercise) ?? { kind: r.exercise, total: 0, correct: 0 }
      x.total++
      if (r.rating > 1) x.correct++
      byExercise.set(r.exercise, x)
    }

    const card = cards.get(e.id)
    if (card && card.lapses >= 2) {
      hardest.push({ id: e.id, word: e.content.word, collection: e.content.collection, lapses: card.lapses, reviews: e.reviews.length })
    }
  }
  hardest.sort((a, b) => b.lapses - a.lapses || b.reviews - a.reviews || a.word.localeCompare(b.word))

  const last30: DayPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const day = addDays(today, -i)
    const d = history.days[day]
    last30.push({ day, reviews: d?.reviews ?? 0, taught: d?.taught ?? 0 })
  }

  const t = history.totals
  const newPerActiveDay = t.activeDays > 0 && t.taught > 0 ? t.taught / t.activeDays : null
  return {
    library,
    reviews: {
      total: t.reviews,
      correct: t.correct,
      activeDays: t.activeDays,
      perActiveDay: t.activeDays > 0 ? t.reviews / t.activeDays : null,
      matureTotal,
      matureCorrect,
    },
    last30,
    collections: [...byCollection.values()].sort((a, b) => a.collection.localeCompare(b.collection)),
    exercises: [...byExercise.values()].sort((a, b) => b.total - a.total),
    hardest: hardest.slice(0, 10),
    pace: {
      newPerActiveDay,
      notStarted: library.notStarted,
      estimatedActiveDays: newPerActiveDay ? Math.ceil(library.notStarted / newPerActiveDay) : null,
    },
    since: history.since,
    sinceReset: history.sinceReset,
  }
}

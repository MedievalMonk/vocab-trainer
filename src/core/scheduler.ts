import { createEmptyCard, fsrs, generatorParameters, State, type Card, type FSRS, type Grade } from 'ts-fsrs'
import type { ClusterState, EntryState } from './events'
import type { Settings } from './settings'

/**
 * FSRS with the library's published default weights, and fuzzing off. Fuzzing is random,
 * and card state is recomputed by replaying the review log on every device, so the
 * result must be identical everywhere.
 */
export function createFsrs(requestRetention: number, shortTermSteps = true): FSRS {
  return fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: false, enable_short_term: shortTermSteps }))
}

/**
 * Card for a synonym cluster, replayed from its practice rounds. Use an FSRS built with
 * shortTermSteps=false: a round is a substantial session, so clusters are scheduled in days,
 * never "again in 10 minutes". Separate from every word's card by construction.
 */
export function cardForCluster(cluster: ClusterState, f: FSRS): Card | null {
  if (!cluster.reviews.length) return null
  let card: Card = createEmptyCard(new Date(cluster.reviews[0].ts))
  for (const r of cluster.reviews) card = f.next(card, new Date(r.ts), r.rating as Grade).card
  return card
}

/**
 * Card state for an entry, replayed from its review history.
 * null = never introduced (no teach-first pass yet): not part of any queue.
 * An entry that was taught but never quizzed gets a new card due shortly after first exposure.
 */
export function cardFor(entry: EntryState, f: FSRS, settings: Settings): Card | null {
  const first = entry.reviews[0]?.ts ?? entry.firstSeen
  if (!first) return null
  let card = createEmptyCard(new Date(first))
  if (entry.reviews.length === 0) {
    card.due = new Date(Date.parse(entry.firstSeen!) + settings.firstReviewDelayMin * 60_000)
    return card
  }
  for (const r of entry.reviews) card = f.next(card, new Date(r.ts), r.rating as Grade).card
  return card
}

export function buildCards(entries: Iterable<EntryState>, f: FSRS, settings: Settings): Map<string, Card> {
  const out = new Map<string, Card>()
  for (const e of entries) {
    if (e.deleted) continue
    const c = cardFor(e, f, settings)
    if (c) out.set(e.id, c)
  }
  return out
}

/** Probability of recall right now; 0 for a card that has never been reviewed. */
export function retrievability(card: Card, f: FSRS, now: Date): number {
  if (card.state === State.New || !card.last_review) return 0
  return f.get_retrievability(card, now, false)
}

/** One-line summary written to the Markdown export (informational only). */
export function fsrsSummary(card: Card | undefined): string | undefined {
  if (!card || card.reps === 0) return undefined
  return `due=${card.due.toISOString()}; stability=${card.stability.toFixed(2)}; difficulty=${card.difficulty.toFixed(2)}; reps=${card.reps}; lapses=${card.lapses}`
}

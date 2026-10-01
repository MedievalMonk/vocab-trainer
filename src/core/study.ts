import { State, type Card, type FSRS, type Grade } from 'ts-fsrs'
import { createEventFactory, type EntryState, type VocabEvent } from './events'
import type { Rating, Status } from './types'
import type { Settings } from './settings'

type Factory = ReturnType<typeof createEventFactory>

/**
 * Completes the teach-first flashcard pass for these entries. No scoring: it only records
 * that the word has been seen, which makes it eligible for quiz-style exercises. A word
 * still marked `new` becomes `learning`.
 */
export function exposureEvents(entries: EntryState[], factory: Factory, now: Date): VocabEvent[] {
  const ts = now.toISOString()
  const out: VocabEvent[] = []
  for (const e of entries) {
    if (e.deleted || e.firstSeen) continue
    out.push(factory.make({ type: 'exposure', entryId: e.id }, { ts }))
    if (e.status === 'new') out.push(factory.make({ type: 'status.set', entryId: e.id, status: 'learning' }, { ts }))
  }
  return out
}

/**
 * A graded answer. Writes the review and, when the word crosses a threshold, a status change:
 * stable enough (see Settings.knownStabilityDays) -> `known`; forgotten (Again) while `known`
 * -> back to `learning`. A user's manual status choice is only touched by these two rules.
 */
export function reviewEvents(
  entry: EntryState,
  card: Card | undefined,
  f: FSRS,
  factory: Factory,
  rating: Rating,
  mode: string,
  now: Date,
  settings: Settings,
): VocabEvent[] {
  if (!card) throw new Error(`"${entry.content.word}" has not had its teach-first pass yet`)
  const ts = now.toISOString()
  const out: VocabEvent[] = [factory.make({ type: 'review', entryId: entry.id, rating, mode }, { ts })]
  const next = f.next(card, now, rating as Grade).card
  let status: Status = entry.status
  if (rating === 1 && entry.status === 'known') status = 'learning'
  else if (next.state === State.Review && next.stability >= settings.knownStabilityDays) status = 'known'
  else if (entry.status === 'new') status = 'learning'
  if (status !== entry.status) out.push(factory.make({ type: 'status.set', entryId: entry.id, status }, { ts }))
  return out
}

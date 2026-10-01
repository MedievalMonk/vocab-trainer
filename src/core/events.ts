import { FORMAT_VERSION, type EntryContent, type Rating, type Status } from './types'

/**
 * The event log is the source of truth. Entries, statuses and review history are all
 * derived by replaying it, so any device can rebuild itself from the merged logs.
 * Each device appends only to its own log file; other devices' files are read-only.
 */
interface EventBase {
  v: number
  /** Globally unique. Deterministic for imports, so repeated imports/restores dedupe. */
  id: string
  /** ISO UTC with milliseconds. Orders replay (last write wins). */
  ts: string
  device: string
}

export type VocabEvent = EventBase &
  (
    | { type: 'entry.add'; entryId: string; content: EntryContent; status: Status; dateAdded: string; knownAt?: string }
    | { type: 'entry.update'; entryId: string; fields: Partial<EntryContent> }
    | { type: 'entry.delete'; entryId: string }
    | { type: 'status.set'; entryId: string; status: Status }
    /**
     * The teach-first flashcard pass was completed for this entry.
     * `restoredAt`: this event comes from a backup imported at that time (its `ts` is the original moment).
     */
    | { type: 'exposure'; entryId: string; restoredAt?: string }
    | { type: 'review'; entryId: string; rating: Rating; mode?: string; exercise?: string; restoredAt?: string }
    /**
     * Learning progress starts over: every word is `new` again and the history restarts.
     * Words and their content are kept. Progress older than the latest reset is ignored on
     * replay. A restored event counts as happening when it was imported, so a backup restored
     * after a reset comes back, and one restored before it is wiped with everything else.
     */
    | { type: 'progress.reset' }
  )

export interface ReviewRecord {
  ts: string
  rating: Rating
  mode?: string
  /** Which exercise type was answered: flashcard, choice, recall or blank. */
  exercise?: string
}

export interface EntryState {
  id: string
  content: EntryContent
  status: Status
  dateAdded: string
  firstSeen?: string
  /** When the word was filed as known (only while it is known). */
  knownAt?: string
  deleted: boolean
  reviews: ReviewRecord[]
  /** Creation order; used to keep exports and listings in source order. */
  seq: number
}

export interface VocabState {
  entries: Map<string, EntryState>
  seenEvents: Set<string>
  /** Events for entries whose `entry.add` has not been seen (yet). */
  orphans: Map<string, VocabEvent[]>
  nextSeq: number
  /** Timestamp of the latest `progress.reset`, or '' if there never was one. */
  resetAt: string
}

export function emptyState(): VocabState {
  return { entries: new Map(), seenEvents: new Set(), orphans: new Map(), nextSeq: 0, resetAt: '' }
}

function compareEvents(a: VocabEvent, b: VocabEvent): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1
  if (a.device !== b.device) return a.device < b.device ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Rebuilds state from a complete set of events, in any order. Always replay the whole
 * merged log: applying a late event from another device incrementally would break
 * last-write-wins ordering.
 */
export function replay(events: Iterable<VocabEvent>): VocabState {
  const state = emptyState()
  const sorted = [...events].sort(compareEvents)
  // The latest reset is known up front, so progress logged before it can be recognised as
  // stale wherever it appears in the order.
  for (const e of sorted) if (e.type === 'progress.reset' && e.ts > state.resetAt) state.resetAt = e.ts
  for (const e of sorted) applyEvent(state, e)
  return state
}

/** Progress from before the latest reset no longer counts. */
function isStale(state: VocabState, e: VocabEvent): boolean {
  const happened = ('restoredAt' in e && e.restoredAt) || e.ts
  return happened < state.resetAt
}

function setStatus(entry: EntryState, status: Status, ts: string, knownAt?: string): void {
  if (status === 'known') {
    if (entry.status !== 'known' || !entry.knownAt) entry.knownAt = knownAt ?? ts
  } else entry.knownAt = undefined
  entry.status = status
}

/** Applies one event in place. Callers must feed events in sorted order. */
export function applyEvent(state: VocabState, e: VocabEvent): void {
  if (state.seenEvents.has(e.id)) return
  state.seenEvents.add(e.id)
  applyInner(state, e)
}

function applyInner(state: VocabState, e: VocabEvent): void {
  switch (e.type) {
    case 'entry.add': {
      const existing = state.entries.get(e.entryId)
      if (existing && !existing.deleted) return
      // A word added before the latest reset starts over as `new`.
      const stale = isStale(state, e)
      const status: Status = stale ? 'new' : e.status
      if (existing) {
        existing.deleted = false
        existing.content = structuredClone(e.content)
        existing.dateAdded = e.dateAdded
        setStatus(existing, status, e.ts, e.knownAt)
      } else {
        const created: EntryState = {
          id: e.entryId,
          content: structuredClone(e.content),
          status: 'new',
          dateAdded: e.dateAdded,
          deleted: false,
          reviews: [],
          seq: state.nextSeq++,
        }
        setStatus(created, status, e.ts, e.knownAt)
        state.entries.set(e.entryId, created)
      }
      const waiting = state.orphans.get(e.entryId)
      if (waiting) {
        state.orphans.delete(e.entryId)
        for (const w of waiting) applyInner(state, w)
      }
      return
    }
    case 'entry.update':
    case 'entry.delete':
    case 'status.set':
    case 'exposure':
    case 'review': {
      const entry = state.entries.get(e.entryId)
      if (!entry) {
        const list = state.orphans.get(e.entryId) ?? []
        list.push(e)
        state.orphans.set(e.entryId, list)
        return
      }
      if (e.type === 'entry.update') entry.content = { ...entry.content, ...structuredClone(e.fields) }
      else if (e.type === 'entry.delete') entry.deleted = true
      else if (e.type === 'status.set') {
        if (!isStale(state, e)) setStatus(entry, e.status, e.ts)
      } else if (e.type === 'exposure') {
        if (!isStale(state, e)) noteSeen(entry, e.ts)
      } else {
        if (isStale(state, e)) return
        // The same review can arrive under different event ids (live, then restored from a
        // backup or synced from another device); one entry can't have two identical ones.
        if (!entry.reviews.some((r) => r.ts === e.ts && r.rating === e.rating)) {
          entry.reviews.push({ ts: e.ts, rating: e.rating, mode: e.mode, exercise: e.exercise })
        }
        noteSeen(entry, e.ts)
      }
      return
    }
    default:
      // Event types from a newer version of the app: kept in the log, ignored here.
      return
  }
}

function noteSeen(entry: EntryState, ts: string): void {
  if (!entry.firstSeen || ts < entry.firstSeen) entry.firstSeen = ts
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type EventBody = DistributiveOmit<VocabEvent, 'v' | 'id' | 'ts' | 'device'>

/** Makes event ids for this device: `<device>:<ts>:<n>`. */
export function createEventFactory(device: string, clock: () => string = () => new Date().toISOString()) {
  let n = 0
  return {
    device,
    now: clock,
    make(body: EventBody, opts: { id?: string; ts?: string } = {}): VocabEvent {
      const ts = opts.ts ?? clock()
      return { v: FORMAT_VERSION, id: opts.id ?? `${device}:${ts}:${n++}`, ts, device, ...body } as VocabEvent
    },
  }
}

export function serializeLog(events: VocabEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
}

/** Tolerant: bad lines are reported and skipped, never thrown. */
export function parseLog(text: string): { events: VocabEvent[]; errors: { line: number; message: string }[] } {
  const events: VocabEvent[] = []
  const errors: { line: number; message: string }[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return
    try {
      const e = JSON.parse(raw)
      if (typeof e?.id !== 'string' || typeof e?.ts !== 'string' || typeof e?.device !== 'string' || typeof e?.type !== 'string') {
        throw new Error('missing id/ts/device/type')
      }
      events.push(e as VocabEvent)
    } catch (err) {
      errors.push({ line: i + 1, message: err instanceof Error ? err.message : String(err) })
    }
  })
  return { events, errors }
}

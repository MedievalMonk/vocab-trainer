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
    | { type: 'entry.add'; entryId: string; content: EntryContent; status: Status; dateAdded: string }
    | { type: 'entry.update'; entryId: string; fields: Partial<EntryContent> }
    | { type: 'entry.delete'; entryId: string }
    | { type: 'status.set'; entryId: string; status: Status }
    /** The teach-first flashcard pass was completed for this entry. */
    | { type: 'exposure'; entryId: string }
    | { type: 'review'; entryId: string; rating: Rating; mode?: string }
  )

export interface ReviewRecord {
  ts: string
  rating: Rating
  mode?: string
}

export interface EntryState {
  id: string
  content: EntryContent
  status: Status
  dateAdded: string
  firstSeen?: string
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
}

export function emptyState(): VocabState {
  return { entries: new Map(), seenEvents: new Set(), orphans: new Map(), nextSeq: 0 }
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
  for (const e of [...events].sort(compareEvents)) applyEvent(state, e)
  return state
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
      if (existing) {
        existing.deleted = false
        existing.content = structuredClone(e.content)
        existing.status = e.status
        existing.dateAdded = e.dateAdded
      } else {
        state.entries.set(e.entryId, {
          id: e.entryId,
          content: structuredClone(e.content),
          status: e.status,
          dateAdded: e.dateAdded,
          deleted: false,
          reviews: [],
          seq: state.nextSeq++,
        })
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
      else if (e.type === 'status.set') entry.status = e.status
      else if (e.type === 'exposure') noteSeen(entry, e.ts)
      else {
        // The same review can arrive under different event ids (live, then restored from a
        // backup or synced from another device); one entry can't have two identical ones.
        if (!entry.reviews.some((r) => r.ts === e.ts && r.rating === e.rating)) {
          entry.reviews.push({ ts: e.ts, rating: e.rating, mode: e.mode })
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

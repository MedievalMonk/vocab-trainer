import { createEventFactory, type EntryState, type VocabEvent, type VocabState } from './events'
import { entryIdFor, entryKey } from './identity'
import type { EntryContent, ParsedDocument, ParsedEntry, ParseWarning } from './types'

export interface ImportContext {
  /** ISO UTC timestamp for "now". Passed in so imports are testable and reproducible. */
  now: string
  device: string
  /** Overwrite content of entries that already exist. Default false: never clobber edits. */
  updateExisting?: boolean
}

export interface ImportReport {
  added: number
  /** Already present and identical. */
  unchanged: number
  /** Already present, content differs, left alone (updateExisting is off). */
  differing: string[]
  updated: number
  /** Previously deleted by the user; not resurrected by a re-import. */
  skippedDeleted: number
  /** Unusable blocks (missing required field). */
  skippedInvalid: number
  /** Repeated within the same import; first kept. */
  skippedRepeated: number
  reviewsRestored: number
  warnings: ParseWarning[]
}

const CONTENT_FIELDS = ['word', 'pos', 'definition', 'example', 'polish', 'section', 'register', 'similarExpressions'] as const

function toContent(p: ParsedEntry): EntryContent {
  const c: EntryContent = {
    word: p.word,
    pos: p.pos,
    definition: p.definition,
    example: p.example,
    polish: p.polish,
    tags: p.tags,
    collection: p.collection,
    extra: p.extra,
  }
  if (p.section) c.section = p.section
  if (p.register) c.register = p.register
  if (p.similarExpressions) c.similarExpressions = p.similarExpressions
  return c
}

/** Fields (other than collection, which is part of identity) that differ. */
function diffContent(a: EntryContent, b: EntryContent): Partial<EntryContent> {
  const out: Record<string, unknown> = {}
  for (const k of CONTENT_FIELDS) {
    if ((a[k] ?? '') !== (b[k] ?? '')) out[k] = b[k]
  }
  if (a.tags.join('\u0000') !== b.tags.join('\u0000')) out.tags = b.tags
  if (JSON.stringify(sortKeys(a.extra)) !== JSON.stringify(sortKeys(b.extra))) out.extra = b.extra
  return out as Partial<EntryContent>
}

function sortKeys(o: Record<string, string>): [string, string][] {
  return Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1))
}

/**
 * Turns a parsed file into events against the current state. Pure: nothing is written.
 *
 * - New entries are added with the file's status (usually `new`).
 * - Existing entries keep their status, FSRS history and edits. A file never resets them.
 * - Reviews/first-seen found in the file (an app export being restored) become events with
 *   deterministic ids, so restoring the same backup twice changes nothing.
 */
export function planImport(
  state: VocabState,
  doc: ParsedDocument,
  ctx: ImportContext,
): { events: VocabEvent[]; report: ImportReport } {
  const factory = createEventFactory(ctx.device, () => ctx.now)
  const events: VocabEvent[] = []
  const report: ImportReport = {
    added: 0, unchanged: 0, differing: [], updated: 0, skippedDeleted: 0,
    skippedInvalid: 0, skippedRepeated: 0, reviewsRestored: 0, warnings: [...doc.warnings],
  }

  const byKey = new Map<string, EntryState>()
  for (const e of state.entries.values()) byKey.set(entryKey(e.content), e)
  const seenInFile = new Set<string>()

  for (const parsed of doc.entries) {
    if (parsed.problems.length) {
      report.skippedInvalid++
      continue
    }
    const key = entryKey(parsed)
    if (seenInFile.has(key)) {
      report.skippedRepeated++
      report.warnings.push({ line: parsed.line, level: 'warn', message: `"${parsed.word}" appears twice in this import; first kept` })
      continue
    }
    seenInFile.add(key)

    const content = toContent(parsed)
    const existing = byKey.get(key)
    let entryId: string

    if (!existing) {
      entryId = entryIdFor(key)
      events.push(
        factory.make(
          { type: 'entry.add', entryId, content, status: parsed.status ?? 'new', dateAdded: parsed.dateAdded ?? ctx.now.slice(0, 10) },
          { id: `add:${entryId}` },
        ),
      )
      report.added++
    } else if (existing.deleted) {
      report.skippedDeleted++
      continue
    } else {
      entryId = existing.id
      const diff = diffContent(existing.content, content)
      if (Object.keys(diff).length === 0) report.unchanged++
      else if (ctx.updateExisting) {
        events.push(factory.make({ type: 'entry.update', entryId, fields: diff }))
        report.updated++
      } else report.differing.push(parsed.word)
    }

    if (parsed.firstSeen) {
      const id = `ex:${entryId}:${parsed.firstSeen}`
      if (!state.seenEvents.has(id)) events.push(factory.make({ type: 'exposure', entryId }, { id, ts: parsed.firstSeen }))
    }
    for (const r of parsed.reviews) {
      const id = `rv:${entryId}:${r.ts}:${r.rating}`
      if (state.seenEvents.has(id)) continue
      if (existing?.reviews.some((x) => x.ts === r.ts && x.rating === r.rating)) continue
      events.push(factory.make({ type: 'review', entryId, rating: r.rating, mode: 'restored' }, { id, ts: r.ts }))
      report.reviewsRestored++
    }
  }
  return { events, report }
}

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { findSameMeaningDuplicates } from './analysis'
import { createEventFactory, parseLog, replay, serializeLog, type EntryState, type VocabEvent } from './events'
import { exportMarkdown } from './export'
import { entryIdFor, entryKey } from './identity'
import { planImport, type ImportReport } from './merge'
import { parseMarkdown } from './markdown'

const T0 = '2026-10-01T10:00:00.000Z'
const T1 = '2026-10-02T10:00:00.000Z'
const T2 = '2026-10-03T10:00:00.000Z'

const FIXTURE = `# Vocabulary Batch — Chemistry (High School Level)
Collection: School Subjects > Chemistry
Format: markdown blocks — word · POS · definition · example · Polish · tags · status

---

## Atomic Structure

## atom
- **POS:** noun
- **Definition:** the smallest unit of an element that retains its chemical properties
- **Example:** Every atom of oxygen has eight protons.
- **Polish:** atom
- **Tags:** chemistry, atomic-structure
- **Status:** new

## current (electric)
- **POS:** noun
- **Definition:** a flow of electric charge
- **Example:** A current of two amperes flowed through the wire.
- **Polish:** prąd (elektryczny)
- **Tags:** physics
- **Status:** new

## Reactions

## titration
- **POS:** noun
- **Definition:** a method of finding a concentration by adding a measured reagent
  until a reaction is complete
- **Example:** Titration revealed the acid was more concentrated than labelled.
- **Polish:** miareczkowanie
- **Tags:** chemistry, analysis
- **Status:** new
- **Etymology:** from French titre
`

const IDIOMS = `Collection: Idioms

## bite the bullet
- **POS:** idiom
- **Definition:** to endure something painful or unpleasant with courage
- **Example:** She bit the bullet and told her manager the truth.
- **Polish:** zacisnąć zęby
- **Register:** informal
- **Similar expressions:** grin and bear it, take it on the chin
- **Tags:** idiom, endurance
- **Status:** new
`

/** Runs an import against the log, appends the events, returns the report. */
function doImport(log: VocabEvent[], text: string, now = T0, opts: { updateExisting?: boolean; defaultCollection?: string } = {}): ImportReport {
  const { events, report } = planImport(replay(log), parseMarkdown(text, opts), { now, device: 'pc', updateExisting: opts.updateExisting })
  log.push(...events)
  return report
}

const summary = (e: EntryState) => ({
  id: e.id,
  content: e.content,
  status: e.status,
  firstSeen: e.firstSeen,
  deleted: e.deleted,
  reviews: e.reviews.map((r) => [r.ts, r.rating]),
})

describe('parseMarkdown', () => {
  const doc = parseMarkdown(FIXTURE)

  it('reads entries, applying the Collection header to each', () => {
    expect(doc.entries.map((e) => e.word)).toEqual(['atom', 'current (electric)', 'titration'])
    expect(doc.entries.every((e) => e.collection === 'School Subjects > Chemistry')).toBe(true)
    expect(doc.collections).toEqual(['School Subjects > Chemistry'])
    expect(doc.warnings).toEqual([])
  })

  it('treats bullet-less ## blocks as section headings, not entries', () => {
    expect(doc.entries.map((e) => e.section)).toEqual(['Atomic Structure', 'Atomic Structure', 'Reactions'])
  })

  it('parses tags, Polish characters and wrapped definitions', () => {
    expect(doc.entries[1].polish).toBe('prąd (elektryczny)')
    expect(doc.entries[0].tags).toEqual(['chemistry', 'atomic-structure'])
    expect(doc.entries[2].definition).toBe('a method of finding a concentration by adding a measured reagent until a reaction is complete')
  })

  it('keeps unknown fields and idiom-only fields', () => {
    expect(doc.entries[2].extra).toEqual({ Etymology: 'from French titre' })
    const idiom = parseMarkdown(IDIOMS).entries[0]
    expect(idiom.register).toBe('informal')
    expect(idiom.similarExpressions).toBe('grin and bear it, take it on the chin')
  })

  it('flags incomplete entries as errors and unknown statuses as warnings', () => {
    const bad = parseMarkdown('Collection: X\n## foo\n- **POS:** noun\n- **Status:** maybe\n')
    expect(bad.entries[0].problems).toEqual(['missing definition', 'missing example', 'missing polish'])
    expect(bad.warnings.some((w) => w.level === 'error')).toBe(true)
    expect(bad.warnings.some((w) => /Unknown status/.test(w.message))).toBe(true)
  })

  it('needs a collection: from the header or defaultCollection', () => {
    const block = '## foo\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** p\n'
    expect(parseMarkdown(block).entries[0].problems).toContain('no Collection header')
    expect(parseMarkdown(block, { defaultCollection: 'Personal' }).entries[0].collection).toBe('Personal')
  })

  it('handles Windows line endings and a BOM', () => {
    const crlf = '﻿' + FIXTURE.replace(/\n/g, '\r\n')
    expect(parseMarkdown(crlf).entries).toHaveLength(3)
  })

  it('supports several Collection headers in one text', () => {
    const d = parseMarkdown(FIXTURE + '\n' + IDIOMS)
    expect(d.entries.map((e) => e.collection)).toEqual([
      'School Subjects > Chemistry', 'School Subjects > Chemistry', 'School Subjects > Chemistry', 'Idioms',
    ])
    expect(d.entries[3].section).toBeUndefined()
  })
})

describe('import / merge', () => {
  it('adds new entries with status new and the import date', () => {
    const log: VocabEvent[] = []
    const r = doImport(log, FIXTURE)
    expect(r.added).toBe(3)
    const s = replay(log)
    const atom = [...s.entries.values()][0]
    expect(atom.status).toBe('new')
    expect(atom.dateAdded).toBe('2026-10-01')
  })

  it('is idempotent: re-importing the same file adds nothing', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const before = log.length
    const r = doImport(log, FIXTURE, T1)
    expect(r.added).toBe(0)
    expect(r.unchanged).toBe(3)
    expect(log.length).toBe(before)
  })

  it('never resets status or history of existing entries', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const id = [...replay(log).entries.keys()][0]
    const f = createEventFactory('pc')
    log.push(f.make({ type: 'status.set', entryId: id, status: 'known' }, { ts: T1 }))
    log.push(f.make({ type: 'review', entryId: id, rating: 3 }, { ts: T1 }))
    doImport(log, FIXTURE, T2)
    const e = replay(log).entries.get(id)!
    expect(e.status).toBe('known')
    expect(e.reviews).toHaveLength(1)
  })

  it('does not overwrite edited content unless asked, and reports the difference', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const edited = FIXTURE.replace('miareczkowanie', 'miareczkowanie (analiza)')
    const r1 = doImport(log, edited, T1)
    expect(r1.differing).toEqual(['titration'])
    expect(replay(log).entries.get(entryIdFor(entryKey({ collection: 'School Subjects > Chemistry', word: 'titration', pos: 'noun' })))!.content.polish).toBe('miareczkowanie')
    const r2 = doImport(log, edited, T2, { updateExisting: true })
    expect(r2.updated).toBe(1)
    expect(replay(log).entries.get(entryIdFor(entryKey({ collection: 'School Subjects > Chemistry', word: 'titration', pos: 'noun' })))!.content.polish).toBe('miareczkowanie (analiza)')
  })

  it('does not resurrect entries the user deleted', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const id = [...replay(log).entries.keys()][0]
    log.push(createEventFactory('pc').make({ type: 'entry.delete', entryId: id }, { ts: T1 }))
    const r = doImport(log, FIXTURE, T2)
    expect(r.skippedDeleted).toBe(1)
    expect(replay(log).entries.get(id)!.deleted).toBe(true)
  })

  it('skips invalid and repeated blocks but still imports the rest', () => {
    const text = FIXTURE + '\n## broken\n- **POS:** noun\n\n' + FIXTURE.split('## atom')[1].split('## current')[0].replace(/^/, '## atom')
    const log: VocabEvent[] = []
    const r = doImport(log, text)
    expect(r.added).toBe(3)
    expect(r.skippedInvalid).toBe(1)
    expect(r.skippedRepeated).toBe(1)
  })

  it('keeps same word in two collections as separate entries', () => {
    const block = (c: string) => `Collection: ${c}\n## biome\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** biom\n- **Tags:** t\n- **Status:** new\n`
    const log: VocabEvent[] = []
    doImport(log, block('School Subjects > Biology'))
    doImport(log, block('School Subjects > Geography'))
    const s = replay(log)
    expect(s.entries.size).toBe(2)
    expect(findSameMeaningDuplicates(s.entries.values())).toHaveLength(1)
  })

  it('same-meaning detection ignores qualifiers with different translations', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    doImport(log, 'Collection: Geo\n## current (ocean)\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** prąd (morski)\n')
    expect(findSameMeaningDuplicates(replay(log).entries.values())).toEqual([])
  })
})

describe('event log replay', () => {
  const make = () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const id = [...replay(log).entries.keys()][0]
    const pc = createEventFactory('pc')
    const phone = createEventFactory('phone')
    log.push(pc.make({ type: 'review', entryId: id, rating: 3 }, { ts: T1 }))
    log.push(phone.make({ type: 'review', entryId: id, rating: 1 }, { ts: T2 }))
    log.push(pc.make({ type: 'status.set', entryId: id, status: 'learning' }, { ts: T1 }))
    return { log, id, pc, phone }
  }

  it('gives the same state whatever order events arrive in', () => {
    const { log } = make()
    const a = [...replay(log).entries.values()].map(summary)
    const b = [...replay([...log].reverse()).entries.values()].map(summary)
    const c = [...replay([...log.slice(3), ...log.slice(0, 3)]).entries.values()].map(summary)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('is idempotent when the same events are merged twice', () => {
    const { log, id } = make()
    expect(replay([...log, ...log]).entries.get(id)!.reviews).toHaveLength(2)
  })

  it('resolves concurrent edits by last write wins, per field', () => {
    const { log, id, pc, phone } = make()
    log.push(pc.make({ type: 'entry.update', entryId: id, fields: { polish: 'A', register: 'formal' } }, { ts: T1 }))
    log.push(phone.make({ type: 'entry.update', entryId: id, fields: { polish: 'B' } }, { ts: T2 }))
    const c = replay(log).entries.get(id)!.content
    expect(c.polish).toBe('B')
    expect(c.register).toBe('formal')
  })

  it('attaches events that arrive before their entry (restore from backup)', () => {
    const { log, id, pc } = make()
    const early = pc.make({ type: 'review', entryId: id, rating: 4 }, { ts: '2020-01-01T00:00:00.000Z' })
    const s = replay([early, ...log])
    expect(s.entries.get(id)!.reviews[0].ts).toBe('2020-01-01T00:00:00.000Z')
    expect(s.entries.get(id)!.firstSeen).toBe('2020-01-01T00:00:00.000Z')
  })

  it('lets a newer add resurrect a deleted entry', () => {
    const { log, id, pc } = make()
    log.push(pc.make({ type: 'entry.delete', entryId: id }, { ts: T1 }))
    expect(replay(log).entries.get(id)!.deleted).toBe(true)
    const content = replay(log).entries.get(id)!.content
    log.push(pc.make({ type: 'entry.add', entryId: id, content, status: 'new', dateAdded: '2026-10-03' }, { ts: T2 }))
    expect(replay(log).entries.get(id)!.deleted).toBe(false)
  })

  it('round-trips the JSONL log and tolerates bad lines and unknown event types', () => {
    const { log } = make()
    const future = { v: 9, id: 'x1', ts: T2, device: 'pc', type: 'something.new', payload: 1 }
    const text = serializeLog(log) + JSON.stringify(future) + '\nnot json\n'
    const parsed = parseLog(text)
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.events).toHaveLength(log.length + 1)
    expect(() => replay(parsed.events)).not.toThrow()
  })
})

describe('export / restore', () => {
  it('restores status, first-seen and review history from an export, byte-for-byte on re-export', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    doImport(log, IDIOMS)
    const ids = [...replay(log).entries.keys()]
    const f = createEventFactory('pc')
    log.push(f.make({ type: 'status.set', entryId: ids[0], status: 'known' }, { ts: T1 }))
    log.push(f.make({ type: 'review', entryId: ids[0], rating: 3 }, { ts: T1 }))
    log.push(f.make({ type: 'review', entryId: ids[0], rating: 4 }, { ts: T2 }))
    log.push(f.make({ type: 'exposure', entryId: ids[1] }, { ts: T1 }))

    const md = exportMarkdown(replay(log), { now: T2 })
    expect(md).toContain('Collection: Idioms')
    expect(md).toContain('- **Etymology:** from French titre')

    const fresh: VocabEvent[] = []
    const r = doImport(fresh, md, T2)
    expect(r.reviewsRestored).toBe(2)
    expect(r.warnings).toEqual([])
    const a = replay(log)
    const b = replay(fresh)
    const strip = (s: ReturnType<typeof replay>) => [...s.entries.values()].map(summary).map((x) => ({ ...x, id: x.id }))
    expect(strip(b)).toEqual(strip(a))
    expect(exportMarkdown(b, { now: T2 })).toBe(md)

    // Restoring the same backup again changes nothing.
    const again = doImport(fresh, md, T2)
    expect(again.added).toBe(0)
    expect(again.reviewsRestored).toBe(0)
  })

  it('restores into a store that already has the entries, without duplicating history', () => {
    const log: VocabEvent[] = []
    doImport(log, FIXTURE)
    const id = [...replay(log).entries.keys()][0]
    log.push(createEventFactory('pc').make({ type: 'review', entryId: id, rating: 3 }, { ts: T1 }))
    const md = exportMarkdown(replay(log), { now: T2 })
    doImport(log, md, T2)
    expect(replay(log).entries.get(id)!.reviews).toHaveLength(1)
  })
})

const CONTENT_DIR = process.env.VOCAB_CONTENT_DIR ?? path.resolve(process.cwd(), 'content')
describe.skipIf(!fs.existsSync(CONTENT_DIR))('real content files', () => {
  const files = fs.existsSync(CONTENT_DIR) ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).sort() : []

  const loadAll = () => {
    const log: VocabEvent[] = []
    const reports = files.map((f) => doImport(log, fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8')))
    return { log, reports }
  }

  it('parses every file with no errors and no incomplete entries', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
    for (const f of files) {
      const doc = parseMarkdown(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'))
      expect(doc.warnings.filter((w) => w.level === 'error'), f).toEqual([])
      expect(doc.collections, f).toHaveLength(1)
    }
  })

  it('imports all entries; ids are unique; only two same-meaning duplicates exist', () => {
    const { log, reports } = loadAll()
    const s = replay(log)
    const added = reports.reduce((n, r) => n + r.added, 0)
    expect(added).toBe(s.entries.size)
    expect(added).toBeGreaterThanOrEqual(800)
    expect(reports.reduce((n, r) => n + r.skippedInvalid + r.skippedRepeated, 0)).toBe(0)
    const dups = findSameMeaningDuplicates(s.entries.values()).map((g) => g.word)
    expect(dups).toEqual(['biome', 'social contract'])
  })

  it('survives a full export and restore unchanged', () => {
    const { log } = loadAll()
    const md = exportMarkdown(replay(log), { now: T2 })
    const fresh: VocabEvent[] = []
    const r = doImport(fresh, md, T2)
    expect(r.warnings).toEqual([])
    expect(exportMarkdown(replay(fresh), { now: T2 })).toBe(md)
  })

  it('re-importing the files changes nothing', () => {
    const { log } = loadAll()
    const before = log.length
    for (const f of files) doImport(log, fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'), T1)
    expect(log.length).toBe(before)
  })
})

describe('entry order', () => {
  it('keeps the order of the source file through import and export', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${String(i).padStart(2, '0')}`)
    const text =
      'Collection: Idioms\n\n## Part One\n\n' +
      words.map((w) => `## ${w}\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** p\n- **Tags:** t\n- **Status:** new\n`).join('\n')
    const log: VocabEvent[] = []
    doImport(log, text)
    const state = replay(log)
    expect([...state.entries.values()].map((e) => e.content.word)).toEqual(words)
    const md = exportMarkdown(state, { now: T2 })
    expect(md.match(/^## Part One$/gm)).toHaveLength(1) // not repeated between scrambled entries
    expect([...md.matchAll(/^## (word\d+)$/gm)].map((m) => m[1])).toEqual(words)
  })
})

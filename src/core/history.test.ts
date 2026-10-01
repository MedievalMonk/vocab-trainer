import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { replay, type VocabEvent } from './events'
import { addDays, dayKey } from './history'
import { VocabService } from './service'
import { IndexedDbStore, MemoryStore } from './store'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const block = (i: number) =>
  `## word${i}\n- **POS:** noun\n- **Definition:** d${i}\n- **Example:** e${i}\n- **Polish:** p${i}\n- **Tags:** t\n- **Status:** new\n`
const text = (n: number, collection = 'Idioms') => `Collection: ${collection}\n\n` + Array.from({ length: n }, (_, i) => block(i)).join('\n')

async function setup(opts: { store?: MemoryStore | IndexedDbStore; start?: string; tz?: number } = {}) {
  const clock = { now: new Date(opts.start ?? '2026-10-01T09:00:00.000Z') }
  const store = opts.store ?? new MemoryStore()
  const open = () => VocabService.open(store, { clock: () => clock.now, tzOffsetMin: () => opts.tz ?? 0, deviceId: 'pc' })
  return { svc: await open(), clock, store, open }
}
type Svc = Awaited<ReturnType<typeof setup>>['svc']
const ids = (svc: Svc) => [...svc.state.entries.keys()]
const advance = (c: { now: Date }, ms: number) => (c.now = new Date(c.now.getTime() + ms))

/** Teach everything, then answer each word once, `again` of them wrongly. */
async function study(svc: Svc, c: { now: Date }, again = 0) {
  await svc.markExposed(ids(svc))
  advance(c, HOUR)
  let i = 0
  for (const id of ids(svc)) await svc.review(id, i++ < again ? 1 : 3, 'repetition')
}

describe('calendar helpers', () => {
  it('maps a moment to the local calendar date for a time zone', () => {
    const t = Date.parse('2026-10-01T22:30:00Z')
    expect(dayKey(t, 0)).toBe('2026-10-01')
    expect(dayKey(t, 120)).toBe('2026-10-02') // Warsaw, summer time: already tomorrow
    expect(dayKey(t, -300)).toBe('2026-10-01')
  })
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('history', () => {
  it('counts reviews, accuracy, taught words and known words on the day they happened', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(10))
    await study(svc, clock, 3) // day 1: 10 taught, 10 reviews, 7 correct
    advance(clock, DAY)
    await svc.setStatus(ids(svc)[0], 'known')
    const cal = svc.calendar()
    const d1 = cal.days['2026-10-01']
    expect(d1).toEqual({ reviews: 10, correct: 7, taught: 10, known: 0 })
    expect(cal.days['2026-10-02']).toEqual({ reviews: 0, correct: 0, taught: 0, known: 1 })
    expect(cal.totals).toEqual({ reviews: 10, correct: 7, taught: 10, known: 1, activeDays: 2 })
    expect(cal.today).toBe('2026-10-02')
    expect(cal.since).toBe('2026-10-01')
    expect(cal.sinceReset).toBe(false)
  })

  it('attributes late-evening activity to the next local day in Warsaw time', async () => {
    const { svc, clock } = await setup({ start: '2026-10-01T21:30:00.000Z', tz: 120 })
    await svc.importMarkdown(text(2))
    await study(svc, clock) // taught 23:30 on 1 Oct, answered an hour later: 00:30 on 2 Oct
    const days = svc.calendar().days
    expect(days['2026-10-01']).toMatchObject({ taught: 2, reviews: 0 })
    expect(days['2026-10-02']).toMatchObject({ taught: 0, reviews: 2 })
  })

  it('puts overdue and upcoming reviews on real dates', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(3))
    await study(svc, clock)
    advance(clock, 40 * DAY) // all three are long overdue
    const due = svc.calendar().due
    expect(due[dayKey(clock.now.getTime(), 0)]).toBe(3)
    expect(Object.values(due).reduce((a, b) => a + b, 0)).toBe(3)

    // A freshly answered word falls due on a later date, not today.
    for (const id of svc.repetitions()) await svc.review(id, 4, 'repetition')
    const after = svc.calendar(400)
    expect(Object.keys(after.due).every((k) => k > after.today)).toBe(true)
    expect(Object.values(after.due).reduce((a, b) => a + b, 0)).toBe(3)
  })
})

describe('reset progress', () => {
  it('returns every word to new, restarts the history, and keeps the words', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(6))
    await study(svc, clock)
    await svc.setStatus(ids(svc)[0], 'known')
    advance(clock, DAY)
    await svc.resetProgress()

    expect(svc.state.entries.size).toBe(6)
    for (const e of svc.state.entries.values()) {
      expect(e.status).toBe('new')
      expect(e.reviews).toEqual([])
      expect(e.firstSeen).toBeUndefined()
      expect(e.knownAt).toBeUndefined()
    }
    expect(svc.dashboard().dueToday).toBe(0)
    expect(svc.newWords({ kind: 'random' }).ids).toHaveLength(6) // all teachable again
    const cal = svc.calendar()
    expect(cal.totals).toEqual({ reviews: 0, correct: 0, taught: 0, known: 0, activeDays: 0 })
    expect(cal.since).toBe('2026-10-02')
    expect(cal.sinceReset).toBe(true)
  })

  it('counts only what happens after the reset', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(4))
    await study(svc, clock)
    advance(clock, DAY)
    await svc.resetProgress()
    advance(clock, HOUR)
    await svc.markExposed(ids(svc).slice(0, 2))
    expect(svc.calendar().totals.taught).toBe(2)
    expect(svc.state.entries.get(ids(svc)[0])!.status).toBe('learning')
  })

  it('replays identically whatever order the log arrives in', async () => {
    const { svc, clock, store } = await setup()
    await svc.importMarkdown(text(5))
    await study(svc, clock)
    advance(clock, DAY)
    await svc.resetProgress()
    advance(clock, HOUR)
    await svc.markExposed(ids(svc).slice(0, 2))
    const events = await store.loadAll()
    const snap = (evs: VocabEvent[]) => JSON.stringify([...replay(evs).entries.values()].map((e) => [e.id, e.status, e.firstSeen, e.reviews.length]))
    expect(snap([...events].reverse())).toBe(snap(events))
  })

  it('a backup restored after the reset brings its history back, on the original days', async () => {
    const a = await setup()
    await a.svc.importMarkdown(text(4))
    await study(a.svc, a.clock, 1)
    const backup = a.svc.exportMarkdown()
    advance(a.clock, 2 * DAY)
    await a.svc.resetProgress()
    expect(a.svc.calendar().totals.reviews).toBe(0)

    advance(a.clock, HOUR)
    await a.svc.importMarkdown(backup)
    const cal = a.svc.calendar()
    expect(cal.days['2026-10-01'].reviews).toBe(4)
    expect(cal.totals.taught).toBe(4)
  })

  it('a backup restored before a reset is wiped by it, like everything else', async () => {
    const a = await setup()
    await a.svc.importMarkdown(text(4))
    await study(a.svc, a.clock)
    const backup = a.svc.exportMarkdown()

    const b = await setup({ start: '2026-10-05T09:00:00.000Z' })
    await b.svc.importMarkdown(backup)
    expect(b.svc.calendar().totals.reviews).toBe(4)
    advance(b.clock, HOUR)
    await b.svc.resetProgress()
    expect(b.svc.calendar().totals.reviews).toBe(0)
    for (const e of b.svc.state.entries.values()) expect(e.status).toBe('new')
  })

  it('keeps the original filing date of known words through export and restore', async () => {
    const a = await setup()
    await a.svc.importMarkdown(text(2))
    await study(a.svc, a.clock)
    advance(a.clock, 3 * DAY)
    await a.svc.setStatus(ids(a.svc)[0], 'known')
    const backup = a.svc.exportMarkdown()
    expect(backup).toContain('- **Known since:** 2026-10-04')

    const b = await setup({ start: '2026-11-20T09:00:00.000Z' })
    await b.svc.importMarkdown(backup)
    const cal = b.svc.calendar()
    expect(cal.days['2026-10-04'].known).toBe(1)
    expect(cal.days['2026-11-20']?.known ?? 0).toBe(0)
  })
})

describe('clear everything', () => {
  it('removes words, progress, history and settings, but keeps the device id', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(5))
    await study(svc, clock)
    await svc.updateSettings({ dailyCap: 12 })
    await svc.clearEverything()

    expect(svc.state.entries.size).toBe(0)
    expect(svc.settings.dailyCap).toBe(50)
    expect(svc.calendar().totals.reviews).toBe(0)
    expect(svc.calendar().since).toBeNull()
    expect(svc.deviceId).toBe('pc')
    // Usable again straight away.
    expect((await svc.importMarkdown(text(2))).added).toBe(2)
  })

  it('is permanent in IndexedDB: a reopened service finds nothing', async () => {
    const idb = new IDBFactory()
    const a = await setup({ store: new IndexedDbStore('t', idb) })
    await a.svc.importMarkdown(text(5))
    await study(a.svc, a.clock)
    await a.svc.updateSettings({ dailyCap: 12 })
    await a.svc.clearEverything()

    const b = await setup({ store: new IndexedDbStore('t', idb) })
    expect(b.svc.state.entries.size).toBe(0)
    expect(b.svc.settings.dailyCap).toBe(50)
    expect(await new IndexedDbStore('t', idb).loadAll()).toEqual([])
  })
})

import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { replay } from './events'
import { IndexedDbStore, MemoryStore } from './store'
import { VocabService } from './service'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const block = (i: number) =>
  `## word${i}\n- **POS:** noun\n- **Definition:** d${i}\n- **Example:** e${i}\n- **Polish:** p${i}\n- **Tags:** t\n- **Status:** new\n`
const text = (collection: string, n: number, start = 0) =>
  `Collection: ${collection}\n\n` + Array.from({ length: n }, (_, i) => block(start + i)).join('\n')

/** A service with a hand-moved clock, UTC day boundaries and a cap of 50. */
async function setup(opts: { store?: MemoryStore | IndexedDbStore; cap?: number; start?: string } = {}) {
  const clock = { now: new Date(opts.start ?? '2026-10-01T09:00:00.000Z') }
  const store = opts.store ?? new MemoryStore()
  const open = () => VocabService.open(store, { clock: () => clock.now, tzOffsetMin: () => 0, deviceId: 'pc' })
  const svc = await open()
  if (opts.cap) await svc.updateSettings({ dailyCap: opts.cap })
  return { svc, clock, store, open }
}
type Svc = Awaited<ReturnType<typeof setup>>['svc']
const ids = (svc: Svc) => [...svc.state.entries.keys()]

/** Teach and quiz every entry once, then jump `days` into the future so all are due. */
async function makeAllDue(svc: Svc, clock: { now: Date }, days: number) {
  await svc.markExposed(ids(svc))
  clock.now = new Date(clock.now.getTime() + HOUR)
  for (const id of ids(svc)) await svc.review(id, 3, 'repetition')
  clock.now = new Date(clock.now.getTime() + days * DAY)
}

describe('FSRS replay', () => {
  it('derives the same card from the same history, and pushes the due date out on success', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    clock.now = new Date(clock.now.getTime() + HOUR)
    await svc.review(id, 3, 'repetition')
    expect(svc.card(id)!.reps).toBe(1)
    // Successive Good answers, each given when the word falls due: intervals must grow.
    const gaps: number[] = []
    for (let i = 0; i < 6; i++) {
      gaps.push(svc.card(id)!.due.getTime() - clock.now.getTime())
      clock.now = new Date(svc.card(id)!.due.getTime())
      await svc.review(id, 3, 'repetition')
    }
    expect(gaps[0]).toBeGreaterThan(0)
    expect(gaps[5]).toBeGreaterThan(gaps[2])
    expect(gaps[5]).toBeGreaterThan(DAY)
    const last = svc.card(id)!

    // A second service opened on the same data derives the identical card.
    const again = await VocabService.open((svc as unknown as { store: MemoryStore }).store, { clock: () => clock.now, tzOffsetMin: () => 0, deviceId: 'pc' })
    expect(again.card(id)).toEqual(last)
  })

  it('a taught word becomes due shortly after, not immediately', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    await svc.markExposed(ids(svc))
    expect(svc.repetitions()).toEqual([])
    clock.now = new Date(clock.now.getTime() + 11 * MIN)
    expect(svc.repetitions()).toHaveLength(1)
  })
})

describe('teach-first flow', () => {
  it('exposure marks a word learning, spends no daily cap, and unseen words cannot be quizzed', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(text('Idioms', 3))
    const [a, b] = ids(svc)
    await expect(svc.review(a, 3, 'repetition')).rejects.toThrow(/teach-first/)
    await svc.markExposed([a])
    expect(svc.state.entries.get(a)!.status).toBe('learning')
    expect(svc.state.entries.get(b)!.status).toBe('new')
    expect(svc.dashboard().doneToday).toBe(0)
  })

  it('exposed-but-unquizzed words form the New Words revisit pool', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(text('Idioms', 3))
    const [a] = ids(svc)
    await svc.markExposed([a])
    expect(svc.revisit()).toEqual([a])
    await svc.review(a, 3, 'revisit')
    expect(svc.revisit()).toEqual([])
  })
})

describe('daily cap and backlog', () => {
  it('never queues more than what is left of the cap, even with hundreds overdue', async () => {
    const { svc, clock } = await setup({ cap: 50 })
    await svc.importMarkdown(text('School Subjects > Maths', 120))
    await makeAllDue(svc, clock, 90)
    const d = svc.dashboard()
    expect(d.dueNow).toBe(120)
    expect(svc.repetitions()).toHaveLength(20)

    for (let i = 0; i < 2; i++) for (const id of svc.repetitions()) await svc.review(id, 3, 'repetition')
    expect(svc.dashboard().doneToday).toBe(40)
    expect(svc.repetitions()).toHaveLength(10)
    for (const id of svc.repetitions()) await svc.review(id, 3, 'repetition')
    expect(svc.dashboard().remainingToday).toBe(0)
    expect(svc.repetitions()).toEqual([])
  })

  it('serves the most at-risk word first', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 2))
    const [a, b] = ids(svc)
    await svc.markExposed([a, b])
    clock.now = new Date(clock.now.getTime() + HOUR)
    await svc.review(a, 3, 'repetition')
    await svc.review(b, 4, 'repetition') // Easy: more stable, so less at risk later
    clock.now = new Date(clock.now.getTime() + 200 * DAY)
    expect(svc.repetitions()).toEqual([a, b])
  })

  it('pauses new-word intake while a backlog exists, and resumes when it clears', async () => {
    const { svc, clock } = await setup({ cap: 50 })
    await svc.importMarkdown(text('School Subjects > Maths', 60))
    await svc.importMarkdown(text('Idioms', 30, 1000))
    const maths = ids(svc).slice(0, 60)
    await svc.markExposed(maths)
    clock.now = new Date(clock.now.getTime() + HOUR)
    for (const id of maths) await svc.review(id, 3, 'repetition')
    // The 60 Maths reviews above already exceed today's cap; move to a fresh day with 60 due.
    clock.now = new Date(clock.now.getTime() + 90 * DAY)
    const paused = svc.newWords({ kind: 'collection', collection: 'Idioms' })
    expect(paused).toEqual({ ids: [], paused: true })

    // Clear the backlog (the cap lets 50 through; the rest are overdue until tomorrow).
    for (let i = 0; i < 3; i++) for (const id of svc.repetitions()) await svc.review(id, 3, 'repetition')
    expect(svc.newWords({ kind: 'random' }).paused).toBe(true)
    clock.now = new Date(clock.now.getTime() + DAY)
    for (let i = 0; i < 3; i++) for (const id of svc.repetitions()) await svc.review(id, 3, 'repetition')
    expect(svc.newWords({ kind: 'random' }, () => 0.5).paused).toBe(false)
  })

  it('a small number of due words is not a backlog', async () => {
    const { svc, clock } = await setup({ cap: 50 })
    await svc.importMarkdown(text('Idioms', 40))
    await svc.markExposed(ids(svc).slice(0, 10))
    clock.now = new Date(clock.now.getTime() + HOUR)
    const r = svc.newWords({ kind: 'random' })
    expect(r.paused).toBe(false)
    expect(r.ids).toHaveLength(20)
  })

  it('reviews restored from a backup do not count against today', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    await svc.markExposed(ids(svc))
    clock.now = new Date(clock.now.getTime() + HOUR)
    await svc.review(ids(svc)[0], 3, 'repetition')
    const md = svc.exportMarkdown().replace(/\d{4}-\d\d-\d\dT[\d:.]+Z=3/, `${clock.now.toISOString()}=3`)
    const fresh = await setup({ start: clock.now.toISOString() })
    await fresh.svc.importMarkdown(md)
    expect(fresh.svc.dashboard().doneToday).toBe(0)
  })
})

describe('new words batches', () => {
  it('collection mode includes sub-collections and never pads with other content', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(text('School Subjects > Maths', 5))
    await svc.importMarkdown(text('School Subjects > Biology', 3, 100))
    await svc.importMarkdown(text('Idioms', 30, 200))
    expect(svc.newWords({ kind: 'collection', collection: 'School Subjects > Biology' }).ids).toHaveLength(3)
    expect(svc.newWords({ kind: 'collection', collection: 'School Subjects' }).ids).toHaveLength(8)
    expect(svc.newWords({ kind: 'collection', collection: 'Idioms' }).ids).toHaveLength(20)
  })

  it('recent mode serves the newest first and skips words already taught', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 25))
    clock.now = new Date(clock.now.getTime() + 2 * DAY)
    await svc.importMarkdown(text('Personal', 3, 500))
    const batch = svc.newWords({ kind: 'recent' }).ids
    expect(batch.slice(0, 3).map((id) => svc.state.entries.get(id)!.content.collection)).toEqual(['Personal', 'Personal', 'Personal'])
    await svc.markExposed(batch)
    expect(svc.newWords({ kind: 'recent' }).ids.some((id) => batch.includes(id))).toBe(false)
  })

  it('random mode is a shuffle driven by the supplied generator', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(text('Idioms', 40))
    const mk = () => {
      let s = 7
      return () => ((s = (s * 48271) % 2147483647) / 2147483647)
    }
    const a = svc.newWords({ kind: 'random' }, mk()).ids
    const b = svc.newWords({ kind: 'random' }, mk()).ids
    expect(a).toEqual(b)
    expect(a).not.toEqual(ids(svc).slice(0, 20))
    expect(new Set(a).size).toBe(20)
  })
})

describe('status changes from reviewing', () => {
  it('becomes known once stable enough, returns to learning on a lapse', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    clock.now = new Date(clock.now.getTime() + HOUR)
    let status = await svc.review(id, 3, 'repetition')
    expect(status).toBe('learning')
    let guard = 0
    while (status !== 'known' && guard++ < 20) {
      clock.now = new Date(svc.card(id)!.due.getTime())
      status = await svc.review(id, 3, 'repetition')
    }
    expect(status).toBe('known')
    expect(guard).toBeLessThan(12)
    clock.now = new Date(svc.card(id)!.due.getTime())
    expect(await svc.review(id, 1, 'repetition')).toBe('learning')
  })
})

describe('dashboard', () => {
  it('counts due today (including overdue), a 7-day forecast, and per collection', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('School Subjects > Maths', 4))
    await svc.importMarkdown(text('Idioms', 2, 100))
    await svc.markExposed(ids(svc))
    clock.now = new Date(clock.now.getTime() + HOUR)
    for (const id of ids(svc)) await svc.review(id, 3, 'repetition')
    // Let the first-review intervals pass, then look at the next week.
    clock.now = new Date(clock.now.getTime() + 30 * DAY)
    const d = svc.dashboard()
    expect(d.forecast).toHaveLength(7)
    expect(d.dueToday).toBe(6)
    expect(d.forecast[0]).toBe(6)
    expect(d.perCollection).toEqual([
      { collection: 'School Subjects > Maths', dueToday: 4 },
      { collection: 'Idioms', dueToday: 2 },
    ])
    expect(d.dailyCap).toBe(50)
  })

  it('shows reviews landing on later days in the forecast', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    clock.now = new Date(clock.now.getTime() + HOUR)
    await svc.review(id, 3, 'repetition')
    const dueIn = Math.round((svc.card(id)!.due.getTime() - clock.now.getTime()) / DAY)
    const d = svc.dashboard()
    if (dueIn >= 1 && dueIn < 7) expect(d.forecast[dueIn]).toBe(1)
    expect(d.dueToday + d.forecast.slice(1).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1)
  })
})

describe('storage', () => {
  it('IndexedDB: events persist across reopen, appends are idempotent, meta is stable', async () => {
    const idb = new IDBFactory()
    const a = await setup({ store: new IndexedDbStore('t', idb) })
    await a.svc.importMarkdown(text('Idioms', 5))
    const id = ids(a.svc)[0]
    await a.svc.markExposed([id])
    const before = JSON.stringify([...a.svc.state.entries.values()])

    const b = await setup({ store: new IndexedDbStore('t', idb) })
    expect(JSON.stringify([...b.svc.state.entries.values()])).toBe(before)
    expect(b.svc.deviceId).toBe('pc')

    const store = new IndexedDbStore('t', idb)
    const events = await store.loadAll()
    await store.append(events) // same ids again: no duplicates
    expect(await store.loadAll()).toHaveLength(events.length)
    expect(replay(events).entries.size).toBe(5)
  })

  it('survives the full cycle: export, wipe, restore into a fresh store', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 3))
    await makeAllDue(svc, clock, 0)
    await svc.review(ids(svc)[0], 4, 'repetition')
    const md = svc.exportMarkdown()
    expect(md).toContain('- **FSRS:** due=')

    const fresh = await setup({ start: clock.now.toISOString() })
    const r = await fresh.svc.importMarkdown(md)
    expect(r.added).toBe(3)
    for (const id of ids(svc)) {
      expect(fresh.svc.card(id)).toEqual(svc.card(id))
      expect(fresh.svc.state.entries.get(id)!.status).toBe(svc.state.entries.get(id)!.status)
    }
  })
})

describe('"due today" means the whole day', () => {
  /** Brings one word to the Review stage, then stands 5 hours before it falls due, same calendar day. */
  async function wordDueLaterToday() {
    const { svc, clock } = await setup({ start: '2026-10-01T09:00:00.000Z' })
    await svc.importMarkdown(text('Idioms', 1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    clock.now = new Date(clock.now.getTime() + HOUR)
    for (let i = 0; i < 6; i++) {
      await svc.review(id, 3, 'repetition')
      clock.now = new Date(Math.max(svc.card(id)!.due.getTime(), clock.now.getTime()))
    }
    const due = svc.card(id)!.due
    // Move to 05:00 on the due day, so the card is due later today.
    const early = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), 0, 0, 0))
    clock.now = new Date(early.getTime() + 1 * HOUR)
    return { svc, clock, id, due }
  }

  it('a review-stage word due later today is offered now, matching the dashboard count', async () => {
    const { svc, id, due, clock } = await wordDueLaterToday()
    expect(due.getTime()).toBeGreaterThan(clock.now.getTime()) // not yet due by the clock
    expect(svc.card(id)!.state).toBe(2) // Review
    const d = svc.dashboard()
    expect(d.dueToday).toBe(1)
    expect(d.dueNow).toBe(1) // available now: it is due today
    expect(svc.repetitions()).toEqual([id])
  })

  it('a short learning step is still waited out: a word due in 10 minutes is not offered yet', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text('Idioms', 1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    clock.now = new Date(clock.now.getTime() + HOUR)
    await svc.review(id, 3, 'repetition') // first answer: due again in minutes, still learning
    expect(svc.card(id)!.state).toBe(1)
    expect(svc.dashboard().dueToday).toBe(1)
    expect(svc.repetitions()).toEqual([])
    clock.now = new Date(svc.card(id)!.due.getTime())
    expect(svc.repetitions()).toEqual([id])
  })

  it('counts them toward the backlog the same way', async () => {
    const { svc, id } = await wordDueLaterToday()
    expect(svc.dashboard().remainingToday).toBeGreaterThanOrEqual(1)
    await svc.updateSettings({ dailyCap: 1 })
    await svc.review(id, 3, 'repetition')
    expect(svc.dashboard().remainingToday).toBe(0)
  })
})

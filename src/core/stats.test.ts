import { describe, expect, it } from 'vitest'
import { VocabService } from './service'
import { MemoryStore } from './store'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const block = (i: number, coll = 'Idioms') => `## w${i}\n- **POS:** noun\n- **Definition:** d${i}\n- **Example:** e${i}\n- **Polish:** p${i}\n- **Tags:** t\n- **Status:** new\n`
const text = (n: number, coll = 'Idioms', start = 0) => `Collection: ${coll}\n\n` + Array.from({ length: n }, (_, i) => block(start + i)).join('\n')

async function setup() {
  const clock = { now: new Date('2026-10-01T09:00:00.000Z') }
  const svc = await VocabService.open(new MemoryStore(), { clock: () => clock.now, tzOffsetMin: () => 0, deviceId: 'pc' })
  return { svc, clock }
}
const ids = (s: Awaited<ReturnType<typeof setup>>['svc']) => [...s.state.entries.keys()]
const advance = (c: { now: Date }, ms: number) => (c.now = new Date(c.now.getTime() + ms))

describe('library counts', () => {
  it('totals the library and the words studied, learning and known', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(10))
    expect(svc.counts()).toEqual({ total: 10, studied: 0, notStarted: 10, learning: 0, known: 0 })
    await svc.markExposed(ids(svc).slice(0, 4))
    await svc.setStatus(ids(svc)[0], 'known')
    advance(clock, HOUR)
    expect(svc.counts()).toEqual({ total: 10, studied: 4, notStarted: 6, learning: 3, known: 1 })
    await svc.deleteEntry(ids(svc)[9])
    expect(svc.counts().total).toBe(9)
  })
})

describe('custom batch size', () => {
  it('lets a single batch be any size, still bounded by the pool and the daily cap', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(60))
    expect(svc.newWords({ kind: 'random' }).ids).toHaveLength(20) // the default
    expect(svc.newWords({ kind: 'random' }, undefined, 7).ids).toHaveLength(7)
    expect(svc.newWords({ kind: 'random' }, undefined, 45).ids).toHaveLength(45)
    expect(svc.newWords({ kind: 'random' }, undefined, 500).ids).toHaveLength(60) // never padded

    await svc.markExposed(ids(svc).slice(0, 30))
    advance(clock, HOUR)
    expect(svc.revisit(12)).toHaveLength(12)
    expect(svc.revisit(100)).toHaveLength(30)
    for (const id of ids(svc).slice(0, 30)) await svc.review(id, 3, 'revisit')
    advance(clock, 30 * DAY)
    await svc.updateSettings({ dailyCap: 25 })
    expect(svc.repetitions(100)).toHaveLength(25) // the cap still wins
    expect(svc.repetitions(10)).toHaveLength(10)
  })
})

describe('stats', () => {
  it('measures retention only on answers given to words already past the learning stage', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(1))
    const id = ids(svc)[0]
    await svc.markExposed([id])
    advance(clock, HOUR)
    // Good until the word graduates, then keep answering: the first answers are learning-stage.
    for (let i = 0; i < 6; i++) {
      await svc.review(id, 3, 'repetition', 'recall')
      advance(clock, Math.max(svc.card(id)!.due.getTime() - clock.now.getTime(), 0))
    }
    await svc.review(id, 1, 'repetition', 'flashcard') // a miss on a learned word
    const r = svc.stats().reviews
    expect(r.total).toBe(7)
    expect(r.matureTotal).toBeGreaterThan(0)
    expect(r.matureTotal).toBeLessThan(r.total)
    expect(r.matureCorrect).toBe(r.matureTotal - 1)
  })

  it('breaks accuracy down by exercise type', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(3))
    await svc.markExposed(ids(svc))
    advance(clock, HOUR)
    const [a, b, c] = ids(svc)
    await svc.review(a, 3, 'repetition', 'choice')
    await svc.review(b, 1, 'repetition', 'choice')
    await svc.review(c, 3, 'repetition', 'recall')
    const ex = Object.fromEntries(svc.stats().exercises.map((x) => [x.kind, [x.total, x.correct]]))
    expect(ex).toEqual({ choice: [2, 1], recall: [1, 1] })
  })

  it('lists the words you keep missing, most lapses first', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(2))
    const [hard, easy] = ids(svc)
    await svc.markExposed([hard, easy])
    advance(clock, HOUR)
    const toDue = () => advance(clock, Math.max(svc.card(hard)!.due.getTime() - clock.now.getTime(), 0))
    for (let i = 0; i < 5; i++) {
      await svc.review(hard, 3, 'repetition')
      toDue()
    }
    for (let i = 0; i < 3; i++) {
      await svc.review(hard, 1, 'repetition') // lapse
      toDue()
      await svc.review(hard, 3, 'repetition')
      toDue()
    }
    await svc.review(easy, 3, 'repetition')
    const h = svc.stats().hardest
    expect(h.map((x) => x.word)).toEqual(['w0'])
    expect(h[0].lapses).toBeGreaterThanOrEqual(2)
  })

  it('gives a 30-day series ending today, per-collection progress and a pace estimate', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(text(10, 'School Subjects > Maths'))
    await svc.importMarkdown(text(10, 'Idioms', 100))
    await svc.markExposed(ids(svc).slice(0, 5))
    advance(clock, HOUR)
    const s = svc.stats()
    expect(s.last30).toHaveLength(30)
    expect(s.last30.at(-1)).toEqual({ day: '2026-10-01', reviews: 0, taught: 5 })
    expect(s.last30[0].day).toBe('2026-09-02')
    expect(s.collections).toEqual([
      { collection: 'Idioms', total: 10, studied: 0, known: 0 },
      { collection: 'School Subjects > Maths', total: 10, studied: 5, known: 0 },
    ])
    expect(s.pace).toEqual({ newPerActiveDay: 5, notStarted: 15, estimatedActiveDays: 3 })
  })

  it('has no pace estimate before anything has been studied', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(text(4))
    const s = svc.stats()
    expect(s.pace.estimatedActiveDays).toBeNull()
    expect(s.reviews.perActiveDay).toBeNull()
  })
})

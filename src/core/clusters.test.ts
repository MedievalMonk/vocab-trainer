import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasClusters, parseClusters, serializeClusters } from './clusters'
import { VocabService } from './service'
import { MemoryStore } from './store'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const FILE = `# Synonym Cluster Batch — Intensity Gradients
Collection: Thesaurus
Format: markdown cluster blocks
Note: each cluster here is organized as a gradient from mildest to most extreme member,
rather than a flat group of equals.

---

## Cluster: peckish / hungry / starving
Core meaning: feeling a need or desire to eat

### peckish
- Register: neutral — a calm word
- Nuance: the mildest; a slight desire for a snack,
  not real hunger
- Example: I'm feeling a bit peckish before dinner.
- Polish: lekko głodny

### hungry
- Register: neutral, the default
- Nuance: the general-purpose term
- Example: The children were hungry after the long walk.
- Polish: głodny

### starving
- Register: informal, emphatic
- Nuance: literally extreme hunger, but casually exaggerated
- Example: I'm absolutely starving; when is lunch?
- Polish: umierający z głodu

---

## Cluster: big / large / huge
Core meaning: of great size

### big
- Register: neutral
- Nuance: the everyday default
- Example: They live in a big house.
- Polish: duży

### large
- Register: neutral to formal
- Nuance: slightly more formal than big
- Example: A large crowd had gathered outside.
- Polish: spory

### huge
- Register: neutral to informal
- Nuance: much bigger than expected
- Example: The sculpture was absolutely huge.
- Polish: ogromny
`

const ONE = `Collection: Thesaurus\n\n` + FILE.split('---').slice(1)[0]

async function setup(start = '2026-10-02T09:00:00.000Z') {
  const clock = { now: new Date(start) }
  const store = new MemoryStore()
  const svc = await VocabService.open(store, { clock: () => clock.now, tzOffsetMin: () => 0, deviceId: 'pc' })
  return { svc, clock, store }
}
const advance = (c: { now: Date }, ms: number) => (c.now = new Date(c.now.getTime() + ms))

describe('parseClusters', () => {
  const doc = parseClusters(FILE)

  it('reads clusters, members and every field, including wrapped values', () => {
    expect(doc.clusters.map((c) => c.title)).toEqual(['peckish / hungry / starving', 'big / large / huge'])
    const c = doc.clusters[0]
    expect(c.coreMeaning).toBe('feeling a need or desire to eat')
    expect(c.members.map((m) => m.word)).toEqual(['peckish', 'hungry', 'starving'])
    expect(c.members[0].nuance).toBe('the mildest; a slight desire for a snack, not real hunger')
    expect(c.members[2].polish).toBe('umierający z głodu')
    expect(c.collection).toBe('Thesaurus')
    expect(doc.warnings).toEqual([])
  })

  it('reads the file header as "this batch is gradients", so members run mildest to strongest', () => {
    expect(doc.clusters.every((c) => c.ordered)).toBe(true)
    expect(parseClusters(FILE.replace(/gradient/g, 'group')).clusters.every((c) => !c.ordered)).toBe(true)
  })

  it('accepts bold labels as well as plain ones, and keeps unknown member fields', () => {
    const d = parseClusters(`Collection: T\n\n## Cluster: a / b\nCore meaning: x\n\n### a\n- **Register:** neutral\n- **Nuance:** n\n- **Example:** An a here.\n- **Polish:** p\n- Collocations: strong a\n\n### b\n- Register: r\n- Nuance: n\n- Example: A b here.\n- Polish: p\n`)
    expect(d.clusters[0].members[0].register).toBe('neutral')
    expect(d.clusters[0].members[0].extra).toEqual({ Collocations: 'strong a' })
  })

  it('flags unusable clusters instead of importing them quietly', () => {
    const d = parseClusters(`Collection: T\n\n## Cluster: only\nCore meaning: x\n\n### only\n- Register: r\n- Nuance: n\n- Example: e\n- Polish: p\n`)
    expect(d.clusters[0].problems).toContain('needs at least two members')
    expect(d.warnings.some((w) => w.level === 'error')).toBe(true)
  })

  it('detects cluster files', () => {
    expect(hasClusters(FILE)).toBe(true)
    expect(hasClusters('## word\n- **POS:** noun\n')).toBe(false)
  })

  it('survives a round trip through the serializer', () => {
    const again = parseClusters(serializeClusters(doc.clusters.map((c) => ({ content: c, reviews: [] }))))
    expect(again.clusters.map((c) => [c.title, c.ordered, c.collection, c.members.map((m) => m.word)])).toEqual(
      doc.clusters.map((c) => [c.title, c.ordered, c.collection, c.members.map((m) => m.word)]),
    )
    expect(again.clusters[0].members[1].nuance).toBe(doc.clusters[0].members[1].nuance)
  })
})

describe('importing clusters', () => {
  it('adds clusters in file order, and importing again changes nothing', async () => {
    const { svc } = await setup()
    const r = await svc.importMarkdown(FILE)
    expect(r.clusters).toMatchObject({ added: 2, unchanged: 0, skippedInvalid: 0 })
    expect(svc.clusterList().map((c) => c.content.title)).toEqual(['peckish / hungry / starving', 'big / large / huge'])
    const again = await svc.importMarkdown(FILE)
    expect(again.clusters).toMatchObject({ added: 0, unchanged: 2 })
    expect(svc.clusterList()).toHaveLength(2)
  })

  it('does not touch the word dictionary, and a plain word import does not touch clusters', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    expect(svc.counts().total).toBe(0)
    const r = await svc.importMarkdown('Collection: Personal\n\n## word\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** p\n- **Tags:** t\n- **Status:** new\n')
    expect(r.added).toBe(1)
    expect(r.clusters).toBeUndefined()
    expect(svc.clusterList()).toHaveLength(2)
  })

  it('warns when a file contains nothing it recognises, instead of reporting a silent zero', async () => {
    const { svc } = await setup()
    const r = await svc.importMarkdown('# A file\n\nJust some notes.\n')
    expect(r.added).toBe(0)
    expect(r.warnings.some((w) => w.level === 'error' && /Nothing was imported/.test(w.message))).toBe(true)
  })

  it('imports a file mixing words and clusters, words first', async () => {
    const { svc } = await setup()
    const word = '## alpha\n- **POS:** noun\n- **Definition:** d\n- **Example:** e\n- **Polish:** p\n- **Tags:** t\n- **Status:** new\n'
    const r = await svc.importMarkdown('Collection: Personal\n\n' + word + '\n' + FILE)
    expect(r.added).toBe(1)
    expect(r.clusters?.added).toBe(2)
  })

  it('leaves a cluster alone when the file differs, unless asked to update', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    const changed = FILE.replace('lekko głodny', 'trochę głodny')
    expect((await svc.importMarkdown(changed)).clusters?.differing).toEqual(['peckish / hungry / starving'])
    expect(svc.clusterList()[0].content.members[0].polish).toBe('lekko głodny')
    await svc.importMarkdown(changed, { updateExisting: true })
    expect(svc.clusterList()[0].content.members[0].polish).toBe('trochę głodny')
  })

  it('does not resurrect a cluster you deleted', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    await svc.deleteCluster(svc.clusterList()[0].id)
    const r = await svc.importMarkdown(FILE)
    expect(r.clusters?.skippedDeleted).toBe(1)
    expect(svc.clusterList()).toHaveLength(1)
  })
})

describe('cluster practice and scheduling', () => {
  it('starts every cluster as new and ungated, with its own dashboard', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    expect(svc.clusterDashboard()).toMatchObject({ dueToday: 0, newCount: 2, practised: 0, total: 2, queue: [] })
    expect(svc.dashboard().dueToday).toBe(0) // the word-level number is a separate thing
  })

  it('schedules a practised cluster in days, and brings it back when due', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(FILE)
    const id = svc.clusterList()[0].id
    await svc.reviewCluster(id, 3, 3, 3)
    const after = svc.clusterList()[0]
    expect(after.status).toBe('later')
    expect(after.due!.getTime() - clock.now.getTime()).toBeGreaterThan(12 * HOUR) // not "again in ten minutes"
    expect(svc.clusterDashboard()).toMatchObject({ dueToday: 0, newCount: 1, practised: 1, doneToday: 1 })

    advance(clock, after.due!.getTime() - clock.now.getTime() + HOUR)
    expect(svc.clusterDashboard().queue).toEqual([id])
    expect(svc.clusterList()[0].status).toBe('due')
  })

  it('a hard round comes back sooner than a clean one', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    const [a, b] = svc.clusterList().map((c) => c.id)
    await svc.reviewCluster(a, 3, 3, 3)
    await svc.reviewCluster(b, 1, 1, 3)
    const due = Object.fromEntries(svc.clusterList().map((c) => [c.id, c.due!.getTime()]))
    expect(due[b]).toBeLessThan(due[a])
  })

  it('respects the daily cluster cap and never mixes with word scheduling', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(FILE)
    for (const c of svc.clusterList()) await svc.reviewCluster(c.id, 3, 3, 3)
    advance(clock, 40 * DAY)
    await svc.updateSettings({ clusterDailyCap: 1 })
    expect(svc.clusterDashboard()).toMatchObject({ dueToday: 2, remainingToday: 1 })
    expect(svc.clusterDashboard().queue).toHaveLength(1)
    expect(svc.dashboard().dueNow).toBe(0)
  })

  it('links a member to the ordinary dictionary entry for the same word, and only links', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    expect(svc.linkedEntries('hungry')).toEqual([])
    await svc.importMarkdown('Collection: Personal\n\n## hungry\n- **POS:** adjective\n- **Definition:** d\n- **Example:** e\n- **Polish:** głodny\n- **Tags:** t\n- **Status:** new\n')
    expect(svc.linkedEntries('Hungry').map((e) => e.content.collection)).toEqual(['Personal'])
    expect(svc.counts().total).toBe(1) // importing clusters never created word entries
  })
})

describe('backup, reset and clear', () => {
  it('exports clusters with their history and restores them into an empty app', async () => {
    const a = await setup()
    await a.svc.importMarkdown(FILE)
    const [c1] = a.svc.clusterList()
    await a.svc.reviewCluster(c1.id, 3, 3, 3)
    advance(a.clock, 2 * DAY)
    await a.svc.reviewCluster(c1.id, 2, 2, 3)
    const dueBefore = a.svc.clusterList()[0].due!.getTime()
    const md = a.svc.exportMarkdown()
    expect(md).toContain('## Cluster: peckish / hungry / starving')
    expect(md).toContain('Reviews: ')

    const b = await setup('2026-12-01T09:00:00.000Z')
    const r = await b.svc.importMarkdown(md)
    expect(r.clusters).toMatchObject({ added: 2, reviewsRestored: 2 })
    const [d1] = b.svc.clusterList()
    expect(d1.practised).toBe(2)
    expect(d1.due!.getTime()).toBe(dueBefore) // same history, same schedule
    expect(b.svc.exportMarkdown()).toBe(md.replace(/Exported: .*/, `Exported: ${b.clock.now.toISOString()}`))
    // Restoring the same backup again changes nothing.
    expect((await b.svc.importMarkdown(md)).clusters).toMatchObject({ added: 0, reviewsRestored: 0 })
  })

  it('reset progress wipes cluster practice too, but keeps the clusters', async () => {
    const { svc, clock } = await setup()
    await svc.importMarkdown(FILE)
    await svc.reviewCluster(svc.clusterList()[0].id, 3, 3, 3)
    advance(clock, HOUR)
    await svc.resetProgress()
    expect(svc.clusterList()).toHaveLength(2)
    expect(svc.clusterList().every((c) => c.status === 'new' && c.practised === 0)).toBe(true)
    advance(clock, HOUR)
    await svc.reviewCluster(svc.clusterList()[0].id, 3, 3, 3)
    expect(svc.clusterDashboard().practised).toBe(1)
  })

  it('clear everything removes the clusters', async () => {
    const { svc } = await setup()
    await svc.importMarkdown(FILE)
    await svc.clearEverything()
    expect(svc.clusterList()).toEqual([])
  })

  it('survives being reopened from storage', async () => {
    const { svc, store, clock } = await setup()
    await svc.importMarkdown(FILE)
    await svc.reviewCluster(svc.clusterList()[0].id, 3, 3, 3)
    const again = await VocabService.open(store, { clock: () => clock.now, tzOffsetMin: () => 0, deviceId: 'pc' })
    expect(again.clusterList().map((c) => [c.content.title, c.practised])).toEqual([['peckish / hungry / starving', 1], ['big / large / huge', 0]])
  })
})

const CONTENT_DIR = process.env.VOCAB_CONTENT_DIR ?? path.resolve(process.cwd(), 'content')
const THESAURUS = path.join(CONTENT_DIR, 'thesaurus_intensity_batch1.md')
describe.skipIf(!fs.existsSync(THESAURUS))('the real thesaurus file', () => {
  const text = fs.existsSync(THESAURUS) ? fs.readFileSync(THESAURUS, 'utf8') : ''

  it('imports all 10 clusters of 5 members, as gradients, with no warnings', () => {
    const d = parseClusters(text)
    expect(d.warnings).toEqual([])
    expect(d.clusters).toHaveLength(10)
    expect(d.clusters.every((c) => c.members.length === 5 && c.ordered && c.problems.length === 0)).toBe(true)
  })

  it('keeps the member order, not the title order, as the scale ("peckish" before "hungry")', () => {
    const c = parseClusters(text).clusters.find((x) => x.title.startsWith('hungry'))!
    expect(c.members.map((m) => m.word)).toEqual(['peckish', 'hungry', 'starving', 'famished', 'ravenous'])
  })

  it('round-trips through export and re-import', async () => {
    const a = await setup()
    await a.svc.importMarkdown(text)
    const md = a.svc.exportMarkdown()
    const b = await setup()
    const r = await b.svc.importMarkdown(md)
    expect(r.warnings).toEqual([])
    expect(r.clusters?.added).toBe(10)
    expect(b.svc.clusterList().map((c) => c.content)).toEqual(a.svc.clusterList().map((c) => c.content))
  })
})

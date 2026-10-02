import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClusters, type ClusterContent } from '../core/clusters'
import { blankedExample, ladderScore, makeCloze, makeDuel, makeLadder, makeRound, ratingForRound } from './thesaurus'

const member = (word: string, example = `It was ${word} indeed.`) => ({ word, register: 'neutral', nuance: `about ${word}`, example, polish: word, extra: {} })
const cluster = (ordered: boolean, words = ['mild', 'warm', 'hot', 'scalding', 'molten']): ClusterContent => ({
  title: words.join(' / '), coreMeaning: 'heat', ordered, collection: 'Thesaurus', members: words.map((w) => member(w)),
})

/** A deterministic random source. */
const seeded = (seed: number) => () => ((seed = (seed * 48271) % 2147483647) / 2147483647)

describe('Best-Fit Cloze', () => {
  it('blanks the member\'s own example, and the right answer is always on offer', () => {
    const c = cluster(true)
    for (let i = 0; i < 5; i++) {
      const q = makeCloze(c, i, seeded(i + 1))!
      expect(q.sentence).toContain('_____')
      expect(q.sentence).not.toContain(c.members[i].word)
      expect(q.options).toContain(i)
      expect(q.answer).toBe(i)
    }
  })

  it('offers the nearest neighbours on the scale as the wrong options, mildest to strongest', () => {
    const c = cluster(true)
    expect(makeCloze(c, 0, seeded(3))!.options).toEqual([0, 1, 2, 3])
    expect(makeCloze(c, 4, seeded(3))!.options).toEqual([1, 2, 3, 4])
    const mid = makeCloze(c, 2, seeded(3))!.options
    expect(mid).toContain(1)
    expect(mid).toContain(3)
    expect([...mid]).toEqual([...mid].sort((a, b) => a - b))
  })

  it('shuffles the options for a cluster that is not a gradient, and uses every member of a small one', () => {
    const q = makeCloze(cluster(false, ['a1', 'b2', 'c3']), 1, seeded(9))!
    expect([...q.options].sort()).toEqual([0, 1, 2])
  })

  it('skips a member whose own example does not contain it', () => {
    const c = cluster(true)
    c.members[2] = member('hot', 'Nothing relevant here.')
    expect(makeCloze(c, 2)).toBeNull()
    expect(blankedExample(c, 2)).toBeNull()
    expect(makeRound(c, seeded(1))).toHaveLength(4)
  })

  it('a round asks about every member exactly once, in a shuffled order', () => {
    const c = cluster(true)
    const answers = makeRound(c, seeded(5)).map((q) => q.answer)
    expect([...answers].sort()).toEqual([0, 1, 2, 3, 4])
  })
})

describe('rating a round', () => {
  it('no misses is Good, one miss Hard, more than one Again', () => {
    expect(ratingForRound(5, 5)).toBe(3)
    expect(ratingForRound(4, 5)).toBe(2)
    expect(ratingForRound(3, 5)).toBe(1)
    expect(ratingForRound(0, 5)).toBe(1)
  })
})

describe('Nuance Duel', () => {
  it('offers the right word and one other, on random sides, with how close they are', () => {
    const cs = [cluster(true), cluster(true, ['cold', 'cool', 'chilly', 'freezing'])]
    const sides = new Set<string>()
    for (let s = 1; s < 60; s++) {
      const q = makeDuel(cs, seeded(s))!
      expect([q.left, q.right].sort()).toEqual([q.answer, q.other].sort())
      expect(q.answer).not.toBe(q.other)
      expect(q.distance).toBe(Math.abs(q.answer - q.other))
      expect(q.sentence).toContain('_____')
      sides.add(q.left === q.answer ? 'left' : 'right')
    }
    expect(sides).toEqual(new Set(['left', 'right']))
  })

  it('often picks the neighbouring word, which is the harder call', () => {
    const c = cluster(true, ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'])
    const near = Array.from({ length: 200 }, (_, s) => makeDuel([c], seeded(s + 1))!).filter((q) => q.distance === 1).length
    expect(near).toBeGreaterThan(80)
  })

  it('gives nothing when no cluster has an example it can use', () => {
    const c = cluster(true, ['x1', 'y2'])
    c.members.forEach((m) => (m.example = 'Nothing here.'))
    expect(makeDuel([c])).toBeNull()
    expect(makeDuel([])).toBeNull()
  })
})

describe('Intensity Ladder', () => {
  it('starts shuffled, never already solved, and scores rungs placed correctly', () => {
    const c = cluster(true)
    for (let s = 1; s < 40; s++) {
      const order = makeLadder(c, seeded(s))
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4])
      expect(ladderScore(order)).toBeLessThan(5)
    }
    expect(ladderScore([0, 1, 2, 3, 4])).toBe(5)
    expect(ladderScore([1, 0, 2, 3, 4])).toBe(3)
  })
})

const CONTENT_DIR = process.env.VOCAB_CONTENT_DIR ?? path.resolve(process.cwd(), 'content')
const FILE = path.join(CONTENT_DIR, 'thesaurus_intensity_batch1.md')
describe.skipIf(!fs.existsSync(FILE))('against the real thesaurus file', () => {
  const clusters = fs.existsSync(FILE) ? parseClusters(fs.readFileSync(FILE, 'utf8')).clusters : []

  it('every member makes a Cloze question, and every cluster a full round and a ladder', () => {
    expect(clusters).toHaveLength(10)
    for (const c of clusters) {
      expect(makeRound(c, seeded(7))).toHaveLength(5)
      expect(makeLadder(c, seeded(7))).toHaveLength(5)
      for (let i = 0; i < 5; i++) expect(makeCloze(c, i, seeded(i + 1))!.options).toHaveLength(4)
    }
  })

  it('can always produce a Duel question', () => {
    for (let s = 1; s < 100; s++) expect(makeDuel(clusters, seeded(s))).not.toBeNull()
  })
})

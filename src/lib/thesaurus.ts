import type { ClusterContent } from '../core/clusters'
import { blankOut } from './exercises'

type Rng = () => number

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A member's own example with the word blanked, or null if the word can't be found in it. */
export function blankedExample(cluster: ClusterContent, memberIndex: number): string | null {
  const m = cluster.members[memberIndex]
  return m ? blankOut(m.example, m.word) : null
}

export interface ClozeQuestion {
  /** The member whose example this is: the right answer. */
  answer: number
  sentence: string
  /** Member indices on offer, in display order. */
  options: number[]
}

/**
 * Best-Fit Cloze: a sentence with a blank and 3-4 members of the cluster to choose from. The
 * wrong options are the members nearest on the scale, the ones easiest to confuse with it.
 * In a gradient the options are shown mildest to strongest; otherwise in random order.
 */
export function makeCloze(cluster: ClusterContent, memberIndex: number, rng: Rng = Math.random): ClozeQuestion | null {
  const sentence = blankedExample(cluster, memberIndex)
  if (!sentence) return null
  const others = cluster.members
    .map((_, i) => i)
    .filter((i) => i !== memberIndex)
    .map((i) => ({ i, key: Math.abs(i - memberIndex) + rng() * 0.4 }))
    .sort((a, b) => a.key - b.key)
    .slice(0, 3)
    .map((o) => o.i)
  const picked = [memberIndex, ...others]
  const options = cluster.ordered ? picked.sort((a, b) => a - b) : shuffle(picked, rng)
  return { answer: memberIndex, sentence, options }
}

/** One practice round: a question per member, in random order (members that can't be blanked are skipped). */
export function makeRound(cluster: ClusterContent, rng: Rng = Math.random): ClozeQuestion[] {
  return shuffle(
    cluster.members.map((_, i) => makeCloze(cluster, i, rng)).filter((q): q is ClozeQuestion => q !== null),
    rng,
  )
}

/** How a finished round is rated for the cluster's own schedule: no misses Good, one Hard, more Again. */
export function ratingForRound(correct: number, total: number): 1 | 2 | 3 {
  const misses = total - correct
  return misses <= 0 ? 3 : misses === 1 ? 2 : 1
}

export interface DuelQuestion {
  clusterIndex: number
  answer: number
  other: number
  sentence: string
  /** Member indices on the left and right. */
  left: number
  right: number
  /** How far apart the two candidates are on the scale: 1 is the hardest call. */
  distance: number
}

/** Nuance Duel: a sentence and two candidates; swipe to the better fit. Neighbours make it harder. */
export function makeDuel(clusters: ClusterContent[], rng: Rng = Math.random): DuelQuestion | null {
  const usable = clusters.map((c, i) => ({ c, i })).filter(({ c }) => c.members.length >= 2)
  for (let attempt = 0; attempt < 20 && usable.length; attempt++) {
    const { c, i } = usable[Math.floor(rng() * usable.length)]
    const answer = Math.floor(rng() * c.members.length)
    const sentence = blankedExample(c, answer)
    if (!sentence) continue
    const neighbours = [answer - 1, answer + 1].filter((n) => n >= 0 && n < c.members.length)
    const all = c.members.map((_, k) => k).filter((k) => k !== answer)
    const other = rng() < 0.6 && neighbours.length ? neighbours[Math.floor(rng() * neighbours.length)] : all[Math.floor(rng() * all.length)]
    const answerLeft = rng() < 0.5
    return {
      clusterIndex: i,
      answer,
      other,
      sentence,
      left: answerLeft ? answer : other,
      right: answerLeft ? other : answer,
      distance: Math.abs(answer - other),
    }
  }
  return null
}

/** Intensity Ladder: the members in a shuffled order that is not already correct. */
export function makeLadder(cluster: ClusterContent, rng: Rng = Math.random): number[] {
  const identity = cluster.members.map((_, i) => i)
  if (identity.length < 3) return identity.reverse()
  let order = shuffle(identity, rng)
  for (let tries = 0; tries < 10 && order.every((v, i) => v === i); tries++) order = shuffle(identity, rng)
  return order
}

/** How many members were placed on exactly the right rung. */
export function ladderScore(order: number[]): number {
  return order.filter((v, i) => v === i).length
}

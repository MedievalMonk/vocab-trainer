import { describe, expect, it } from 'vitest'
import type { EntryState } from '../core/events'
import { blankOut, gradeTyped, headword, isPhrase, makeExercise } from './exercises'

const entry = (id: string, word: string, o: Partial<EntryState['content']> = {}): EntryState => ({
  id,
  status: 'new',
  dateAdded: '2026-10-01',
  deleted: false,
  reviews: [],
  seq: 0,
  content: {
    word, pos: 'noun', definition: `definition of ${word}`, example: `A sentence with ${word} in it.`,
    polish: `pl-${word}`, tags: [], collection: 'C', extra: {}, ...o,
  },
})

describe('blankOut', () => {
  it('blanks the word and common inflections', () => {
    expect(blankOut('Every atom has protons.', 'proton')).toBe('Every atom has _____.')
    expect(blankOut('The acid was titrated slowly.', 'titrate')).toBe('The acid was _____ slowly.')
    expect(blankOut('Protons are positive.', 'proton')).toBe('_____ are positive.')
  })
  it('blanks phrases only when they appear verbatim, and never part of another word', () => {
    expect(blankOut('She decided to bite the bullet.', 'bite the bullet')).toBe('She decided to _____.')
    expect(blankOut('She bit the bullet.', 'bite the bullet')).toBeNull()
    expect(blankOut('The tangent line is shown.', 'tan')).toBeNull()
  })
  it('ignores a disambiguating qualifier', () => {
    expect(blankOut('A current of two amperes flowed.', 'current (electric)')).toBe('A _____ of two amperes flowed.')
  })
})

describe('gradeTyped', () => {
  it('accepts exact answers regardless of case, spacing and a leading "to"', () => {
    expect(gradeTyped('  Proton ', 'proton')).toBe('exact')
    expect(gradeTyped('abide by', 'to abide by')).toBe('exact')
    expect(gradeTyped('current', 'current (electric)')).toBe('exact')
  })
  it('gives near misses a softer verdict only for longer words', () => {
    expect(gradeTyped('titraton', 'titration')).toBe('close')
    expect(gradeTyped('cat', 'cut')).toBe('wrong')
    expect(gradeTyped('', 'proton')).toBe('wrong')
  })
})

describe('makeExercise', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((w, i) => entry(`id${i}`, w))
  const target = pool[0]
  const rngs = [0.05, 0.3, 0.55, 0.8, 0.99]

  it('multiple choice has the right answer among distinct options', () => {
    for (const r of rngs) {
      const ex = makeExercise(target, 'choice', pool, () => r)
      expect(ex.kind).toBe('choice')
      expect(ex.options!.length).toBeGreaterThanOrEqual(3)
      expect(new Set(ex.options).size).toBe(ex.options!.length)
      expect(ex.options![ex.correct!]).toBe(ex.answer)
    }
  })
  it('falls back instead of showing an impossible exercise', () => {
    expect(makeExercise(entry('x', 'word', { example: 'No match here.' }), 'blank', pool).kind).toBe('recall')
    expect(makeExercise(target, 'choice', [target]).kind).toBe('flashcard')
  })
  it('recall prompts with the definition or the Polish and expects the English word', () => {
    const ex = makeExercise(target, 'recall', pool, () => 0.1)
    expect(ex.answer).toBe('a')
    expect([target.content.definition, target.content.polish]).toContain(ex.prompt)
  })
  it('flashcards are asked in both directions', () => {
    const dirs = new Set(rngs.map((r) => makeExercise(target, 'flashcard', pool, () => r).direction))
    expect(dirs).toEqual(new Set(['en2pl', 'pl2en']))
  })
})

describe('isPhrase / headword', () => {
  it('detects idioms by part of speech, collection or idiom-only fields', () => {
    expect(isPhrase(entry('1', 'x', { pos: 'idiom' }).content)).toBe(true)
    expect(isPhrase(entry('1', 'x', { collection: 'Idioms' }).content)).toBe(true)
    expect(isPhrase(entry('1', 'x', { register: 'informal' }).content)).toBe(true)
    expect(isPhrase(entry('1', 'x').content)).toBe(false)
    expect(headword('range (statistics)')).toBe('range')
  })
})

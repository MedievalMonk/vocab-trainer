import type { EntryState } from '../core/events'

export type ExerciseKind = 'flashcard' | 'choice' | 'recall' | 'blank'
export const EXERCISE_KINDS: ExerciseKind[] = ['flashcard', 'choice', 'recall', 'blank']
export const KIND_LABEL: Record<ExerciseKind, string> = {
  flashcard: 'Flashcards',
  choice: 'Multiple choice',
  recall: 'Reverse recall',
  blank: 'Fill in the blank',
}

/** "current (electric)" -> "current": the qualifier disambiguates, it is not part of the word. */
export const headword = (w: string) => w.replace(/\s*\(.*?\)/g, '').trim()

/** Idioms and phrases get the wider, distinct card. */
export function isPhrase(e: EntryState['content']): boolean {
  return /idiom|phrase|expression|proverb/i.test(e.pos) || /^idioms\b/i.test(e.collection) || !!e.register || !!e.similarExpressions
}

export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

export type Verdict = 'exact' | 'close' | 'wrong'

/** Typed answers: exact, or a near miss (one slip in a longer word) that still earns Hard. */
export function gradeTyped(typed: string, word: string): Verdict {
  const t = normalizeAnswer(typed)
  const w = normalizeAnswer(headword(word))
  if (!t) return 'wrong'
  const strip = (s: string) => s.replace(/^to /, '')
  if (t === w || strip(t) === strip(w)) return 'exact'
  const limit = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0
  return limit > 0 && editDistance(strip(t), strip(w)) <= limit ? 'close' : 'wrong'
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The example sentence with the word replaced by a blank, allowing common inflections
 * ("protons", "titrated"). Returns null when the word can't be found, so the caller
 * can pick another exercise instead of showing a sentence with nothing to fill in.
 */
export function blankOut(example: string, word: string): string | null {
  const w = headword(word)
  if (!w) return null
  const patterns: string[] = []
  if (w.includes(' ')) {
    patterns.push(esc(w))
  } else if (w.length <= 4) {
    patterns.push(`${esc(w)}(?:s|es|ed|d|ing)?`)
  } else {
    const stem = w.replace(/(?:ies|ing|ed|es|e|y|s)$/i, '')
    patterns.push(`${esc(w)}\\p{L}{0,3}`, `${esc(stem.length >= 4 ? stem : w)}\\p{L}{0,4}`)
  }
  for (const p of patterns) {
    const re = new RegExp(`(?<![\\p{L}])${p}(?![\\p{L}])`, 'iu')
    if (re.test(example)) return example.replace(re, '_____')
  }
  return null
}

export type ChoiceVariant = 'word-def' | 'def-word' | 'word-pl' | 'pl-word'

export interface Exercise {
  entryId: string
  kind: ExerciseKind
  /** Small caption above the prompt. */
  label: string
  prompt: string
  /** Flashcards: which way the card is asked. EN->PL shows the word first. */
  direction?: 'en2pl' | 'pl2en'
  options?: string[]
  correct?: number
  /** What a typed or chosen answer should be. */
  answer: string
}

type Rng = () => number
const pick = <T>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)]

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function distractors(entry: EntryState, pool: EntryState[], text: (e: EntryState) => string, correct: string, rng: Rng): string[] {
  const seen = new Set([correct.toLowerCase()])
  const candidates = shuffle(
    pool.filter((e) => e.id !== entry.id && !e.deleted),
    rng,
  ).sort((a, b) => {
    // Prefer the same part of speech, then the same collection, so options are plausible.
    const score = (e: EntryState) => (e.content.pos === entry.content.pos ? 2 : 0) + (e.content.collection === entry.content.collection ? 1 : 0)
    return score(b) - score(a)
  })
  const out: string[] = []
  for (const c of candidates) {
    const t = text(c)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === 3) break
  }
  return out
}

/**
 * Builds one exercise for an entry. `pool` supplies multiple-choice distractors.
 * Falls back (blank -> recall, choice -> flashcard) when the data can't support the kind.
 */
export function makeExercise(entry: EntryState, kind: ExerciseKind, pool: EntryState[], rng: Rng = Math.random): Exercise {
  const c = entry.content
  const word = headword(c.word)
  const base = { entryId: entry.id }

  if (kind === 'blank') {
    const sentence = blankOut(c.example, c.word)
    if (sentence) return { ...base, kind, label: 'Complete the sentence', prompt: sentence, answer: word }
    kind = 'recall'
  }
  if (kind === 'choice') {
    const variant = pick<ChoiceVariant>(['word-def', 'def-word', 'word-pl', 'pl-word'], rng)
    const get: Record<ChoiceVariant, [string, string, (e: EntryState) => string, (e: EntryState) => string]> = {
      'word-def': ['Word', 'Which definition fits?', (e) => e.content.definition, (e) => headword(e.content.word)],
      'def-word': ['Definition', 'Which word is this?', (e) => headword(e.content.word), (e) => e.content.definition],
      'word-pl': ['Word', 'Which Polish translation fits?', (e) => e.content.polish, (e) => headword(e.content.word)],
      'pl-word': ['Polish', 'Which English word is this?', (e) => headword(e.content.word), (e) => e.content.polish],
    }
    const [, label, answerOf, promptOf] = get[variant]
    const answer = answerOf(entry)
    const wrong = distractors(entry, pool, answerOf, answer, rng)
    if (wrong.length >= 2) {
      const options = shuffle([answer, ...wrong], rng)
      return { ...base, kind, label, prompt: promptOf(entry), options, correct: options.indexOf(answer), answer }
    }
    kind = 'flashcard'
  }
  if (kind === 'recall') {
    const fromPolish = rng() < 0.4
    return {
      ...base,
      kind,
      label: fromPolish ? 'Polish. Type the English word' : 'Definition. Type the word',
      prompt: fromPolish ? c.polish : c.definition,
      answer: word,
    }
  }
  const direction = rng() < 0.5 ? 'en2pl' : 'pl2en'
  return {
    ...base,
    kind: 'flashcard',
    direction,
    label: direction === 'en2pl' ? 'Word' : 'Polish',
    prompt: direction === 'en2pl' ? word : c.polish,
    answer: word,
  }
}

export interface Settings {
  /** Max graded reviews per day. The Repetitions queue never exceeds what is left of it. */
  dailyCap: number
  /** Words per study batch. Smaller only if fewer are eligible. */
  batchSize: number
  /** FSRS target recall probability. */
  requestRetention: number
  /** How long after the teach-first pass a word becomes eligible for its first quiz. */
  firstReviewDelayMin: number
  /** A word is auto-marked `known` once its FSRS stability reaches this many days. */
  knownStabilityDays: number
}

export const DEFAULT_SETTINGS: Settings = {
  dailyCap: 50,
  batchSize: 20,
  requestRetention: 0.9,
  firstReviewDelayMin: 10,
  knownStabilityDays: 21,
}

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...stored }
}

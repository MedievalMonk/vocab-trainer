/** Version of the Markdown block format and the event-log schema. Bump with a migration. */
export const FORMAT_VERSION = 1

export type Status = 'new' | 'learning' | 'known'
export const STATUSES: readonly Status[] = ['new', 'learning', 'known']

/** FSRS ratings: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4

/** What the user authors. Everything else about an entry is app-managed. */
export interface EntryContent {
  word: string
  pos: string
  definition: string
  example: string
  polish: string
  tags: string[]
  /** e.g. "School Subjects > Chemistry". Hierarchy is written with " > ". */
  collection: string
  /** Optional sub-heading inside a source file ("## Atomic Structure"). */
  section?: string
  /** Idioms/phrases only. */
  register?: string
  similarExpressions?: string
  /** Fields this version of the app doesn't know. Kept and written back on export. */
  extra: Record<string, string>
}

export interface ReviewMark {
  /** ISO timestamp (UTC, millisecond precision). */
  ts: string
  rating: Rating
}

export interface ParseWarning {
  line: number
  level: 'warn' | 'error'
  message: string
}

/** One block of a Markdown file, as parsed. State fields are present only in app exports. */
export interface ParsedEntry extends EntryContent {
  status?: Status
  dateAdded?: string
  firstSeen?: string
  reviews: ReviewMark[]
  /** Non-empty means the entry is unusable (missing required field). */
  problems: string[]
  line: number
}

export interface ParsedDocument {
  entries: ParsedEntry[]
  warnings: ParseWarning[]
  collections: string[]
  formatVersion?: number
}

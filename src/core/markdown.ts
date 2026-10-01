import { normalizeCollection, normalizeTs } from './identity'
import {
  FORMAT_VERSION,
  STATUSES,
  type EntryContent,
  type ParsedDocument,
  type ParsedEntry,
  type ParseWarning,
  type Rating,
  type ReviewMark,
  type Status,
} from './types'

const FIELD_RE = /^-\s+\*\*(.+?):\*\*\s*(.*)$/
const COLLECTION_RE = /^Collection:\s*(.+)$/i
const META_RE = /^(Format-Version|Format|Note|Exported|Source):\s*(.*)$/i
const H2_RE = /^##\s+(.+?)\s*$/
const REQUIRED = ['pos', 'definition', 'example', 'polish'] as const
const KNOWN_FIELDS = new Set([
  'pos', 'definition', 'example', 'polish', 'tags', 'status', 'register',
  'similar expressions', 'similar_expressions', 'date added', 'first seen', 'fsrs', 'reviews',
])

type WarnFn = (line: number, level: ParseWarning['level'], message: string) => void

interface RawBlock {
  heading: string
  line: number
  fields: { label: string; value: string; line: number }[]
}

export interface ParseOptions {
  /** Used when the text has no `Collection:` line (bulk paste, quick-add). */
  defaultCollection?: string
}

/**
 * Parses the block format used by the source files and by app exports.
 *
 *   Collection: School Subjects > Chemistry
 *   ## Atomic Structure          <- no bullets under it: a section heading
 *   ## atom                      <- bullets under it: an entry
 *   - **POS:** noun
 *
 * Several `Collection:` lines may appear in one text. Never throws: problems are
 * returned as warnings, and unusable entries carry a non-empty `problems` list.
 */
export function parseMarkdown(text: string, opts: ParseOptions = {}): ParsedDocument {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const doc: ParsedDocument = { entries: [], warnings: [], collections: [] }
  let collection = opts.defaultCollection ? normalizeCollection(opts.defaultCollection) : ''
  let section: string | undefined
  let current: RawBlock | null = null

  const warn: WarnFn = (line, level, message) => doc.warnings.push({ line, level, message })

  const flush = () => {
    if (!current) return
    const block: RawBlock = current
    current = null
    if (block.fields.length === 0) {
      section = block.heading
      return
    }
    doc.entries.push(buildEntry(block, collection, section, warn))
    if (collection && !doc.collections.includes(collection)) doc.collections.push(collection)
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].trimEnd()

    const h2 = H2_RE.exec(line)
    if (h2 && !line.startsWith('###')) {
      flush()
      current = { heading: h2[1], line: lineNo, fields: [] }
      continue
    }
    const field = FIELD_RE.exec(line)
    if (field) {
      if (current) current.fields.push({ label: field[1].trim(), value: field[2].trim(), line: lineNo })
      else warn(lineNo, 'warn', 'Field outside any entry; ignored')
      continue
    }
    const coll = COLLECTION_RE.exec(line)
    if (coll) {
      flush()
      collection = normalizeCollection(coll[1])
      section = undefined
      continue
    }
    const meta = META_RE.exec(line)
    if (meta && !current) {
      if (meta[1].toLowerCase() === 'format-version') {
        const n = Number(meta[2])
        if (Number.isFinite(n)) doc.formatVersion = n
      }
      continue
    }
    // Wrapped value: plain text under a field continues that field.
    if (current && current.fields.length > 0 && line.trim() && !line.startsWith('#') && line.trim() !== '---') {
      const last = current.fields[current.fields.length - 1]
      last.value = (last.value + ' ' + line.trim()).trim()
    }
  }
  flush()

  if (doc.formatVersion !== undefined && doc.formatVersion > FORMAT_VERSION) {
    warn(1, 'warn', `File uses format version ${doc.formatVersion}; this app understands ${FORMAT_VERSION}. Unknown fields are kept.`)
  }
  return doc
}

function buildEntry(block: RawBlock, collection: string, section: string | undefined, warn: WarnFn): ParsedEntry {
  const f: Record<string, string> = {}
  const extra: Record<string, string> = {}
  for (const { label, value, line } of block.fields) {
    const k = label.toLowerCase()
    if (KNOWN_FIELDS.has(k)) {
      const key = k === 'similar_expressions' ? 'similar expressions' : k
      if (key in f) warn(line, 'warn', `Duplicate field "${label}" in "${block.heading}"; last one wins`)
      f[key] = value
    } else {
      extra[label] = value
    }
  }

  const problems: string[] = []
  const word = block.heading.trim()
  for (const r of REQUIRED) if (!f[r]) problems.push(`missing ${r}`)
  if (!collection) problems.push('no Collection header')

  let status: Status | undefined
  if (f.status) {
    const s = f.status.toLowerCase() as Status
    if (STATUSES.includes(s)) status = s
    else warn(block.line, 'warn', `Unknown status "${f.status}" for "${word}"; treated as new`)
  }

  let dateAdded: string | undefined
  if (f['date added']) {
    if (/^\d{4}-\d{2}-\d{2}/.test(f['date added'])) dateAdded = f['date added'].slice(0, 10)
    else warn(block.line, 'warn', `Bad date added "${f['date added']}" for "${word}"`)
  }
  const firstSeen = f['first seen'] ? (normalizeTs(f['first seen']) ?? undefined) : undefined

  const reviews: ReviewMark[] = []
  if (f.reviews) {
    for (const part of f.reviews.split(',')) {
      const m = /^\s*(\S+?)=([1-4])\s*$/.exec(part)
      const ts = m ? normalizeTs(m[1]) : null
      if (m && ts) reviews.push({ ts, rating: Number(m[2]) as Rating })
      else if (part.trim()) warn(block.line, 'warn', `Bad review entry "${part.trim()}" for "${word}"`)
    }
  }

  const entry: ParsedEntry = {
    word,
    pos: f.pos ?? '',
    definition: f.definition ?? '',
    example: f.example ?? '',
    polish: f.polish ?? '',
    tags: (f.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    collection,
    extra,
    status,
    dateAdded,
    firstSeen,
    reviews,
    problems,
    line: block.line,
  }
  if (section) entry.section = section
  if (f.register) entry.register = f.register
  if (f['similar expressions']) entry.similarExpressions = f['similar expressions']
  if (problems.length) warn(block.line, 'error', `"${word}": ${problems.join(', ')}`)
  return entry
}

/** One exported row: authored content plus the app-managed state worth writing out. */
export interface ExportRow {
  content: EntryContent
  status: Status
  dateAdded: string
  firstSeen?: string
  /** Informational FSRS summary. Ignored on import: state is recomputed from the reviews. */
  fsrs?: string
  reviews: ReviewMark[]
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** Rows must already be ordered (by collection, then entry order). */
export function serializeMarkdown(rows: ExportRow[], meta: { exportedAt?: string } = {}): string {
  const out: string[] = ['# Vocabulary export', `Format-Version: ${FORMAT_VERSION}`]
  if (meta.exportedAt) out.push(`Exported: ${meta.exportedAt}`)
  out.push('')

  let collection: string | null = null
  let section: string | undefined
  for (const row of rows) {
    const c = row.content
    if (c.collection !== collection) {
      collection = c.collection
      section = undefined
      out.push('---', '', `Collection: ${collection}`, '')
    }
    if (c.section !== section) {
      section = c.section
      if (section) out.push(`## ${oneLine(section)}`, '')
    }
    out.push(`## ${oneLine(c.word)}`)
    const field = (label: string, value: string | undefined) => {
      if (value) out.push(`- **${label}:** ${oneLine(value)}`)
    }
    field('POS', c.pos)
    field('Definition', c.definition)
    field('Example', c.example)
    field('Polish', c.polish)
    field('Register', c.register)
    field('Similar expressions', c.similarExpressions)
    field('Tags', c.tags.join(', '))
    field('Status', row.status)
    field('Date added', row.dateAdded)
    field('First seen', row.firstSeen)
    field('FSRS', row.fsrs)
    field('Reviews', row.reviews.map((r) => `${r.ts}=${r.rating}`).join(', '))
    for (const [label, value] of Object.entries(c.extra)) field(label, value)
    out.push('')
  }
  return out.join('\n')
}

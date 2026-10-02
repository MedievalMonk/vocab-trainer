import { normalizeCollection, normalizeTs } from './identity'
import type { ParseWarning, Rating, ReviewMark } from './types'

/**
 * Synonym clusters (The Thesaurus): 3-6 near-synonyms sharing a core meaning, each with the
 * register, nuance, an example where it is the natural choice, and a Polish translation.
 * The reviewable unit is the cluster ("can I tell these apart?"), not the single word.
 */
export interface ClusterMember {
  word: string
  register: string
  nuance: string
  example: string
  polish: string
  /** Fields this version doesn't know (e.g. a future `Collocations:`). Kept and written back. */
  extra: Record<string, string>
}

export interface ClusterContent {
  title: string
  coreMeaning: string
  members: ClusterMember[]
  /** Members run from mildest to strongest, in file order (an intensity gradient). */
  ordered: boolean
  /** Batch label from the file's `Collection:` line, e.g. "Thesaurus". */
  collection: string
}

export interface ParsedCluster extends ClusterContent {
  firstSeen?: string
  reviews: ClusterReviewMark[]
  /** Non-empty means the cluster is unusable. */
  problems: string[]
  line: number
}

export interface ClusterReviewMark extends ReviewMark {
  rating: Rating
}

export interface ParsedClusters {
  clusters: ParsedCluster[]
  warnings: ParseWarning[]
}

const CLUSTER_RE = /^## Cluster:\s*(.+?)\s*$/
const COLLECTION_RE = /^Collection:\s*(.+)$/i
const BULLET_RE = /^-\s+(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?:\*\*)?:(?:\*\*)?\s*(.*)$/
const MEMBER_FIELDS = new Set(['register', 'nuance', 'example', 'polish'])

/** True when the text contains synonym-cluster blocks. */
export const hasClusters = (text: string) => /^## Cluster:/m.test(text)

/** The part of a file before its first cluster: word blocks, if any, and file headers. */
export function beforeClusters(text: string): string {
  const m = /^## Cluster:/m.exec(text)
  return m ? text.slice(0, m.index) : text
}

/**
 * Parses cluster blocks. Both `- Register: ...` and `- **Register:** ...` are accepted, and a
 * value may wrap onto following lines. A file whose header says its clusters are "gradients"
 * (or a cluster with `Scale: gradient`) is read as ordered, mildest to strongest.
 */
export function parseClusters(text: string): ParsedClusters {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out: ParsedClusters = { clusters: [], warnings: [] }
  const warn = (line: number, level: ParseWarning['level'], message: string) => out.warnings.push({ line, level, message })

  let collection = ''
  let headerOrdered = false
  let header: string[] = []
  let inHeader = false

  type Draft = { title: string; line: number; core: string; scale?: string; first?: string; reviews: string; extra: Record<string, string>; members: DraftMember[] }
  type DraftMember = { word: string; line: number; fields: Record<string, string>; last: string | null }
  let draft: Draft | null = null
  let member: DraftMember | null = null
  let lastCluster: 'core' | 'reviews' | null = null

  const finish = () => {
    if (!draft) return
    const d = draft
    draft = null
    member = null
    out.clusters.push(buildCluster(d, collection, headerOrdered, warn))
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].trimEnd()

    const c = CLUSTER_RE.exec(line)
    if (c) {
      finish()
      if (inHeader) {
        headerOrdered = /gradient/i.test(header.join(' '))
        inHeader = false
      }
      draft = { title: c[1], line: lineNo, core: '', reviews: '', extra: {}, members: [] }
      lastCluster = null
      continue
    }
    const coll = COLLECTION_RE.exec(line)
    if (coll && !draft?.members.length) {
      finish()
      collection = normalizeCollection(coll[1])
      header = []
      inHeader = true
      headerOrdered = false
      continue
    }
    if (inHeader && !draft) {
      if (line.trim() === '---') inHeader = false
      else header.push(line)
      if (!inHeader) headerOrdered = /gradient/i.test(header.join(' '))
      continue
    }
    if (!draft) continue
    const d: Draft = draft

    const h3 = /^###\s+(.+?)\s*$/.exec(line)
    if (h3) {
      member = { word: h3[1], line: lineNo, fields: {}, last: null }
      d.members.push(member)
      continue
    }
    if (line.trim() === '---') {
      finish()
      continue
    }
    if (!line.trim()) continue

    if (!member) {
      // Cluster-level lines: Core meaning / Scale / First seen / Reviews.
      const m = /^(Core meaning|Scale|First seen|Reviews):\s*(.*)$/i.exec(line)
      if (m) {
        const k = m[1].toLowerCase()
        if (k === 'core meaning') (d.core = m[2].trim()), (lastCluster = 'core')
        else if (k === 'scale') d.scale = m[2].trim().toLowerCase()
        else if (k === 'first seen') d.first = m[2].trim()
        else (d.reviews = m[2].trim()), (lastCluster = 'reviews')
      } else if (lastCluster === 'core') d.core = (d.core + ' ' + line.trim()).trim()
      else if (lastCluster === 'reviews') d.reviews = (d.reviews + ' ' + line.trim()).trim()
      continue
    }

    const b = BULLET_RE.exec(line)
    if (b) {
      const label = b[1].trim()
      member.fields[label] = b[2].trim()
      member.last = label
    } else if (member.last) {
      member.fields[member.last] = (member.fields[member.last] + ' ' + line.trim()).trim()
    }
  }
  finish()
  return out
}

function buildCluster(
  d: { title: string; line: number; core: string; scale?: string; first?: string; reviews: string; extra: Record<string, string>; members: { word: string; line: number; fields: Record<string, string> }[] },
  collection: string,
  headerOrdered: boolean,
  warn: (line: number, level: ParseWarning['level'], message: string) => void,
): ParsedCluster {
  const problems: string[] = []
  const members: ClusterMember[] = d.members.map((m) => {
    const get = (label: string) => Object.entries(m.fields).find(([k]) => k.toLowerCase() === label)?.[1] ?? ''
    const extra: Record<string, string> = {}
    for (const [k, v] of Object.entries(m.fields)) if (!MEMBER_FIELDS.has(k.toLowerCase())) extra[k] = v
    const member: ClusterMember = { word: m.word.trim(), register: get('register'), nuance: get('nuance'), example: get('example'), polish: get('polish'), extra }
    if (!member.example) problems.push(`"${member.word}" has no example`)
    if (!member.nuance) problems.push(`"${member.word}" has no nuance`)
    if (!member.register) warn(m.line, 'warn', `"${member.word}" in "${d.title}" has no register`)
    if (!member.polish) warn(m.line, 'warn', `"${member.word}" in "${d.title}" has no Polish`)
    return member
  })
  if (members.length < 2) problems.push('needs at least two members')
  if (members.length > 6) warn(d.line, 'warn', `"${d.title}" has ${members.length} members; 3-6 is the intended size`)
  else if (members.length === 2) warn(d.line, 'warn', `"${d.title}" has only two members; 3-6 is the intended size`)
  if (!d.core) warn(d.line, 'warn', `"${d.title}" has no core meaning`)
  if (!collection) problems.push('no Collection header')
  const words = members.map((m) => m.word.toLowerCase())
  if (new Set(words).size !== words.length) problems.push('repeats a member word')

  const scale = d.scale
  const ordered = scale ? scale === 'gradient' : headerOrdered

  const reviews: ClusterReviewMark[] = []
  for (const part of d.reviews.split(',')) {
    if (!part.trim()) continue
    const m = /^\s*(\S+?)=([1-4])\s*$/.exec(part)
    const ts = m ? normalizeTs(m[1]) : null
    if (m && ts) reviews.push({ ts, rating: Number(m[2]) as Rating })
    else warn(d.line, 'warn', `Bad review entry "${part.trim()}" for "${d.title}"`)
  }
  const firstSeen = d.first ? (normalizeTs(d.first) ?? undefined) : undefined
  if (problems.length) warn(d.line, 'error', `Cluster "${d.title}": ${problems.join(', ')}`)
  return { title: d.title.trim(), coreMeaning: d.core, members, ordered, collection, firstSeen, reviews, problems, line: d.line }
}

export interface ClusterExportRow {
  content: ClusterContent
  firstSeen?: string
  reviews: ClusterReviewMark[]
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** Clusters as Markdown, grouped under their `Collection:` line, in the order given. */
export function serializeClusters(rows: ClusterExportRow[]): string {
  const out: string[] = []
  let collection: string | null = null
  for (const row of rows) {
    const c = row.content
    if (c.collection !== collection) {
      collection = c.collection
      out.push('---', '', `Collection: ${collection}`, '', '---', '')
    }
    out.push(`## Cluster: ${oneLine(c.title)}`)
    if (c.coreMeaning) out.push(`Core meaning: ${oneLine(c.coreMeaning)}`)
    out.push(`Scale: ${c.ordered ? 'gradient' : 'none'}`)
    if (row.firstSeen) out.push(`First seen: ${row.firstSeen}`)
    if (row.reviews.length) out.push(`Reviews: ${row.reviews.map((r) => `${r.ts}=${r.rating}`).join(', ')}`)
    out.push('')
    for (const m of c.members) {
      out.push(`### ${oneLine(m.word)}`)
      const f = (label: string, v: string) => v && out.push(`- ${label}: ${oneLine(v)}`)
      f('Register', m.register)
      f('Nuance', m.nuance)
      f('Example', m.example)
      f('Polish', m.polish)
      for (const [k, v] of Object.entries(m.extra)) f(k, v)
      out.push('')
    }
    out.push('---', '')
  }
  return out.join('\n')
}

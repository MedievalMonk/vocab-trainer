import type { Card, FSRS } from 'ts-fsrs'
import { findSameMeaningDuplicates, type DuplicateGroup } from './analysis'
import { createEventFactory, replay, type VocabEvent, type VocabState } from './events'
import { exportMarkdown } from './export'
import { clusterDashboard } from './clusterQueue'
import { beforeClusters, hasClusters, parseClusters, type ParsedClusters } from './clusters'
import { planClusterImport } from './clusterMerge'
import { buildHistory, dayKey } from './history'
import { computeStats, libraryCounts } from './stats'
import { normalizeCollection } from './identity'
import { parseMarkdown } from './markdown'
import { planImport, type ImportReport } from './merge'
import * as queue from './queue'
import { buildCards, cardForCluster, createFsrs, fsrsSummary } from './scheduler'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from './settings'
import type { EventStore } from './store'
import { exposureEvents, reviewEvents } from './study'
import type { EntryContent, ParsedDocument, Rating, Status } from './types'

export interface ServiceOptions {
  clock?: () => Date
  /** Minutes east of UTC; defaults to the machine's current offset. */
  tzOffsetMin?: () => number
  deviceId?: string
}

export type CalendarData = ReturnType<VocabService['calendar']>

/** What the UI talks to. Every write is an appended event; state is rebuilt from the log. */
export class VocabService {
  private events: VocabEvent[]
  private _state!: VocabState
  private cards!: Map<string, Card>
  private f!: FSRS
  /** FSRS for synonym clusters: day-scale scheduling, no minute-long learning steps. */
  private fCluster!: FSRS
  private clusterCards!: Map<string, Card>
  private factory: ReturnType<typeof createEventFactory>
  /** Latest event timestamp in the log; imports start strictly after it so file order is kept. */
  private lastTs = ''

  private constructor(
    private store: EventStore,
    events: VocabEvent[],
    private _settings: Settings,
    readonly deviceId: string,
    private clock: () => Date,
    private tz: () => number,
  ) {
    this.events = events
    for (const e of events) if (e.ts > this.lastTs) this.lastTs = e.ts
    this.factory = createEventFactory(deviceId, () => this.clock().toISOString())
    this.rebuild()
  }

  static async open(store: EventStore, opts: ServiceOptions = {}): Promise<VocabService> {
    const settings = mergeSettings(await store.getMeta<Partial<Settings>>('settings'))
    let deviceId = opts.deviceId ?? (await store.getMeta<string>('deviceId'))
    if (!deviceId) {
      deviceId = 'dev-' + (globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10))
    }
    await store.setMeta('deviceId', deviceId)
    const clock = opts.clock ?? (() => new Date())
    const tz = opts.tzOffsetMin ?? (() => -clock().getTimezoneOffset())
    return new VocabService(store, await store.loadAll(), settings, deviceId, clock, tz)
  }

  get state(): VocabState {
    return this._state
  }
  get settings(): Settings {
    return this._settings
  }

  private rebuild() {
    this._state = replay(this.events)
    this.f = createFsrs(this._settings.requestRetention)
    this.cards = buildCards(this._state.entries.values(), this.f, this._settings)
    this.fCluster = createFsrs(this._settings.requestRetention, false)
    this.clusterCards = new Map()
    for (const c of this._state.clusters.values()) {
      if (c.deleted) continue
      const card = cardForCluster(c, this.fCluster)
      if (card) this.clusterCards.set(c.id, card)
    }
  }

  private async commit(events: VocabEvent[]) {
    if (!events.length) return
    await this.store.append(events)
    this.events.push(...events)
    for (const e of events) if (e.ts > this.lastTs) this.lastTs = e.ts
    this.rebuild()
  }

  private ctx(): queue.QueueContext {
    return { now: this.clock(), tzOffsetMin: this.tz(), settings: this._settings, f: this.f, cards: this.cards }
  }

  // ---- content ----------------------------------------------------------------------------

  /** Bulk paste or file import. Merges into the one internal store. */
  async importMarkdown(text: string, opts: { defaultCollection?: string; updateExisting?: boolean } = {}): Promise<ImportReport> {
    // Word blocks come first in a file; synonym clusters (`## Cluster:`) are read separately.
    const words = parseMarkdown(beforeClusters(text), { defaultCollection: opts.defaultCollection })
    const clusters = hasClusters(text) ? parseClusters(text) : undefined
    return this.runImport(words, opts.updateExisting, clusters)
  }

  /** Quick-add form: one entry. Same merge rules as an import, so a duplicate is reported, not doubled. */
  async addEntry(entry: Omit<EntryContent, 'extra' | 'tags'> & { tags?: string[]; extra?: Record<string, string> }): Promise<ImportReport> {
    const collection = normalizeCollection(entry.collection)
    const problems = (['word', 'pos', 'definition', 'example', 'polish'] as const).filter((k) => !entry[k]?.trim()).map((k) => `missing ${k}`)
    if (!collection) problems.push('no Collection header')
    const doc: ParsedDocument = {
      entries: [{ ...entry, word: entry.word.trim(), collection, tags: entry.tags ?? [], extra: entry.extra ?? {}, reviews: [], problems, line: 0 }],
      warnings: problems.length ? [{ line: 0, level: 'error', message: problems.join(', ') }] : [],
      collections: collection ? [collection] : [],
    }
    return this.runImport(doc, false)
  }

  private async runImport(doc: ParsedDocument, updateExisting?: boolean, clusterDoc?: ParsedClusters): Promise<ImportReport> {
    const base = Math.max(this.clock().getTime(), this.lastTs ? Date.parse(this.lastTs) + 1 : 0)
    const { events, report } = planImport(this._state, doc, {
      now: new Date(base).toISOString(),
      device: this.deviceId,
      updateExisting,
    })
    if (clusterDoc) {
      // Clusters start after the last word event so file order is kept across both.
      const next = events.reduce((t, e) => Math.max(t, Date.parse(e.ts) + 1), base)
      const planned = planClusterImport(this._state, clusterDoc, { now: new Date(next).toISOString(), device: this.deviceId, updateExisting })
      events.push(...planned.events)
      report.clusters = planned.report
      report.warnings.push(...planned.report.warnings)
    }
    if (!doc.entries.length && !clusterDoc?.clusters.length) {
      report.warnings.push({ line: 0, level: 'error', message: 'Nothing was imported: no word entries or synonym clusters were found in this text' })
    }
    await this.commit(events)
    return report
  }

  async editEntry(id: string, fields: Partial<EntryContent>) {
    await this.commit([this.factory.make({ type: 'entry.update', entryId: id, fields })])
  }
  async deleteEntry(id: string) {
    await this.commit([this.factory.make({ type: 'entry.delete', entryId: id })])
  }
  async setStatus(id: string, status: Status) {
    await this.commit([this.factory.make({ type: 'status.set', entryId: id, status })])
  }

  exportMarkdown(): string {
    return exportMarkdown(this._state, { now: this.clock().toISOString(), fsrs: (id) => fsrsSummary(this.cards.get(id)) })
  }

  duplicates(): DuplicateGroup[] {
    return findSameMeaningDuplicates(this._state.entries.values())
  }

  // ---- studying ---------------------------------------------------------------------------

  /** FSRS card for an entry; undefined if it has never had its teach-first pass. */
  card(id: string): Card | undefined {
    return this.cards.get(id)
  }

  dashboard(): queue.Dashboard {
    return queue.dashboard(this._state, this.ctx())
  }
  /** `size` overrides the default batch size for this one batch. */
  repetitions(size?: number): string[] {
    return queue.repetitionBatch(this._state, this.ctx(), size)
  }
  newWords(mode: queue.NewWordsMode, rng?: () => number, size?: number) {
    return queue.newWordsBatch(this._state, this.ctx(), mode, rng, size)
  }
  revisit(size?: number): string[] {
    return queue.revisitBatch(this._state, this.ctx(), size)
  }

  /** Teach-first pass finished for these entries. */
  async markExposed(ids: string[]) {
    const entries = ids.flatMap((id) => this._state.entries.get(id) ?? [])
    await this.commit(exposureEvents(entries, this.factory, this.clock()))
  }

  /** A graded answer. Returns the entry's status after, so the UI can play the "filed" moment. */
  async review(id: string, rating: Rating, mode: string, exercise?: string): Promise<Status> {
    const entry = this._state.entries.get(id)
    if (!entry || entry.deleted) throw new Error(`Unknown entry ${id}`)
    await this.commit(reviewEvents(entry, this.cards.get(id), this.f, this.factory, rating, mode, this.clock(), this._settings, exercise))
    return this._state.entries.get(id)!.status
  }

  // ---- The Thesaurus (synonym clusters) -----------------------------------------------------

  private clusterCtx() {
    return { now: this.clock(), tzOffsetMin: this.tz(), settings: this._settings, f: this.fCluster, cards: this.clusterCards }
  }

  /** Every cluster with its schedule: `new` (never practised), `due` (today or overdue) or `later`. */
  clusterList() {
    const tz = this.tz()
    const now = this.clock().getTime()
    const endOfToday = Math.floor((now + tz * 60_000) / 86_400_000) * 86_400_000 - tz * 60_000 + 86_400_000
    return [...this._state.clusters.values()]
      .filter((c) => !c.deleted)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => {
        const card = this.clusterCards.get(c.id)
        const status: 'new' | 'due' | 'later' = !card ? 'new' : card.due.getTime() < endOfToday ? 'due' : 'later'
        return { id: c.id, content: c.content, status, due: card?.due, practised: c.reviews.length, lastRating: c.reviews.at(-1)?.rating }
      })
  }

  cluster(id: string) {
    const c = this._state.clusters.get(id)
    return c && !c.deleted ? c : undefined
  }

  clusterDashboard() {
    return clusterDashboard(this._state, this.clusterCtx())
  }

  /** One finished practice round on a cluster, graded by how many answers were right. */
  async reviewCluster(id: string, rating: Rating, correct: number, total: number) {
    if (!this.cluster(id)) throw new Error(`Unknown cluster ${id}`)
    await this.commit([this.factory.make({ type: 'cluster.review', clusterId: id, rating, correct, total, mode: 'practice' })])
  }

  async deleteCluster(id: string) {
    await this.commit([this.factory.make({ type: 'cluster.delete', clusterId: id })])
  }

  /**
   * Dictionary entries with the same headword as a cluster member (case-insensitive, any part of
   * speech), so a member can point at the word's ordinary entry. A member is only linked, never
   * created from: it has no definition or part of speech of its own.
   */
  linkedEntries(word: string) {
    const norm = (s: string) => s.replace(/\s*\(.*?\)/g, '').normalize('NFC').trim().toLowerCase()
    const w = norm(word)
    return [...this._state.entries.values()].filter((e) => !e.deleted && norm(e.content.word) === w)
  }

  // ---- history and resets -----------------------------------------------------------------

  /**
   * Everything the dashboard calendar needs: what was studied on each past day, what is due on
   * each coming day, and totals since the last reset. Dates are local calendar dates.
   */
  calendar(daysAhead = 70) {
    const tz = this.tz()
    const history = buildHistory(this._state, tz)
    return {
      today: dayKey(this.clock().getTime(), tz),
      ...history,
      due: queue.dueByDay(this.ctx(), daysAhead),
    }
  }

  /** Totals: words in the library and how many have been studied. */
  counts() {
    return libraryCounts(this._state)
  }

  /** Everything the Stats tab shows, since the last reset. */
  stats() {
    const tz = this.tz()
    return computeStats(this._state, this.cards, this.f, this._settings, tz, dayKey(this.clock().getTime(), tz))
  }

  /** Every word becomes `new` again and the history restarts. Words and edits are kept. */
  async resetProgress() {
    await this.commit([this.factory.make({ type: 'progress.reset' })])
  }

  /**
   * Deletes every word, all progress and history, and the settings, on this device.
   * (Once Drive sync exists this will also need to remove the synced copies.)
   */
  async clearEverything() {
    await this.store.clearAll()
    await this.store.setMeta('deviceId', this.deviceId)
    this.events = []
    this.lastTs = ''
    this._settings = DEFAULT_SETTINGS
    this.rebuild()
  }

  async updateSettings(patch: Partial<Settings>) {
    this._settings = { ...this._settings, ...patch }
    await this.store.setMeta('settings', this._settings)
    this.rebuild()
  }

  static readonly defaultSettings = DEFAULT_SETTINGS
}

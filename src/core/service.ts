import type { Card, FSRS } from 'ts-fsrs'
import { findSameMeaningDuplicates, type DuplicateGroup } from './analysis'
import { createEventFactory, replay, type VocabEvent, type VocabState } from './events'
import { exportMarkdown } from './export'
import { buildHistory, dayKey } from './history'
import { computeStats, libraryCounts } from './stats'
import { normalizeCollection } from './identity'
import { parseMarkdown } from './markdown'
import { planImport, type ImportReport } from './merge'
import * as queue from './queue'
import { buildCards, createFsrs, fsrsSummary } from './scheduler'
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
    return this.runImport(parseMarkdown(text, { defaultCollection: opts.defaultCollection }), opts.updateExisting)
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

  private async runImport(doc: ParsedDocument, updateExisting?: boolean): Promise<ImportReport> {
    const base = Math.max(this.clock().getTime(), this.lastTs ? Date.parse(this.lastTs) + 1 : 0)
    const { events, report } = planImport(this._state, doc, {
      now: new Date(base).toISOString(),
      device: this.deviceId,
      updateExisting,
    })
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

import type { VocabEvent } from './events'

/**
 * Durable storage for the event log (and a little metadata). The log is the source of
 * truth; everything else is derived. Appends are idempotent by event id.
 */
export interface EventStore {
  loadAll(): Promise<VocabEvent[]>
  append(events: VocabEvent[]): Promise<void>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  /** Deletes every event and all metadata on this device. */
  clearAll(): Promise<void>
}

export class MemoryStore implements EventStore {
  private events = new Map<string, VocabEvent>()
  private meta = new Map<string, unknown>()
  async loadAll() {
    return [...this.events.values()]
  }
  async append(events: VocabEvent[]) {
    for (const e of events) this.events.set(e.id, e)
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value)
  }
  async clearAll() {
    this.events.clear()
    this.meta.clear()
  }
}

const EVENTS = 'events'
const META = 'meta'

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

export class IndexedDbStore implements EventStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(
    private name = 'vocab-trainer',
    private idb: IDBFactory = indexedDB,
  ) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        // Future schema changes: add `if (event.oldVersion < 2) {...}` steps here, never rewrite v1.
        const events = db.createObjectStore(EVENTS, { keyPath: 'id' })
        events.createIndex('device', 'device')
        db.createObjectStore(META)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.dbPromise
  }

  async loadAll(): Promise<VocabEvent[]> {
    const db = await this.db()
    return wrap(db.transaction(EVENTS).objectStore(EVENTS).getAll() as IDBRequest<VocabEvent[]>)
  }

  async append(events: VocabEvent[]): Promise<void> {
    if (!events.length) return
    const db = await this.db()
    const tx = db.transaction(EVENTS, 'readwrite')
    const store = tx.objectStore(EVENTS)
    for (const e of events) store.put(e)
    await done(tx)
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.db()
    return wrap(db.transaction(META).objectStore(META).get(key)) as Promise<T | undefined>
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db()
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put(value, key)
    await done(tx)
  }

  async clearAll(): Promise<void> {
    const db = await this.db()
    const tx = db.transaction([EVENTS, META], 'readwrite')
    tx.objectStore(EVENTS).clear()
    tx.objectStore(META).clear()
    await done(tx)
  }

  close() {
    void this.dbPromise?.then((db) => db.close())
    this.dbPromise = null
  }
}

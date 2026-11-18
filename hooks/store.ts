// The inbox on disk: one small JSON file per item, per answer and per receipt,
// each written by one party only, so parallel sessions never overwrite each
// other. The layout is documented in docs/FORMAT.md.
//
//   items/<id>.json      the session that added the item (and resolve)
//   responses/<id>.json  the owner's pane
//   receipts/<id>.json   the session the answer was delivered to
//   owner/seen.json      the owner's pane: which items were opened
import type { Item, Receipt, Response } from '../types'
import { ID_RE, isItem, isReceipt, isResponse } from './core'

export type FsEntryLike = { name: string; kind: string; mtimeMs: number; size: number }

/** The part of `$.fs` the store uses; the tests hand in their own. */
export type FsLike = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<readonly FsEntryLike[]>
}

type Cached<T> = { mtimeMs: number; size: number; value: T }

export type Contents = {
  items: Item[]
  responses: Map<string, Response>
  receipts: Map<string, Receipt>
  seen: Record<string, number>
}

type Validator<T> = (value: unknown, id: string) => value is T

// A write we made ourselves is read again on the next scan: its time on disk
// is not known here, and the file may since have changed again.
const UNKNOWN = -1

export class InboxStore {
  private readonly items = new Map<string, Cached<Item>>()
  private readonly responses = new Map<string, Cached<Response>>()
  private readonly receipts = new Map<string, Cached<Receipt>>()
  private seen: Cached<Record<string, number>> | undefined
  private gen = 0

  constructor(
    private readonly fs: FsLike,
    readonly dir: string,
  ) {}

  private path(...parts: string[]): string {
    return [this.dir.replace(/[\\/]+$/, ''), ...parts].join('/')
  }

  /**
   * Counts every change to what the store holds, whoever caused it (a scan,
   * one of its own writes), so a reader can tell whether it is behind.
   */
  get generation(): number {
    return this.gen
  }

  /** Reads what changed on disk since the last scan; true when anything did. */
  async scan(): Promise<boolean> {
    const changed = await Promise.all([
      this.scanDir('items', this.items, isItem),
      this.scanDir('responses', this.responses, isResponse),
      this.scanDir('receipts', this.receipts, isReceipt),
      this.scanSeen(),
    ])
    const isChanged = changed.some(Boolean)
    if (isChanged) this.gen += 1

    return isChanged
  }

  private async scanDir<T>(
    sub: string,
    cache: Map<string, Cached<T>>,
    isValid: Validator<T>,
  ): Promise<boolean> {
    let entries: readonly FsEntryLike[]
    try {
      entries = await this.fs.list(this.path(sub))
    } catch {
      // Missing (nothing written yet) or unreadable for now: keep what we have.
      return false
    }
    let changed = false
    const present = new Set<string>()
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -'.json'.length)
      if (!ID_RE.test(id)) continue
      present.add(id)
      const old = cache.get(id)
      if (old !== undefined && old.mtimeMs === entry.mtimeMs && old.size === entry.size) continue
      try {
        const value: unknown = JSON.parse(await this.fs.read(this.path(sub, entry.name)))
        // A half-written or foreign file: keep the last good value, try again.
        if (!isValid(value, id)) continue
        cache.set(id, { mtimeMs: entry.mtimeMs, size: entry.size, value })
        changed = true
      } catch {
        // Being written right now, or gone: the next scan tries again.
      }
    }
    for (const id of [...cache.keys()]) {
      if (!present.has(id) && cache.get(id)?.mtimeMs !== UNKNOWN) {
        cache.delete(id)
        changed = true
      }
    }

    return changed
  }

  private async scanSeen(): Promise<boolean> {
    let entries: readonly FsEntryLike[]
    try {
      entries = await this.fs.list(this.path('owner'))
    } catch {
      return false
    }
    const entry = entries.find(one => one.name === 'seen.json' && one.kind === 'file')
    if (entry === undefined) return false
    const old = this.seen
    if (old !== undefined && old.mtimeMs === entry.mtimeMs && old.size === entry.size) return false
    try {
      const value: unknown = JSON.parse(await this.fs.read(this.path('owner', 'seen.json')))
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const seen: Record<string, number> = {}
      for (const [id, at] of Object.entries(value)) {
        if (ID_RE.test(id) && typeof at === 'number') seen[id] = at
      }
      this.seen = { mtimeMs: entry.mtimeMs, size: entry.size, value: seen }

      return true
    } catch {
      return false
    }
  }

  /** What the store holds now, with no disk access. */
  contents(): Contents {
    return {
      items: [...this.items.values()].map(one => one.value),
      responses: new Map([...this.responses].map(([id, one]) => [id, one.value])),
      receipts: new Map([...this.receipts].map(([id, one]) => [id, one.value])),
      seen: { ...(this.seen?.value ?? {}) },
    }
  }

  item(id: string): Item | undefined {
    return this.items.get(id)?.value
  }

  response(id: string): Response | undefined {
    return this.responses.get(id)?.value
  }

  receipt(id: string): Receipt | undefined {
    return this.receipts.get(id)?.value
  }

  /** Reads one item from disk, bypassing the cache (before changing it). */
  async readItem(id: string): Promise<Item | undefined> {
    return this.readFresh('items', id, isItem)
  }

  /**
   * Reads one response from disk before changing it, so a change made in
   * another session's pane a moment ago is not overwritten; the cache's when
   * the file cannot be read now, undefined when there is none.
   */
  async readResponse(id: string): Promise<Response | undefined> {
    const cached = this.response(id)
    let entries: readonly FsEntryLike[]
    try {
      entries = await this.fs.list(this.path('responses'))
    } catch {
      return cached
    }
    if (!entries.some(entry => entry.name === `${id}.json`)) return cached

    return (await this.readFresh('responses', id, isResponse)) ?? cached
  }

  private async readFresh<T>(sub: string, id: string, isValid: Validator<T>): Promise<T | undefined> {
    if (!ID_RE.test(id)) return undefined
    try {
      const value: unknown = JSON.parse(await this.fs.read(this.path(sub, `${id}.json`)))

      return isValid(value, id) ? value : undefined
    } catch {
      return undefined
    }
  }

  private async put<T extends { id: string }>(
    sub: string,
    cache: Map<string, Cached<T>>,
    value: T,
  ): Promise<void> {
    if (!ID_RE.test(value.id)) throw new Error(`refused id ${JSON.stringify(value.id)}`)
    await this.fs.write(this.path(sub, `${value.id}.json`), `${JSON.stringify(value, null, 2)}\n`)
    cache.set(value.id, { mtimeMs: UNKNOWN, size: UNKNOWN, value })
    this.gen += 1
  }

  writeItem(item: Item): Promise<void> {
    return this.put('items', this.items, item)
  }

  writeResponse(response: Response): Promise<void> {
    return this.put('responses', this.responses, response)
  }

  writeReceipt(receipt: Receipt): Promise<void> {
    return this.put('receipts', this.receipts, receipt)
  }

  /**
   * Marks items as opened by the owner; forgets ids that no longer exist.
   * Reads the file first, so another pane's marks of a moment ago stay.
   */
  async markSeen(ids: readonly string[], now: number): Promise<void> {
    if (ids.every(id => this.seen?.value[id] !== undefined)) return
    if (await this.scanSeen()) this.gen += 1
    const seen: Record<string, number> = {}
    for (const [id, at] of Object.entries(this.seen?.value ?? {})) {
      if (this.items.has(id)) seen[id] = at
    }
    let added = false
    for (const id of ids) {
      if (!ID_RE.test(id) || seen[id] !== undefined) continue
      seen[id] = now
      added = true
    }
    if (!added) return
    await this.fs.write(this.path('owner', 'seen.json'), `${JSON.stringify(seen, null, 2)}\n`)
    this.seen = { mtimeMs: UNKNOWN, size: UNKNOWN, value: seen }
    this.gen += 1
  }
}

import { describe, expect, test } from 'claude-code/testing'

import { InboxStore } from '../hooks/store'
import type { Item, Response } from '../types'
import { MemFs } from './memfs'

const DIR = 'C:/Users/someone/.owner-inbox'
const A = '20261118-101500-00000a'
const B = '20261118-101501-00000b'

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    v: 1,
    id,
    type: 'task',
    title: `Task ${id}`,
    allowText: true,
    project: 'demo',
    source: { sessionId: 'S1' },
    createdAt: 1,
    ...over,
  }
}

describe('InboxStore', () => {
  test('writes one file per item, answer and receipt', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, `${DIR}/`)
    await store.writeItem(item(A))
    await store.writeResponse({ v: 1, id: A, status: 'answered', choice: 'done', updatedAt: 2, answeredAt: 2 })
    await store.writeReceipt({ v: 1, id: A, deliveredAt: 3, answeredAt: 2 })
    expect(fs.names(`${DIR}/items`)).toEqual([`${A}.json`])
    expect(fs.names(`${DIR}/responses`)).toEqual([`${A}.json`])
    expect(fs.names(`${DIR}/receipts`)).toEqual([`${A}.json`])
    expect(fs.json(`${DIR}/items/${A}.json`)).toEqual(item(A))
  })

  test('sees what another session wrote, and only reads what changed', async () => {
    const fs = new MemFs()
    const mine = new InboxStore(fs, DIR)
    const theirs = new InboxStore(fs, DIR)
    expect(await mine.scan()).toBe(false)
    await theirs.writeItem(item(A))
    expect(await mine.scan()).toBe(true)
    expect(mine.contents().items.map(one => one.id)).toEqual([A])
    expect(await mine.scan()).toBe(false)

    let reads = 0
    const counting = new InboxStore(
      { ...fs, read: async path => ((reads += 1), fs.read(path)), write: fs.write, list: fs.list },
      DIR,
    )
    await counting.scan()
    await counting.scan()
    expect(reads).toBe(1)
  })

  test('its own writes count at once and are read back on the next scan', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    await store.writeItem(item(A))
    expect(store.item(A)?.title).toBe(`Task ${A}`)
    expect(await store.scan()).toBe(true)
    expect(await store.scan()).toBe(false)
  })

  test('keeps the last good value while a file is half written', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    fs.put(`${DIR}/items/${A}.json`, JSON.stringify(item(A)))
    await store.scan()
    fs.put(`${DIR}/items/${A}.json`, '{"v":1,"id":')
    expect(await store.scan()).toBe(false)
    expect(store.item(A)?.title).toBe(`Task ${A}`)
    fs.put(`${DIR}/items/${A}.json`, JSON.stringify(item(A, { title: 'Renamed' })))
    expect(await store.scan()).toBe(true)
    expect(store.item(A)?.title).toBe('Renamed')
  })

  test('ignores foreign and misnamed files', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    fs.put(`${DIR}/items/notes.txt`, 'hello')
    fs.put(`${DIR}/items/../../evil.json`, JSON.stringify(item(A)))
    fs.put(`${DIR}/items/${B}.json`, JSON.stringify(item(A)))
    fs.put(`${DIR}/items/${A}.json`, JSON.stringify({ v: 2, id: A }))
    await store.scan()
    expect(store.contents().items).toEqual([])
  })

  test('forgets a file that was removed', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    fs.put(`${DIR}/items/${A}.json`, JSON.stringify(item(A)))
    await store.scan()
    fs.files.delete(`${DIR}/items/${A}.json`)
    expect(await store.scan()).toBe(true)
    expect(store.contents().items).toEqual([])
  })

  test('refuses an id that is not one of its own', async () => {
    const store = new InboxStore(new MemFs(), DIR)
    await expect(store.writeItem(item('../../escape'))).rejects.toThrow(/refused id/)
    const response = { v: 1, id: 'x/y', status: 'draft', updatedAt: 1 } as unknown as Response
    await expect(store.writeResponse(response)).rejects.toThrow(/refused id/)
    expect(await store.readItem('../x')).toBeUndefined()
  })

  test('readItem reads the disk, not the cache', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    await store.writeItem(item(A))
    fs.put(`${DIR}/items/${A}.json`, JSON.stringify(item(A, { title: 'Changed elsewhere' })))
    expect((await store.readItem(A))?.title).toBe('Changed elsewhere')
    expect(await store.readItem(B)).toBeUndefined()
  })

  test('marks items seen and forgets ids that are gone', async () => {
    const fs = new MemFs()
    const store = new InboxStore(fs, DIR)
    await store.writeItem(item(A))
    await store.markSeen([A], 5)
    expect(fs.json(`${DIR}/owner/seen.json`)).toEqual({ [A]: 5 })
    await store.markSeen([A], 9)
    expect(fs.json(`${DIR}/owner/seen.json`)).toEqual({ [A]: 5 })

    const other = new InboxStore(fs, DIR)
    await other.scan()
    expect(other.contents().seen).toEqual({ [A]: 5 })
  })
})

// A folder tree in memory for the tests: what `$.fs` would read and write.
import type { FsEntryLike, FsLike } from '../hooks/store'

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

export class MemFs implements FsLike {
  readonly files = new Map<string, { text: string; mtimeMs: number }>()
  private tick = 1000

  readonly read = async (path: string): Promise<string> => {
    const file = this.files.get(norm(path))
    if (file === undefined) throw new Error(`ENOENT: ${path}`)

    return file.text
  }

  readonly write = async (path: string, text: string): Promise<void> => {
    this.put(path, text)
  }

  readonly list = async (path: string): Promise<readonly FsEntryLike[]> => this.entries(path)

  /** Writes as another process would, outside the store. */
  put(path: string, text: string): void {
    this.tick += 1
    this.files.set(norm(path), { text, mtimeMs: this.tick })
  }

  json(path: string): unknown {
    const file = this.files.get(norm(path))

    return file === undefined ? undefined : JSON.parse(file.text)
  }

  entries(path: string): FsEntryLike[] {
    const prefix = `${norm(path)}/`
    const out: FsEntryLike[] = []
    for (const [name, file] of this.files) {
      if (!name.startsWith(prefix)) continue
      const rest = name.slice(prefix.length)
      if (rest.includes('/')) continue
      out.push({ name: rest, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs })
    }

    return out
  }

  names(dir: string): string[] {
    return this.entries(dir)
      .map(entry => entry.name)
      .sort()
  }
}

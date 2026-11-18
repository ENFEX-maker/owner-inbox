// The owner-inbox contract: the data it keeps on disk and the values its pane
// draws from. The on-disk format is documented in docs/FORMAT.md.

/** What a session asks of the owner. */
export type ItemType = 'question' | 'decision' | 'approval' | 'review' | 'task' | 'test'

/** One step of a test guide. */
export type Step = { id: string; text: string; expect?: string }

/** Where an item came from. */
export type Source = {
  /** The Claude Code session id of the session that added the item. */
  sessionId: string
  /** A short name the session gave itself, such as "lead" or "docs". */
  label?: string
  /** The folder the session ran in. */
  root?: string
}

/** items/<id>.json, written by the session that added the item. */
export type Item = {
  v: 1
  id: string
  type: ItemType
  title: string
  body?: string
  options?: string[]
  recommended?: string
  allowText: boolean
  steps?: Step[]
  project: string
  source: Source
  createdAt: number
  closed?: { at: number; reason: 'done' | 'withdrawn'; note?: string; by?: string }
}

/** One step's outcome in a test guide. */
export type StepResult = { result?: 'pass' | 'fail'; note?: string }

/** responses/<id>.json, written by the owner's pane. */
export type Response = {
  v: 1
  id: string
  /** `draft` while the owner is still working on it, `answered` once sent. */
  status: 'draft' | 'answered'
  /** The option, or for the fixed kinds: approved, rejected, done, declined. */
  choice?: string
  /** Free text: an answer of its own, or a note to the choice. */
  text?: string
  steps?: Record<string, StepResult>
  /** The owner put it away; it counts as done. */
  archived?: boolean
  archivedAt?: number
  /** The owner took an answer back; set while the response is a draft again. */
  retractedAt?: number
  /** Where the owner filed an item not answered yet: being worked on, or put off. */
  phase?: Phase
  phaseAt?: number
  /** The owner's note to the session about the phase. */
  phaseNote?: string
  updatedAt: number
  answeredAt?: number
}

/**
 * receipts/<id>.json, written by the session once news of the item reached it:
 * `answeredAt` names what it got (the answer's `answeredAt`, or the
 * `archivedAt` or `retractedAt` of a put-away or taken-back answer).
 */
export type Receipt = { v: 1; id: string; deliveredAt: number; answeredAt: number }

/** Where the owner filed an item before answering it. */
export type Phase = 'progress' | 'later'

/** What a session is told about one of its items. */
export type DeliveryKind = 'answer' | 'dismissed' | 'retracted' | 'progress' | 'later'

export type Delivery = { entry: Entry; kind: DeliveryKind; version: number }

/**
 * open: waits for the owner; progress: the owner is on it; later: put off;
 * answered: the owner answered, the session has not closed it; done.
 */
export type Status = 'open' | 'progress' | 'later' | 'answered' | 'done'

/** An item with everything known about it, as the pane draws it. */
export type Entry = {
  item: Item
  response?: Response
  status: Status
  /** Open and not yet opened by the owner. */
  isNew: boolean
  /** The current answer reached the session that asked. */
  delivered: boolean
}

export type Snapshot = { entries: Entry[] }

/** Which collapsible parts of the pane are expanded. */
export type Sections = { progress?: boolean; later?: boolean; done?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'owner-inbox': {
      snapshot: Shaped<Snapshot>
      selected: string | null
      sections: Sections
      notice: string | null
    }
  }
}

# The inbox on disk

The inbox is a folder (default `~/.owner-inbox`) of small JSON files. Any program may read it; programs that write must keep to the rule that **each file has exactly one writer**, which is what lets parallel sessions share the folder without locks.

```
items/<id>.json      written by the session that added the item (and by resolve)
responses/<id>.json  written by the owner's pane
receipts/<id>.json   written by the session the answer was delivered to
owner/seen.json      written by the owner's pane: which items the owner opened
```

`<id>` is `YYYYMMDD-HHMMSS-xxxxxx`: the UTC time the item was added and six lowercase hex digits. Files whose name does not match, and files that do not parse or do not match the shapes below, are ignored. A file being written is read again on the next scan.

All times are milliseconds since the Unix epoch. Every file carries `"v": 1`.

## items/&lt;id&gt;.json

```json
{
  "v": 1,
  "id": "20261118-101500-a1b2c3",
  "type": "question",
  "title": "Ship it today?",
  "body": "Markdown with the context.",
  "options": ["Yes", "No"],
  "recommended": "Yes",
  "allowText": true,
  "project": "widget",
  "source": { "sessionId": "<Claude Code session id>", "label": "lead", "root": "C:/work/widget" },
  "createdAt": 1795000000000,
  "closed": { "at": 1795000500000, "reason": "done", "note": "Shipped.", "by": "<session id>" }
}
```

- `type`: `question`, `decision`, `approval`, `review`, `task` or `test`.
- `options` and `recommended`: `question` and `decision` only.
- `steps`: `test` only, `[{ "id": "1", "text": "...", "expect": "..." }]`; `expect` is optional.
- `closed`: absent while the item is active; `reason` is `done`, `withdrawn`, or `chat` for a captured item the owner answered in the chat; `by` is the session that closed it.
- `captured`: `true` on an item the inbox took from a session's closing chat message, because it asked the owner something there and added nothing itself.

## responses/&lt;id&gt;.json

```json
{
  "v": 1,
  "id": "20261118-101500-a1b2c3",
  "status": "answered",
  "choice": "Yes",
  "text": "but after lunch",
  "steps": { "1": { "result": "pass" }, "2": { "result": "fail", "note": "too slow" } },
  "archived": false,
  "updatedAt": 1795000400000,
  "answeredAt": 1795000400000
}
```

- `status`: `draft` while the owner is still working on it (test steps are saved as they are marked), `answered` once sent.
- `choice`: the option for `question` and `decision`; `approved` or `rejected` for `approval`; `done` or `declined` for `review` and `task`.
- `text`: an answer in words, or a note to the choice.
- `archived`, `archivedAt`: the owner put the item away (answered or not); it counts as done.
- `retractedAt`: the owner took an answer back; the response is a `draft` again until the next answer.
- `phase`, `phaseAt`, `phaseNote`: the owner filed the item before answering it, as `progress` (working on it) or `later` (put off), with an optional note to the session. Absent while the item is simply open. An answer drops them.
- `answeredAt` names the answer; a changed answer gets a later one than anything delivered before.

## receipts/&lt;id&gt;.json

```json
{ "v": 1, "id": "20261118-101500-a1b2c3", "deliveredAt": 1795000401000, "answeredAt": 1795000400000 }
```

Written once news of the item reached the session that added it. `answeredAt` names what it got: the answer's `answeredAt`, the `phaseAt` of an item marked in progress or later, the `archivedAt` of an item put away unanswered, or the `retractedAt` of an answer taken back after it was delivered. News whose time no receipt names is due for delivery. Only the session that added the item writes its receipt.

## owner/seen.json

```json
{ "20261118-101500-a1b2c3": 1795000300000 }
```

The items the owner opened, by id, with the time. Open items not listed here count as new.

## Status

An item is **done** when it is closed or its response is archived, **answered** when its response has `status: "answered"`, **progress** or **later** when its draft response has that `phase`, and **open** otherwise.

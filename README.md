# owner-inbox

One inbox for everything your Claude Code sessions need from you.

Long autonomous sessions ask questions, want approvals and hand you test guides while they keep working. Their messages scroll out of sight under everything that happens next, and things get lost. With owner-inbox, every session puts what it needs from you into one inbox. Each item stays in a pane beside the chat until you handle it, and your answer goes back to the session that asked, by itself.

Kurzanleitung auf Deutsch: [README.de.md](README.de.md).

## What it does

- **One inbox for all sessions.** Every Claude Code session on your machine writes to the same inbox, so items from parallel sessions show up in one list, grouped by project, each with the session it came from.
- **Stays visible.** Open items wait in the *For you* pane beside the chat and in a line above the prompt (`For you: 2 open, 1 new` and, at its right edge, `(⏸ 1 later)`) until you deal with them, however far the chat has scrolled.
- **Sorted the way you work.** The pane has four parts: *Active*, *In progress*, *Later* and *Done*. Mark an item as in progress or put it off for later, with a note to the session if you like; the session is told, and the item stays open until you answer.
- **Cheap for sessions.** Adding an item is one tool call that returns at once. The session keeps working; it is never blocked waiting for you.
- **A safety net for questions asked in chat.** Sessions are told to use the inbox, and still forget now and then. When a session ends its turn with a message that asks you something and put nothing into the inbox, the inbox takes the question itself, marked *taken from the chat*. If you answer in that chat instead, your next message there closes it again. The check looks for question marks in the closing lines of the message (leaving out code, quotes, links and headings) and costs no model call.
- **Answers come back by themselves.** When you answer, the session that asked receives your answer as a message within a few seconds. If it is busy, the answer arrives right after its current turn. If the host does not let the plugin wake the session, the answer goes along with the session's next tool result or your next prompt. The session also hears when you start on its item, put it off for later, put it away unanswered or take an answer back.
- **Six kinds of items:**

  | Type | You answer with |
  | --- | --- |
  | `question` | an option button and/or your own words |
  | `decision` | one of several options (the recommended one is highlighted) |
  | `approval` | Approve or Reject, with an optional note |
  | `review` | Looked at it / Did not look, with an optional note |
  | `task` | Done / Cannot do it, with an optional note |
  | `test` | a test guide: each step marked as expected or not as expected, with a note per step |

- **Eleven languages**, following your system language: English, German, Spanish, French, Italian, Portuguese, Dutch, Polish, Japanese, Chinese (simplified) and Korean. Other system languages get English; the `language` option sets one.
- **Private by design.** Items are small JSON files in a folder on your machine. Nothing is sent anywhere. Texts that look like keys, tokens or passwords are refused on both sides.

## Requirements

- Claude Code with mods (function hooks). Tested with Claude Code 2.1.325 in the Claude desktop app's Code tab. Mods are an early-access Claude Code feature; their API may change between releases.
- Tested in the desktop app, where the pane docks beside the chat. The terminal (its fullscreen layout docks panes) and the Claude mobile app's Mods sheet over Remote Control follow the same mod rules but are not tested yet; the mobile app draws no text fields yet, so there you answer with buttons only.

## Install

From GitHub, at the prompt of a Claude Code session:

```
/plugin install owner-inbox --marketplace ENFEX-maker/owner-inbox
```

Answer `y` to add the marketplace and pick the user scope, so every session gets the inbox.

From a local copy of this repository:

```bash
claude plugin marketplace add /path/to/owner-inbox
claude plugin install owner-inbox@owner-inbox
```

Sessions started after the install have the inbox; run `/reload-plugins` in a running session to load it there.

## How sessions use it

The plugin gives every session four tools and adds a short paragraph to the system prompt telling the model to use them for anything it needs from you.

| Tool | What it does |
| --- | --- |
| `mcp__owner-inbox__add` | Adds an item (`type`, `title`, optional `body` in Markdown, `options`, `recommended`, `allow_text`, `steps`, `project`, `from`). Returns the item's id at once. |
| `mcp__owner-inbox__answers` | Returns your answers to this session's items that are not closed yet. |
| `mcp__owner-inbox__list` | Lists items with status (`open`, `progress`, `later`, `answered`, `done`), answers and your notes. |
| `mcp__owner-inbox__resolve` | Closes items once acted on (`done`) or no longer needed (`withdrawn`). |

A test guide, for example:

```json
{
  "type": "test",
  "title": "Check the new voice commands",
  "body": "Start the app first. Takes about five minutes.",
  "steps": [
    "Say \"what time is it\"",
    { "text": "Say \"stop\" while it talks", "expect": "It stops within a second" }
  ],
  "from": "lead"
}
```

When you answer, the session receives a message like:

```
The owner answered an item in the owner inbox:

[test] "Check the new voice commands" (id 20261118-101500-a1b2c3)
1 pass, 1 fail, 0 not run.
Step 2 FAIL: Say "stop" while it talks. Note: "took three seconds"
```

## Settings

Set in the plugin's options (the config menu, or `pluginConfigs` in your Claude Code settings):

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `auto` | `auto` follows the system language; `de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt` or `zh` fixes one. |
| `dataDir` | *(empty)* | The inbox folder. Empty means `.owner-inbox` in your home folder. |
| `notify` | `true` | A system notification when a session adds an item. |
| `autoOpen` | `true` | Open the pane by itself where it docks beside the chat. |
| `captureChat` | `true` | The safety net: take a question a session asked only in chat into the inbox. |
| `pollSeconds` | `3` | How often each session looks for changes from other sessions (1 to 60). |

## Data and privacy

- Everything lives in the inbox folder (default `~/.owner-inbox`): one file per item, per answer and per delivery receipt. Each file has one writer, so parallel sessions never overwrite each other. The format is described in [docs/FORMAT.md](docs/FORMAT.md), so other tools can read and write the inbox too.
- The plugin makes no network calls and writes no logs. Notifications show the item's type and title.
- Texts that look like API keys, tokens, private keys or passwords are refused when a session adds them and held back when you type them as an answer. This is a guard, not a guarantee: never paste secrets.
- Answers are plain files, so whoever can write the folder could write an answer in your place. The plugin denies Claude's own file tools (Write, Edit) any path in the folder and shell commands that name it, so a session cannot approve its own request. That is a best effort against mistakes, not a security boundary against other programs on your machine.
- Items are never deleted by the plugin. You can put an item away (*Put away*), and sessions close items they are done with. To clear the inbox, delete files from the folder.

## Languages

Only the pane speaks the owner's language; what sessions read stays English. Every language is one file in `hooks/lang/`. The translations beyond English and German were written without a native speaker's review; corrections are very welcome.

To add a language:

1. Copy `hooks/lang/en.ts` to `hooks/lang/<code>.ts` (the ISO 639-1 code, such as `sv`) and translate every text. Keep the symbols (`▶`, `⏸`, `↺`, `✓`, `✗`, `←`) and the numbers the texts are given.
2. Add it to `LANGUAGES` in `hooks/i18n.ts` and to the `language` options in `.claude-plugin/plugin.json`.
3. Run `claude plugin test .`: a test fails while any text is missing or empty in any language.

## Known limits

- Mods are early access; a Claude Code update may need a matching update here.
- If the plugin reloads (an update, a changed option) while a wake-up message waits behind a running turn, the session may get that answer twice.
- Items are never deleted, and every session reads the whole folder when it starts. With a few items a day that stays small for a long time; archiving old items is not built yet.

## Development

```bash
claude plugin validate .
claude plugin test .
```

The tests run on Claude Code's own test kit (`claude-code/testing`): the pure logic (`hooks/core.ts`), the file store (`hooks/store.ts`) and the whole plugin through the engine, including the pane on every surface. To type-check, use the `tsconfig.json` Claude Code lays beside the mod when it loads it, or the one in the header of the plugin API's type file.

Layout:

- `hooks/register.tsx`: the wiring (tools, pane, delivery, timers)
- `hooks/core.ts`: parsing, status, the secret guard, what the model reads
- `hooks/store.ts`: the folder of JSON files
- `hooks/view.tsx`: the pane
- `hooks/i18n.ts`: German and English texts
- `types/index.d.ts`: the data types and the pane's state contract

## License

MIT, see [LICENSE](LICENSE).

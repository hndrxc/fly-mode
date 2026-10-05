# omp-flymode

An [oh-my-pi](https://github.com/can1357/oh-my-pi) plugin that renders your coding agent as a housefly.

When fly mode is on, everything the agent writes in the terminal transcript is replaced with fly language at render time. The model keeps working normally; you just can no longer read any of it.

```
 Reply with exactly these three words and nothing else: purple elephant marmalade

 *hums* *does a loop* bzzt
```

```
╭──────────────────────────────────────────────────────╮
│ $ bz *buzz* bz-$((bz+z))                             │
├─── Bzzt z ───────────────────────────────────────────┤
│ bzzzzzt-bz                                           │
╰──────────────────────────────────────────────────────╯

 Bzzzt *lands on screen* bzt-bz.
```

## Installation

```sh
omp plugin install omp-flymode
```

Requires oh-my-pi 18.6.1 or later. The plugin starts disabled.

## Usage

| Input | Effect |
| --- | --- |
| `/flymode` | Toggle fly mode |
| `/flymode on` | Enable fly mode |
| `/flymode off` | Disable fly mode |
| `Ctrl+Alt+F` | Toggle fly mode |

While fly mode is active, the footer shows `fly mode: bzzt`. The confirmation notice is masked as well.

The setting persists across restarts in `flymode.json` in the oh-my-pi agent directory (`~/.omp/agent/` by default; `--profile` and `PI_CODING_AGENT_DIR` are respected). Resumed sessions open already masked.

## What gets masked

**Masked:**
- assistant responses
- thinking blocks
- tool calls and tool results
- bash and python execution blocks
- extension messages
- status, warning and error notices

**Left readable:**
- your own messages
- the editor
- the footer and status line

## Guarantees

Fly mode is display-only.

- Messages, session files and model context are never modified. The session file records the real conversation.
- The model is not told that it is a fly.
- Turning fly mode off restores the original text immediately, including text that has already scrolled off-screen.

## How it works

The plugin wraps the rendering of every transcript block except user messages. Each rendered line goes through a masker that replaces runs of words with fly text of exactly the same display width. ANSI styling, hyperlinks, punctuation, box-drawing characters and indentation are left in place, so layout, colors and borders stay intact.

Fly text is seeded from the original words. The same word always buzzes the same way, so masked output does not flicker while a response streams.

Vocabulary includes `bz`, `bzzt`, `bzzzzzt`, `*rubs hands*`, `*rubs front legs together*`, `*cleans eyes*`, `*circles the lamp*`, `*bonks into window*`, `*tastes with feet*`, `*hovers menacingly*`, `*lands on your sandwich*`, `*dodges swatter*` and others.

## Known limitations

- Your own `!bash` and python blocks are not masked while they are still running. They are masked once they finish.
- Terminals that use oh-my-pi's native rendering protocol (Tern) are not masked.
- Copying text from the screen, or exporting the rendered transcript, while fly mode is on yields fly text. The saved session is unaffected.
- The session title in the footer is not masked, and it may quote the conversation.

## Development

```sh
bun test                      # unit tests
omp plugin link .             # install from a local checkout
omp -e /path/to/flymode       # load for a single run without installing
```

## License

MIT

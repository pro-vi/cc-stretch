# cc-stretch

**Claude writes a lot. Now you can read a little.**

![A reply in Claude Code growing in place as phrases are clicked](docs/stretch.gif)

Replies arrive short. Click a linked phrase and it grows right where it stands. Click `«` and it
shrinks back. Claude is told which parts you opened, so it doesn't assume you read the rest.

## Install

In a Claude Code session:

```
/plugin install cc-stretch --marketplace pro-vi/cc-stretch
/tui fullscreen
```

In the terminal, clicks need Claude Code's fullscreen renderer. `/tui fullscreen` switches to it,
restarting and resuming your session. If stretches still show open, see [Limits](#limits). In the
Claude desktop app stretches are links: click one to open it in place, click `«` to close it. No
setting needed.

## What to expect

You read about a sixth of what Claude writes. Across 69 real replies from four of my coding
projects, the version you see before clicking was 17% of the words Claude wrote without the
plugin. It carries about two of every three most important points; the rest is one click away. My
replies run long, so if yours are short you will save less. How this was measured, and how to run
it on your own transcripts: [`bench/`](bench/README.md).

## A silly plugin about a serious idea

In 1967 Ted Nelson described **stretchtext**: text that "stretches, becoming longer, with
replacement phrases, new details and additional clauses popping into place", and shrinks back on
demand, while "the reader remains oriented" (*Hypertext Note 8*). In 1970 he put it like this:
"Gaps appear between phrases; new words and phrases pop into the gaps, an item at a time."

It never caught on. The hard part, as later writers put it, was "how to author the text in the
first place" (Wadge and schraefel, 1999): someone had to write every level by hand.

Language models write every level for free, and they are good at it. So all this plugin does is
plug a 59-year-old idea into a terminal. The idea is Nelson's. Most of the code is Claude's. I
mostly clicked things.

Here is what that looks like. The reply opens with

> A monad is a type that wraps values and lets you chain steps that each return a wrapped value.

and one click on that sentence turns it into this (new words in bold, the way *Dream Machines*
appears to set the words Nelson's own example adds):

> **In programming,** a monad is a **generic** type that wraps values, **and it** lets you chain
> steps that each **take a plain value and** return a wrapped value**, without unwrapping anything
> by hand between the steps.**

The words you already read never move. New ones open up around them, on both sides.

## Three words

- **skim**: a reply with every stretch closed. What you read by default.
- **full**: the same reply with every stretch open. Everything Claude wrote.
- **read**: what you actually read, the skim plus the stretches you opened.

The point of the plugin is the gap between them. Nelson's word for this was levels; ours is
*progressive attention*. Progressive disclosure is the interface deciding what to hide from you.
Here you spend your attention one phrase at a time, and because nothing you have read moves, you
never lose your place.

## What else it does

- **Stretches nest.** A long form can hold more stretches.
- **Streaming stays clean.** While a reply streams, stretches already show as their short forms.
- **Letters for the keyboard.** In the terminal's fullscreen layout, alt+↓ or ctrl+↓ puts a letter
  over each closed stretch in the latest three replies on screen that hold one (up to 26), and
  typing that letter opens it. alt+↑ or ctrl+↑ puts letters over each «, to close. Typing anything
  else puts the letters away and is typed as usual. Recalling a prompt, sending one, or pressing
  the same chord again puts them away too. As of Claude Code 2.1.301 a plugin has no chords of its
  own, and these are the ones that scroll the diff panel's file list, so while that panel is open
  with more than eight files they scroll it instead. As of macOS 26, ctrl+↑ opens Mission Control
  and ctrl+↓ shows the app's windows by default. If your terminal or system takes both chords of
  one action, bind another to `app:diffFileListDown` or `app:diffFileListUp` in the `Global`
  context of `~/.claude/keybindings.json`.
- **The marking is yours to pick.** Phrases you can open are underlined by default. In the
  terminal's fullscreen layout, run `/cc-stretch:style` and a toolbar above the prompt restyles
  every reply as you click: marks (`bold`, `italic`, `underline`, `strikethrough`, `dim`) and a
  highlight, which wins over `dim`. `save` keeps the style in two plugin settings, `marks` and `highlight`, which as of
  Claude Code 2.1.302 `/plugin`'s Configure options also changes; `close` puts the toolbar away and
  drops a style you tried but did not save. In the Claude desktop app, where cc-stretch draws
  stretches as links, there is no toolbar.

## Limits

- Clicks work in the terminal's fullscreen layout and in the Claude desktop app. Everywhere else every
  stretch shows open, so nothing is hidden: in other apps, and on the terminal's main screen, where a
  printed reply can't change. There the first such reply says why. As of Claude Code 2.1.300, some
  setups start on the main screen even with fullscreen set: `tmux -CC`, SSH from Windows, or a
  machine where an earlier fullscreen start failed. Starting Claude Code with
  `CLAUDE_CODE_NO_FLICKER=1` forces fullscreen there.
- On Windows, clicks are reported not to work yet
  ([#1](https://github.com/pro-vi/cc-stretch/issues/1)).
- In the terminal the plugin draws each paragraph that holds a stretch itself, and as of Claude
  Code 2.1.302 its transcript selects nothing in it. A drag there is the plugin's: the text it
  crosses is drawn inverse and copied when the button comes up, and it stays within that paragraph.
- Claude writes every level up front, so a reply costs about as many tokens as before. You read
  less; you don't pay less.
- The `{{short|long}}` markup shows as raw text wherever the plugin isn't loaded.
- Built on Claude Code's function-hook plugin API, which is early access and changes between
  releases. Checked in the terminal on macOS with Claude Code 2.1.292 to 2.1.294 and 2.1.300 to
  2.1.302, and in the Claude desktop app with 2.1.295.
- A terminal session that also has the desktop app attached shows the markup while a reply streams,
  because the desktop builds its links from it.

## Development

```
npm test            # claude plugin validate . && claude plugin test .
npm run typecheck   # the benchmark scripts
```

The launch film in `film/` is made from a real recorded session: `film/take.mjs` drives Claude Code
in a WezTerm pane and records its screen, and `film/compose.mjs` renders the film. Each release from
0.4.0 on has a film of its own: `film/releases/<version>/` holds its take script and cut, and
`node film/compose.mjs --release=<version>` renders it. Archive pictures in the launch film: photographs of the Hypertext Editing System at Brown University, October 1969, by Gregory Lloyd
(CC BY-SA 4.0, via Wikimedia Commons), and a photograph of Ted Nelson, 2010, by Beatrice Murch
(CC BY 2.0, via Wikimedia Commons). They are not stored in this repo; `film/CREDITS.md` lists each
source, its license and where to fetch it into `film/out/assets/`.

---

Not affiliated with Anthropic. Clawd belongs to Anthropic; stretchtext belongs to Ted Nelson.

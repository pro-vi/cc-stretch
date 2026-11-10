# Changelog

## 0.5.6 — 2026-11-10

- On a machine with managed settings, or on a Team or Enterprise account, cc-stretch now says why
  replies come with no stretches. As of Claude Code 2.1.322 its built-in plugin
  `cc-plugin-sec-default` runs there and keeps the system prompt out of reach of every plugin a
  person installs, so cc-stretch's guide never reaches Claude
  ([#3](https://github.com/pro-vi/cc-stretch/issues/3)). At the prompt after the first reply written
  that way, one dim line in the transcript says so, and that only the organization's administrator
  can change it, in its managed settings. cc-stretch does not send the guide another way, which
  would go around that control. The README's Limits names the limit. The line is not checked on a
  machine that has managed settings. The debug log that names the cause is @dcerisier's.
- `bench/depth.ts` counts, from session transcripts, how often a reply of 150 words or more holds a
  stretch, by how deep into its session it came, and only where the request carried the guide. On
  667 of my transcripts 1,137 of 1,171 such replies held one (97%), and 319 of 342 at 400k context
  tokens and over (93%).

## 0.5.5 — 2026-11-10

- On a light screen with Claude Code's theme set to `auto`, the words an opened stretch adds can
  be read. Before, they took the colours meant for a dark screen, pale on white
  ([#24](https://github.com/pro-vi/cc-stretch/issues/24)). As of Claude Code 2.1.322 a plugin reads
  the theme setting, not the theme the screen shows. So under `auto` or a custom theme the added
  words now take the theme's own colours, which Claude Code draws for the screen it shows: they are
  not softened, and a stretch opened earlier does not fade. Under a theme whose name starts with
  `light` or `dark`, nothing changes.
- A new setting, `palette`, picks the light or the dark stretch colours whatever the theme setting
  says: `light` or `dark`, in `/plugin`'s Configure options. Contributed by @lamemind in
  [#25](https://github.com/pro-vi/cc-stretch/pull/25).
- In a paragraph that holds a stretch, `_text_` is drawn in italics, as `*text*` is. Before, the
  underscores were drawn as written. `snake_case`, `__init__` and a lone `_id` stay as written
  ([#23](https://github.com/pro-vi/cc-stretch/issues/23)). Reported by @KrishivVora, whose list of
  cases the fix follows.
- There too, a `*` with no closing `*` on its line is drawn as written. Before, as in `*.ts`, it
  was not drawn and the rest of its line turned italic.

## 0.5.4 — 2026-10-24

- When a stretch's long form ends in a code block and Claude puts the stretch's closing braces on
  the block's closing line (```` ```}} ````), the stretch closes there. Before, the block and the
  stretch stayed open to the end of the reply, so in the terminal's fullscreen layout nothing after
  that stretch was drawn ([#21](https://github.com/pro-vi/cc-stretch/issues/21)). Based on a commit
  by @kylesnowschwartz.

## 0.5.3 — 2026-10-21

- cc-stretch loads again in Claude Code before 2.1.300, which the Claude desktop app can still
  bundle (checked in 2.1.293 and 2.1.295; clicks in the desktop app with them are unchecked). Since
  0.4.0 it named `prompt.change`, an event those versions lack, and they refused the whole plugin,
  so replies came as plain text ([#17](https://github.com/pro-vi/cc-stretch/issues/17)).
- A ctrl- or alt-click on an `http:` or `https:` link in a paragraph that holds a stretch opens it
  as the button comes up, as Claude Code 2.1.304 does in a paragraph without one; a ctrl- or
  alt-drag from it still selects. A `file:` link, which could name a program behind its words, is
  left to the terminal's own click, and a cmd-click, where the terminal keeps it, was the
  terminal's own already. The link opens with `open` on macOS, `xdg-open` on Linux and `rundll32`
  on Windows, and a toast says when it could not; the Linux and Windows commands are unchecked
  ([#18](https://github.com/pro-vi/cc-stretch/issues/18)). Based on a branch by @RaimundOstrowski.

## 0.5.2 — 2026-10-20

- When Claude makes a sentence's period the link to more, or a spot with no words at all, the
  sentence's words before it open it too, marked like the link, so there is a phrase to click
  rather than one cell. This is in the terminal's fullscreen layout; the Claude desktop app draws
  such a link as before.
- The note sent with your next prompt names such a link by those words, so period links after
  different sentences are told apart, and lists each one you left closed. Before, every period link
  was called `"."`, and a closed one could drop out of the note.
- A phrase you can open acts when the button comes up, so a drag that starts on it selects text, as
  a drag anywhere else does. In the words before a lone period a double-click copies a word, so a
  single click there opens its stretch half a second later, once no second click can follow.
- While a stretch grows, half-drawn code no longer shows stray characters for a moment.

## 0.5.1 — 2026-10-19

- A double-click in a paragraph that holds a stretch selects and copies the word under it, as
  Claude Code 2.1.303 does in a paragraph without one. Paths, flags and URLs come out whole,
  `#12806` keeps its `#`, and a full stop after a word stays out
  ([#15](https://github.com/pro-vi/cc-stretch/issues/15)). Contributed by @NansD in
  [#16](https://github.com/pro-vi/cc-stretch/pull/16).
- The plain cell 0.4.0 added after a paragraph that ends styled is gone. Nothing on screen changes.

## 0.5.0 — 2026-10-17

- You choose how closed stretches look. In the terminal's fullscreen layout, `/cc-stretch:style`
  puts a toolbar above the prompt that restyles every reply as you click: marks (`bold`, `italic`,
  `underline`, `strikethrough`, `dim`) and a highlight, either one colour from nine deep swatches or
  `tinted`, which puts each closed stretch on the colour its words take once open, blended 75% into
  the background. Under `tinted` a stretch's colour comes from its place in the reply, so it is the
  same before and after it opens. `save` keeps the style in two plugin settings, `marks` and
  `highlight`, which as of Claude Code 2.1.302 `/plugin`'s Configure options also edit; `close`
  puts the toolbar away and drops a style you tried but did not save. With nothing set, phrases stay underlined. Contributed
  by @gitsacha in [#12](https://github.com/pro-vi/cc-stretch/pull/12), reworked before merging.
- Text in a paragraph that holds a stretch can be selected and copied: a drag highlights the cells
  it crosses and copies their text on release, and a selection released outside the paragraph is
  taken down. Links in such a paragraph are drawn as links, underlined in the suggestion colour. A
  paragraph an earlier version drew no longer fails to draw after `/reload-plugins` updates the
  plugin in place. Contributed by @leftos in [#13](https://github.com/pro-vi/cc-stretch/pull/13).
- Saving a style while a reply streams no longer shows a long form's raw markup: as of Claude Code
  2.1.302 each setting written reloads the plugin, and the streaming filter now keeps its place
  across the reload. The updates of one reply, of which 2.1.302 runs up to three at once, are
  filtered in order. On 2.1.299 and 2.1.300 an older reply keeps its stretches after a save.
- The guide bench can write answers without a judge call, lay two guides' answers side by side,
  and run chosen tasks; five tasks join the list, and a new layout rule counts links with no words.
- A short film of what's new is attached to this release. `film/releases/0.5.0` records it in a
  smaller terminal, so its text draws larger.

## 0.4.0 — 2026-10-16

- Stretches open from the keyboard. In the terminal's fullscreen layout, alt+↓ or ctrl+↓ puts a
  letter over each closed stretch in the latest three replies on screen (up to 26), and typing that
  letter opens it in place; alt+↑ or ctrl+↑ puts letters over each «, to close. Typing anything else
  puts the letters away and is typed as usual; so do recalling a prompt, sending one, and the same
  chord again. As of Claude Code 2.1.301 a plugin has no chords of its own, so these are the chords
  that scroll the diff panel's file list.
- Lists stay lists. Claude writes each list item as a short stretch of its own, so every item stays
  in view and opens on its own, instead of the whole list hiding inside one stretch. The guide gains
  one line: "Stretch list items, not whole lists." In the guide bench, on the list tasks the line
  was written for, answers kept every item in view 4 times out of 6 with it and 0 out of 5 without
  it; on held-out list tasks both kept them 6 times out of 6.
- A paragraph whose last row ends in a stretch no longer passes its underline, or a letter's
  background, to the start of the next paragraph's first row (seen in Claude Code 2.1.302 in
  WezTerm).
- A short film of what's new is attached to this release. `film/releases/0.4.0` records and cuts
  it, and `node film/compose.mjs --release=<version>` renders a release's film from its take.

## 0.3.7 — 2026-10-16

- Drawing a reply no longer hangs when a stretch sits inside a short form written over several
  lines, or when the reply holds a character from U+E000 to U+E004, which the plugin used to mark
  links. Nerd Font icons sit in that part of Unicode, the Private Use Area; those characters are now
  drawn as written, and a link after them on the same line opens.
- The benchmark counts a short form written over several lines as the terminal draws it: already
  open. One measured reply's skim went from 102 to 260 words, so project B's skim is 21% of the
  original's words instead of 19%; all projects together stay at 17%.
- `bench/ab.ts` compares versions of the guide on fixed tasks: it checks each answer against the
  guide's layout rules and has a model grade it. `bench/README.md` explains how to run it and how a
  new finding about how Claude writes stretchtext joins it.

## 0.3.6 — 2026-10-16

- Chinese and Japanese stretches grow a character at a time around their short form, and Thai a
  word at a time, instead of going blank and then appearing whole. The words you already read stay
  where they are.

## 0.3.5 — 2026-10-16

- Tool calls are drawn by Claude Code itself again: a click on a finished group's one-line summary
  opens it, and a terminal that draws no links no longer prints `▸ show (https://cc-stretch.invalid/)`
  ([#1](https://github.com/pro-vi/cc-stretch/issues/1)). The plugin's own `▸ show` fold is gone.
  Contributed by @ppikkuaho in [#10](https://github.com/pro-vi/cc-stretch/pull/10).
- Chinese and Japanese replies wrap between characters, so a row no longer ends half empty, and
  punctuation such as ， or 。 or a Japanese small kana never starts a row. Korean wraps at spaces and
  Thai between words; Thai vowel and tone marks no longer take a cell of their own.
- While a reply streams, a stretch after a code span that runs over a line break shows as its short
  form instead of its raw markup ([#6](https://github.com/pro-vi/cc-stretch/issues/6)).
- A line such as "```python …" inside a code block no longer ends the block
  ([#7](https://github.com/pro-vi/cc-stretch/issues/7)).
- Emoji such as 🚀 count as two cells, so a click after one lands on the phrase under it
  ([#8](https://github.com/pro-vi/cc-stretch/issues/8)).
- `npm run bench:report` runs on a fresh clone without writing over the published numbers
  ([#9](https://github.com/pro-vi/cc-stretch/issues/9)).

#6 to #9 were reported by @rahul05ranjan.

## 0.3.4 — 2026-10-15

- In fullscreen on Claude Code 2.1.300, a new reply's stretches are underlined and open on a click
  again. That version hands the plugin a finished reply with its long forms already hidden, so the
  short forms showed as plain text; a session resumed with `--continue` was not affected
  ([#3](https://github.com/pro-vi/cc-stretch/issues/3)). Contributed by @danielhernik in
  [#5](https://github.com/pro-vi/cc-stretch/pull/5).

## 0.3.3 — 2026-10-15

- The guide sent to Claude is back to its 0.3.1 text. The line 0.3.2 added, asking that a short form
  never be a label such as "What changed.", did not reduce such labels when 11 real replies were
  rewritten under both guides, and it made the shortest reading slightly longer.

## 0.3.2 — 2026-10-15

- Claude is told that each short form must say something itself, the gist of its long form. A label
  for the long form, such as "Details." or "What changed.", is not a short form.
- The README gathers where clicks don't work, and why, under Limits.

## 0.3.1 — 2026-10-15

- On Claude Code's main screen, where a printed reply cannot change and so every stretch shows open,
  the first such reply now says why in a dim line, and how to get clickable stretches: `/tui
  fullscreen`, or starting Claude Code with `CLAUDE_CODE_NO_FLICKER=1` in setups that start on the
  main screen anyway ([#3](https://github.com/pro-vi/cc-stretch/issues/3)).
- The README names those setups.

## 0.3.0 — 2026-10-15

- In the terminal, the words a stretch adds are drawn in a colour of their own, a different one for
  each stretch you open. The one you opened last is brightest; the others fade a little, and all of
  them fade once you write your next prompt. Each `«` keeps its stretch's bright colour.
- Closed stretches are underlined in the text's own colour, no longer blue, so colour marks only what
  you opened.
- A `«` after a rule or a code block goes on a line of its own, in the terminal and in the desktop
  app. Before, it turned the rule into plain dashes or left the code block unclosed.

## 0.2.0 — 2026-10-14

- Clickable stretches in the Claude desktop app: each stretch is a link that opens in place, and `«`
  closes it. Contributed by @LGuillermoAngaritaG in
  [#2](https://github.com/pro-vi/cc-stretch/pull/2).
- Desktop links also work when a short form holds brackets, code, a link or hundreds of characters.
- The markup stays hidden while a reply streams even with a phone or VS Code attached. Only a session
  with the desktop app attached shows it.
- In the terminal, a short form written over several lines is drawn open. Before, drawing its
  paragraph ran past Claude Code's time limit.
- The note that tells Claude what you opened no longer lists a short form written over several lines
  as unopened. When nothing was clicked, it no longer implies the desktop app drew every stretch open.
- A bug report template asks for the Claude Code version, where you run it, and what you see.

## 0.1.0 — 2026-10-14

- First release: stretchtext replies in Claude Code's fullscreen terminal.

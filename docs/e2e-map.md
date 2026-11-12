# E2E map — cc-stretch

A Claude Code plugin: in the terminal's fullscreen layout a reply's stretches open in place when
clicked, and text in such a paragraph is selected by the plugin itself.

## Environments

| Environment | Reach | Ready when | Which build | Accounts | May write | Started by |
|---|---|---|---|---|---|---|
| local | `claude --plugin-dir <package> --settings '{"enabledPlugins":{"cc-stretch@cc-stretch":false}}'` (the `film/e2e/` checks also turn off every other `cc-stretch@<marketplace>` the person's settings enable), run with `CLAUDE_CODE_NO_FLICKER=1` in a WezTerm pane of 100 × 30 | the prompt's `❯` drawn under a rule | `<package>` is `git archive <sha>` of the commit under test, without `tests/` | the Claude Code login already on the machine | the clipboard, through a drag or a double-click: save its text first and put it back; the user's settings file, through the style toolbar's save: the checks put it back | you, or a `film/e2e/` check |

There is no staging or production: the plugin runs only inside a reader's own Claude Code.

As of Claude Code 2.1.302, `/reload-plugins` refuses a copy of the plugin under a folder's
`.claude/skills/` while cc-stretch from the marketplace is installed, whichever folder it was
installed for: the name "cc-stretch" is already taken by cc-stretch@cc-stretch, which takes
precedence. So a session under test is started with `--plugin-dir`.

## Scripted

`npm test` runs `claude plugin validate .` and the specs in `tests/` under Claude Code's test
harness. The harness stands in for the host, so it does not draw a terminal, move a pointer or
reload the plugin: drawing, clicks and drags are proved in a live session.

## Driving a live session

`openPane` in `film/recorder.mjs` holds the pattern. Open the pane with `wezterm cli spawn` and
`split-pane`; type with `wezterm cli send-text --no-paste`; click by sending SGR mouse sequences; read every
screen with `wezterm cli get-text --escapes` and parse it with `film/screen.mjs`, which keeps
colours, underline, inverse and OSC 8 links. Wait for what the screen should show, never a fixed
delay: under load a redraw after a press took over a second.

As of WezTerm 20260905-195314-b99b1ca2, `get-text --escapes` can give a paragraph's first row the
style the paragraph above ends in, such as an open stretch's underlined `«`, though the pane does not
draw it (`firstCarriedRow` in `film/screen.mjs` says why). `openPane` reads such a row again. To see
one row's own style by hand, read it alone with `--start-line` and `--end-line`.

As of Claude Code 2.1.302 a session reads a click's position in cells, counted from 1, until its
`--debug-file` log says `Mouse reports in pixels`, and in pixels from then on, at a cell's middle
pixel. In these runs the switch came once a reply holding a stretch was drawn, so a click sent in
pixels before that, such as on the style toolbar in a new session, is lost. Read the log before each
click, as `openPane`'s `mouse` does when it is given the log.

`film/e2e/` holds checks built on that pattern: `node film/e2e/<check>.mjs <package> <outDir>` starts
the session, runs steps that pass or fail on what the screen shows, writes every screen and a report
into `<outDir>`, and exits 1 if a step failed; `node film/e2e/render.mjs <outDir>` turns them into
`check.mp4`.

A session needs no window. As of WezTerm 20260905-195314-b99b1ca2 this starts a server with no
window, which reads none of the person's WezTerm config:

```sh
wezterm-mux-server -n --config 'unix_domains={{name="e2e",socket_path="<socket>"}}' \
  --config initial_cols=150 --config initial_rows=60
```

`wezterm cli` talks to it when `WEZTERM_UNIX_SOCKET` is `<socket>` and `WEZTERM_PANE` is `0`, and
`openPane` then drives its panes as it does a window's (checked with Claude Code 2.1.322).

To check a light screen, have the pane's command write OSC 11 with a light colour
(`printf '\033]11;#ffffff\007'`) before it starts the session: as of that WezTerm, the pane then
reports that background when asked. As of Claude Code 2.1.322 a session with `"theme":"auto"` added
to its `--settings` JSON draws the light theme there, and its dim grey says which theme it took:
`rgb(102,102,102)` on light, `rgb(153,153,153)` on dark.

## Features

### Open and close a stretch

- **Reach:** a reply whose paragraph holds a stretch; ask for "two stretches" in the prompt.
- **Drive:**
  1. Click a closed stretch (an underlined run that is not an OSC 8 link): as the button comes up,
     its words grow in place, tinted, ending in `«`.
  2. Click the `«`: the stretch shrinks back to its short form.
- **Writes:** nothing.
- **Gotchas:** with `CLAUDE_CODE_NO_FLICKER=0` the session draws on the main screen, where every
  stretch is drawn open and nothing is pressable.

### The colours of an opened stretch

- **Reach:** a reply with two stretches in one paragraph, opened one after the other, with `theme`
  added to the session's `--settings` JSON. As of Claude Code 2.1.322 the same JSON gives a
  `--plugin-dir` session its `palette` option, under `pluginConfigs` and keyed as the style
  toolbar's save writes it: `{"cc-stretch@inline":{"options":{"palette":"light"}}}`.
- **Drive:**
  1. Theme `auto`: the added words are the theme's own `warning` then `autoAccept`, and the first
     does not fade. On a light screen they are `rgb(150,108,30)` then `rgb(135,0,255)`, on a dark
     one `rgb(255,193,7)` then `rgb(175,135,255)`.
  2. Theme `auto` on a light screen with `palette` `light`: `rgb(83,59,17)` then `rgb(74,0,140)`,
     and the first fades to `rgb(143,128,100)` once the second is open.
- **Writes:** nothing.
- **Gotchas:** no check in `film/e2e/` drives these steps.

### Select text in a paragraph that holds a stretch

- **Reach:** a press on text or on a stretch, dragged, or two on one word, inside such a paragraph.
- **Drive:**
  1. Press, move with the button held, release inside the paragraph: the cells crossed are drawn
     inverse and their text is on the clipboard.
  2. Move the pointer into the paragraph and out of it: the highlight goes.
  3. Click a word twice, the presses less than 500 ms and at most a cell apart: the word is drawn
     inverse and on the clipboard. It is the word Claude Code 2.1.303 takes in a paragraph without
     a stretch, except that `#` stays in it and any full stops after it stay out.
- **Writes:** the clipboard; save its text first and put it back.
- **Gotchas:** the paragraph hears the pointer leave only after it has heard it inside, so a driver
  that only sends a motion outside never clears a highlight.

### Click the words before a lone period

- **Reach:** a stretch whose short form has no words, such as `It merged{{.|, and passed.}}` or an
  empty short form. `film/e2e/lead-in.mjs` has Claude write a fixed sample through
  `--append-system-prompt` and checks the steps below.
- **Drive:**
  1. The sentence's words before the link, back to its start, are underlined like the link; another
     link in the same sentence stays apart from them.
  2. Click those words: the stretch opens about half a second later, once a double-click can no
     longer follow.
  3. Double-click a word among them, or drag across them: the text is selected and copied, and the
     stretch stays closed.
  4. While another stretch in the paragraph grows, they stay underlined, and a click on them opens
     their stretch.
  5. Send a prompt: the note to Claude names the opened stretch by those words.
- **Writes:** the clipboard; the check keeps its text and puts it back.
- **Gotchas:** run the check from a folder Claude Code already trusts; it does not answer the trust
  question, which is the person's to answer.

### Links in a paragraph that holds a stretch

- **Reach:** a paragraph that holds a stretch and a URL or a markdown link, and a stretch whose
  long form links words its short form holds plain. `film/e2e/follow.mjs`
  has Claude write a fixed sample through `--append-system-prompt` and checks the steps below, with
  a stand-in `open` and `xdg-open` first on the session's PATH that write each URL to a file.
- **Drive:**
  1. Ctrl-click or alt-click the URL, underlined in the suggestion colour: it is opened, and
     nothing is selected.
  2. Click it plainly: nothing is opened, and nothing is selected.
  3. Ctrl-click a closed stretch: it opens, as on a plain click, and no URL is opened.
  4. Alt-click a link inside a closed stretch's short form: the link is opened, and the stretch
     stays closed.
  5. Click a stretch whose long form makes a link of words its short form holds plain: the link
     is drawn, and no screen of the growth shows its markup.
- **Writes:** nothing outside its `<outDir>`.
- **Gotchas:**
  - The check sends the modifiers itself; which ones a real click passes on is the terminal's
    choice.
  - Run the check from a folder Claude Code already trusts; it does not answer the trust question,
    which is the person's to answer.

### A guide on trial

- **Reach:** two sessions started with the `trialGuide` option naming a file, given under
  `pluginConfigs` as the palette option is above, each with `--session-id`: one id for which
  `takesTrialGuide` in `hooks/guide.ts` answers true, one for which it answers false.
- **Drive:** send one prompt in each and wait for the reply. `bun bench/live.ts --guide
  candidate=<file>` on the two transcripts then names the first session's guide `candidate` and
  the second's `shipped`. `node film/e2e/trial.mjs <package> <outDir>` does all of it (checked
  with Claude Code 2.1.322).
- **Writes:** nothing but the sessions' own transcripts, which stay where Claude Code wrote them.
- **Gotchas:**
  - A session with nothing drawing, such as `claude -p` as of Claude Code 2.1.322, is sent no
    guide at all, so the check needs a terminal.
  - Run the check from a folder Claude Code already trusts: it does not answer the trust question.

### The style toolbar

- **Reach:** `/cc-stretch:style`; typing `/cc-stretch` lists it. `film/e2e/style.mjs` and
  `film/e2e/tinted.mjs` check most of the steps below, and besides them dim on a highlight, the
  letters, a reopened toolbar and a drag across a link; `film/e2e/stream-save.mjs` saves while a
  reply streams and checks that no screen shows a long form's markup.
- **Drive:**
  1. Run the command: `marks  bold italic [underline] strikethrough dim close` and
     `highlight  [no highlight] colour tinted` appear above the prompt.
  2. Press a mark: every closed stretch restyles at once, and `reset save` appear before `close`.
  3. Press `colour`: nine deep swatches appear on the highlight row. Press one: every closed stretch
     sits on it, its text turned light.
  4. Press `tinted`: the swatches go, and each closed stretch sits on the colour its words take once
     open, by its place in the reply. Open one: under a theme setting that names light or dark, its
     words and its `«` are in that colour.
  5. Press `reset`: back to the saved style.
  6. Press `save`: the marks row reads `saving` until Claude Code prints that the plugin reloaded;
     then the toolbar shows the saved style with nothing to save.
  7. Press a mark, then `close`: the toolbar goes, the reply returns to the saved style, and a
     toast says the try was not saved.
  8. Press Claude Code's own `[-]` at the toolbar's right (as of 2.1.302): the panel collapses to "plugin panel
     hidden"; clicking that line brings it back.
  9. On the main screen (`CLAUDE_CODE_NO_FLICKER=0`) the command says the toolbar is drawn in
     fullscreen.
- **Writes:** save writes `marks` and `highlight` under `pluginConfigs` in the user's settings
  file (as of Claude Code 2.1.302); a plugin loaded with `--plugin-dir` is keyed `cc-stretch@inline`.
  The checks keep the file at the start and put it back when that entry is its only change.
- **Gotchas:**
  - As of Claude Code 2.1.302, a session started with `--setting-sources project,local` cannot read
    what save writes, so after the reload it shows the default style.
  - The checks start from the default style: a `cc-stretch@inline` entry already in the user's
    settings fails their first step.
  - The checks set no theme, and `film/e2e/tinted.mjs` expects the dark palette's colours: under a
    theme setting whose name does not start with `dark`, its step that opens a stretch fails.

# Backlog

Tickets awaiting triage. Verdicts: architect | direct | drop | defer | pending.
Checkbox marks a ticket consumed (plan written, or direct commit landed).

## Tickets

- [ ] **plugin-folder** — an install copies the plugin, not the repo's dev tools · verdict: direct
- [ ] **renderers-use-drawn-as** — every renderer draws a stretch the way `drawnAs` says · verdict: direct
- [ ] **keyboard-item-words** — the list rule finds the reply item by the words a reply uses for it · verdict: direct
- [ ] **judge-controls** — a grading run whose judge misgrades a known answer is refused · verdict: direct
- [ ] **bench-one-copy** — each prompt, flag list and scoring rule in the bench exists once · verdict: defer · promote when: the README's numbers are next rerun
- [ ] **letters-with-ime** — letters work with an input method on, or the README says to switch it off · verdict: pending · needs: a live session with a Chinese or Japanese input method
- [ ] **bench-outside-git** — the bench runs from a source archive · verdict: defer · signal: `Command failed: git rev-parse HEAD` · promote when: someone runs the bench from an archive
- [ ] **replay-counts-recomputed** — published replay counts follow the current measurement · verdict: defer · signal: none · promote when: a change to what the skim counts
- [ ] **nested-key-separator** — no two stretches in a reply share a key · verdict: defer · signal: none · promote when: a stretch opens a different one, or opens in its holder's colour
- [ ] **old-replies-live** — on Claude Code 2.1.300, a reply from before a style save keeps its stretches · verdict: pending · needs: a live session on Claude Code 2.1.299 or 2.1.300
- [ ] **theme-read** — under `auto` or a custom theme, the tinted highlight follows the screen and a stretch opened earlier fades · verdict: defer · signal: none · promote when: Claude Code gives a plugin the theme the screen shows, or a reader under `auto` on a light screen reports dark highlights
- [ ] **tinted-256** — the four tinted highlights stay four colours on a 256-colour terminal · verdict: defer · signal: none · promote when: a reader reports two tinted stretches in one colour
- [ ] **tinted-neighbours** — stretches side by side on screen differ in tinted colour · verdict: pending · needs: a design call on whether neighbours on screen must differ
- [ ] **open-colour-gap** — opened words are in their colour from their first frame · verdict: defer · signal: none · promote when: the gap shows in a recorded take
- [ ] **wrap-across-styles** — a style change inside a word is never a place to break a row · verdict: direct · signal: a row that starts with `.` after a link, or a pressed word that moves a row on the first frame of opening · promote when: now; it breaks the promise that words on screen stay where they are
- [ ] **refusal-as-answer** — a call the safety filter stopped counts as a failed call, never as an answer · verdict: direct · signal: an `ok` row whose text says it was "stopped by a safety classifier"
- [ ] **lead-in-bold-sentence** — a bold sentence ends the words before a lone period, as a plain one does · verdict: direct
- [ ] **nested-note-names** — the note names a lone period inside an opened long form by its words, not "." · verdict: direct
- [ ] **dead-letter** — a stretch with nothing on screen to press takes no keyboard letter · verdict: direct
- [ ] **growth-finishes** — a stretch still growing goes on growing when the reader opens or closes another · verdict: defer · signal: none · promote when: the jump shows in a recorded take, a reader reports it, or the growth code next changes
- [ ] **posts-hold-opens** — the note names every stretch the reader opened, however close together two presses land · verdict: pending · needs: how far apart a click's press and release reach the terminal, a trackpad tap included
- [ ] **desktop-lead-in** — in the desktop app, the words before a lone period open its stretch too · verdict: pending · needs: a look at the desktop app: what a drag or double-click that starts on link text does, and what `[](…)` draws
- [ ] **nested-lead-in** — a lone period inside an opened long form has words to click · verdict: defer · signal: none · promote when: a reader reports a one-cell period in an opened detail
- [ ] **reading-note-test** — a bench task shows whether Claude says again what the reader left closed, once the note tells it · verdict: defer · signal: none · promote when: a guide change touches the reading-note paragraph, or the note's wording changes
- [ ] **fresh-held-out** — an adoption is decided on tasks no guide variant was shaped on · verdict: defer · signal: none · promote when: a variant is about to be adopted on task results read while shaping it
- [ ] **unreported-outcomes** — a long form never states an outcome its evidence does not give · verdict: direct
- [ ] **post-pass-stretcher** — a hook turns Claude's finished plain reply into stretchtext · verdict: pending · needs: a live check that a `turn.step` rewrite is shown and recorded
- [ ] **opened-from-doc** — `openedFrom`'s comment in `bench/measure.ts` describes the note as 0.5.2 writes it · verdict: defer · promote when: the next change to `bench/measure.ts`
- [ ] **label-short-forms** — a short form over several sections states their gist, not their topic · verdict: defer · signal: none · promote when: a change with a mechanism none of the six tried shares
- [ ] **closing-gist-kept** — the closing stretch's short form is in the block it opens · verdict: pending · needs: what the reader sees when such a stretch opens
- [ ] **desktop-first-request** — the guide reaches the desktop app's first request · verdict: pending · needs: whether the desktop app's `ui_attach` arrives before its first request
- [ ] **long-session-drift** — Claude keeps writing stretches deep in a long session · verdict: defer · signal: `node bench/depth.ts` on a reader's transcripts · promote when: its counts show long replies that were sent the guide going plain
- [ ] **copy-on-select** — the plugin's selection copies when Claude Code's own would · verdict: pending · needs: a design call on whether a drag or double-click in a paragraph the plugin draws follows "Copy on select"
- [ ] **windows-link-opener** — on Windows a ctrl- or alt-click on a link in a paragraph that holds a stretch opens it · verdict: pending · needs: a live session on Windows
- [ ] **desktop-before-2.1.300** — the desktop app on a bundled Claude Code before 2.1.300 shows stretches with 0.5.3 · verdict: pending · needs: a look at the desktop app while it bundles 2.1.295 or 2.1.299
- [ ] **live-checks-theme** — the live checks pass whatever theme the person has set · verdict: direct
- [ ] **marks-while-growing** — while a stretch grows or shrinks, no frame draws a mark the finished text hides, or hides one it draws · verdict: defer · signal: none · promote when: a stray backtick, or words drawn italic that finish upright, shows in a recorded take, or a reader reports one
- [ ] **unpaired-bold** — a `**` with no closing `**` on its line is text · verdict: defer · signal: none · promote when: a reader reports a line gone bold after a `**`

## plugin-folder

As of Claude Code 2.1.302, an install from GitHub copies every tracked file, because
`.claude-plugin/marketplace.json` gives the plugin as `"source": "./"`, and it runs `npm install` on
the dev `package.json`. A fresh install measured 48 MB: `node_modules` 45 MB (typescript and
playwright), `docs/` 1.8 MB, then `bench/`, `film/` and `tests/`. The plugin itself (`hooks/`,
`types/`, `.claude-plugin/`) is about 110 KB.

Move the plugin's manifest, `hooks/` and `types/` into a folder of their own and point the
marketplace at it. Tests, bench and film import `../hooks`, and `bench/ab.ts` hashes
`hooks/parse.ts` by path into each run's manifest (`ASKING_CODE`), so make the move when no bench
run needs to resume.

## renderers-use-drawn-as

`compose` in `hooks/reply.tsx`, and `linkedMarkdown` and `writeOpen` in `hooks/register.tsx`, each
decide on their own whether a stretch is drawn as text, open or a link. `drawnAs` in
`hooks/parse.ts` says it once, and `hooks/layout.ts` and the bench use it. `writeOpen` does not
check `isClosed`, so where every stretch is drawn open, an unclosed `{{a|b` shows `b`; everywhere
else it shows `a`. Derive all three from `drawnAs` and extend the parity test in
`tests/drawn.test.tsx` to the desktop path. PR #12, merged in a65fbb8, changed both files; the three
functions are still there after it.

## keyboard-item-words

`KEYBOARD_ITEMS` in `bench/tasks.ts` knows the reply item only as `client`, `click` or `in-reply`.
The `keyboard-rewrite` task's own reply calls it "The reply itself.", so an answer that keeps that
item as a stretch of its own breaks `items-stay-visible`. Seen in the bench run comparing the 0.3.7
and 0.4.0 guides, 0.4.0 guide, repeat 1, where an override records it. Add `reply itself` to that
item's words. A run frozen on the old task then refuses to resume.

## judge-controls

A grade counts today when the judge's answer parses, so a judge that says yes to everything, or
reads "never" backwards, passes every check. Add control answers with a known grade to each run
(one that leaves out a must-know point, one that makes a forbidden claim), and refuse a run's
grades when the judge gets a control wrong.

## bench-one-copy

- `recall` and the rewrite prompt are in both `bench/ab.ts` and `bench/replay.ts`.
- The code that turns verdicts into scores is in both `bench/report.ts` and `bench/coverage.ts`.
- `bench/replay.ts` spells out the `claude -p` flags that `claudeArgs` in `bench/grading.ts` builds.

`replay.ts`, `report.ts` and `coverage.ts` feed the README's numbers, so change them when those
numbers are rerun, and the numbers change once.

## letters-with-ime

Not checked: while an input method composes, a letter key may stay in the composition, so only
committed text such as 啊 reaches `prompt.edit`. That matches no letter, so it would be typed and
the letters would go away. If a live check shows this, the README's letters paragraph says to
switch the input method off first.

## bench-outside-git

- Problem: `bench/ab.ts` runs `git rev-parse HEAD` to record the revision in a run's manifest, and
  throws outside a git checkout.
- Failure sequence: on a `git archive` of v0.3.7, `bun bench/stub/check.ts` failed three cases with
  `fatal: not a git repository`; a clone of the same tag passed.
- Signal: `Command failed: git rev-parse HEAD` in the run's output.
- Promote when: someone reports running the bench from an archive, or the bench is documented for
  use outside a clone.
- Fix shape: a resumed run does not compare the revision, so record it as unknown when git fails.

## replay-counts-recomputed

- Problem: `bench/out/replay.jsonl` stores the skim and full word counts taken at replay time, and
  `bench/report.ts` publishes them as stored. A change to how `bench/measure.ts` or
  `hooks/parse.ts` counts the skim leaves the published numbers as they were.
- Failure sequence: ec6a1b2 began counting a short form over several lines as drawn open, and
  `bench/results.md` kept project B at 19% until b0585db recomputed the rows by hand (21%).
- Signal: none. Nothing compares the stored counts with what `bench/measure.ts` gives today.
- Promote when: the next change to `bench/measure.ts` or `hooks/parse.ts` that changes what the
  skim counts. Neither file changed between b0585db and ec1b1d7.
- Fix shape: `bench/report.ts` recomputes skim and full from each row's saved text with
  `bench/measure.ts`; rows without text (the native rows) keep their stored counts.

## nested-key-separator

- Problem: a stretch's key joins its short form to its parents' with ` › ` (`KEY_SEPARATOR` in
  `hooks/parse.ts`), so a short form that itself holds ` › ` can take the key of a nested stretch.
- Failure sequence: `{{a › b|x}} {{a|{{b|y}}}}` keys as `a › b`, `a`, `a › b` (checked at
  ec1b1d7). The open list and the keyboard letters address stretches by key, so they cannot tell
  the first stretch from the nested one.
- The colour an opened stretch takes has the same cause. The open order finds a stretch's holder with
  `parentOf(opened.key)` in `hooks/register.tsx`. In `{{p|x {{q › r|y}}}}` the nested key is
  `p › q › r`, whose holder reads as `p › q`, a key no stretch has, so the nested stretch is not kept
  off p's colour. The tinted highlight passes the holder down the parse and is not affected.
- Signal: none. Nothing reports two stretches with one key.
- Promote when: someone reports a stretch that opens a different one, or keys change for another
  reason.
- Fix shape: join keys with a character a short form cannot hold, such as a noncharacter. That
  changes every nested stretch's key, so open lists saved before it read nested stretches as closed
  once. The open order can take a stretch's holder from the parse, as `placesOf` does.

## old-replies-live

Claude Code 2.1.299 and 2.1.300 hand the AssistantMessage site a reply as the streaming filter left
it, with its long forms gone. `rawOf` in `hooks/register.tsx` finds the markup again: a reply the
plugin did not keep, such as one from before a style save reloaded the plugin, is found by reading
the session's messages once per load. Only the plugin test engine covers this; 0.5.0's live checks
ran on 2.1.302. Acceptance: on 2.1.300, a reply drawn before `/cc-stretch:style` and a save still
shows its stretches after the save.

## theme-read

- Problem: as of Claude Code 2.1.322 the `theme` row from `$.config.list` holds the setting, and the
  plugin API has no call for the theme the screen shows. Under a setting that names neither light
  nor dark (`auto`, a `custom:<name>` theme, a theme row another plugin hides, a list that fails)
  the hooks module cannot pick a palette, unless the `palette` setting names one
  ([#24](https://github.com/pro-vi/cc-stretch/issues/24)).
- Failure sequence: theme `auto` on a light screen, with the tinted highlight. Closed stretches sit
  on the dark palette's near-black highlights (`#403002`, `#2c2240`, `#122623`, `#361e16`), readable
  with light text but not the pale ones meant for a light screen. On either screen the opened words
  are as the README's "Colours for your screen" says: the theme's own colours, none of them faded.
- The read runs on every draw of a reply that is tinted or has an open stretch. A theme change is
  not one of the render hook's triggers, so a reply keeps its palette until it redraws for another
  reason, and two replies can show two palettes. The read's cost per draw is unmeasured.
- Signal: none.
- Promote when: Claude Code gives a plugin the theme the screen shows, or a reader under `auto` on
  a light screen reports dark highlights.
- Fix shape: none until a plugin can read the theme the screen shows; then the palette follows it.
  Whether the read can leave the draw depends on Claude Code telling a plugin the theme changed;
  unchecked.

## tinted-256

- Problem: the tinted highlights are 24-bit colours. A terminal that shows 256 colours draws each as
  the nearest of its own.
- Failure sequence: by ansi-styles' 256-colour formula, on dark places 0 and 3 (`#403002`,
  `#361e16`) both become index 58, and on light places 0 and 2 both become 188. The first and fourth
  stretch on dark, or the first and third on light, then share a highlight. Computed, not seen on a
  256-colour terminal.
- Signal: none.
- Promote when: a reader reports two tinted stretches in one colour.
- Fix shape: choose the highlight mixes so the four land on four different 256-colour indexes on
  each theme, and test that with the same formula.

## tinted-neighbours

Under tinted, `placesOf` in `hooks/register.tsx` counts places in reading order, depth first, so
stretches hidden inside a closed one use up colours. In `A {{a|x {{b|1}} {{c|2}} {{d|3}}}} and
{{e|4}}.` a takes place 0 and e place 4, so the two closed stretches on screen share a colour. In
`{{p|p {{a|a {{a1|x}} {{a2|y}}}} {{b|b1}}}}` a takes 1 and b 5: the skip past p's colour lands on a's,
so the two siblings in p's open text match. Counting this way gives each stretch one colour before
and after it opens; making neighbours on screen differ is weighed against that.

## open-colour-gap

- Problem: the words a stretch adds take their colour from `tints`, which holds only stretches already
  in the open order. The hooks write that after the reply's Client posts the press, so until the
  next draw the growing words are drawn with no colour, in every style. Older than 0.5.0.
- Signal: none. The tests wait 2000 ms before reading colours, so they do not see it, and the gap is
  untimed.
- Promote when: the gap shows in a recorded take, or a reader reports it.
- Fix shape: under tinted the colour is known before the press, so the Client can be given each
  stretch's word colours along with its highlight.

## wrap-across-styles

- Problem: `wrap` in `hooks/layout.ts` finds break points in each styled run on its own
  (`for (const run of runs) for (const text of run.text.split(/( +)/).flatMap(breakables))`), and
  `inline` starts a run at every style change, so a link, code span, URL or bold run that ends inside
  a word can split it. `NO_START`, the rule that closing punctuation never starts a row, works only
  inside one run, so the 0.3.5 changelog's "punctuation such as ， or 。 … never starts a row" fails at
  a style change. The `Run.link` comment and the guards in `leadInsOf` that skip marking words
  "because it would add a break" work around this.
- Failure sequence: at 20 columns `It merged 3 days ago{{.|…}}` draws its `.` alone on the next row,
  as 0.5.1 did; at 15, `**12**ms` splits into `12` and `ms`; at 10, `一二三四**五**。` starts a row
  with `。`. While a stretch grows, `grow` draws its short form as plain text, so the style change
  goes and the pressed word can move a row on the first frame: at 18 columns `Then run the tests` /
  `.` becomes `Then run the` / `tests.`. Over the 3,572 saved paragraphs at every width from 40 to
  120: 1,826 breaks inside a word (0.62% of layouts), 1,296 of them putting closing punctuation at a
  row's start, and the first frame of opening moved rows in 47 of 33,306 checks.
- Signal: none live; a kit test of the four cases above fails on 1de5f05.
- Fix shape: find break points in the line's whole text, then split each piece back across the runs
  it covers; a word wider than a row still breaks at its style changes, so `(https://…)` is not cut
  mid-URL. A prototype of this (68 lines in, 23 out) passed all 198 tests and the four cases above,
  changed rows only in layouts that had a break inside a word, moved no row on a first frame, and
  took a layout from 61 µs to about 68 µs. Once it lands, the `leadInsOf` guards can be tried
  without, to give more lone periods words to press.

## refusal-as-answer

- Problem: as of Claude Code 2.1.304, when the safety filter stops a reply, Claude Code tries once
  more with a note saying so, and the model's answer to that note ("My previous response to this was
  stopped by a safety classifier, so I can't …") comes back as a normal result. `resultOf` in
  `bench/grading.ts` accepts it and the run writes `status: "ok"`, though `bench/README.md` says a
  failed call never counts as a grade. A resume reuses the text instead of trying again.
- Failure sequence: counted on 2026-10-20, 12 such `ok` rows in the rewrites of a label-slot corpus
  run and 1 in the answers of a drafting run, that one graded with every `know` point "no".
  On the corpus path the recall bar drops them as broken rewrites, not failed calls. In the
  label-slot baseline the refused replies were the long ones (median 724 words, against 404–471 for
  the rest), so that run's sample leans short.
- Signal: an `ok` row whose text holds "stopped by a safety classifier".
- Fix shape: in `claude()` in `bench/ab.ts`, which is not part of a run's hashed asking code, throw
  when the result's events show a refusal stop, or, if they show none, when an `ok` text holds that
  sentence; add a refusing case to `bench/stub/claude` and `bench/stub/check.ts`. Then delete the
  refusal rows and resume, asking first in a folder another session is running.

## lead-in-bold-sentence

`leadInOf` in `hooks/layout.ts` takes a bold phrase whole only when no sentence ends inside it, but
its check, `pieces.slice(start, k)`, leaves out the bold's last piece. So in
`**Fix main's e2e first.** It unblocks #218{{.|…}}` both sentences open the stretch, where
`I changed a.ts. The tests pass{{.|…}}` gives only the second. 1 of 3,572 saved paragraphs has
it. Fix shape: stop at a bold phrase that ends a sentence once words after it are taken; pin
`**Done.** The tests pass` to `The tests pass` and `**Done.**` alone to `**Done.**`.

## nested-note-names

`namesOf` in `hooks/layout.ts` names a link inside a link's long form by its bare short form, so
when the reader opens the outer stretch and then a lone period inside it, the note to Claude still
quotes `"."`, and the 0.5.2 changelog's "Before, every period link was called "."" does not hold
there. 9 of the 90 lone-period links in saved paragraphs sit inside a long form, in 6 paragraphs.
Fix shape: walk every long form that is drawn at all (`drawnAs(part) !== 'text'`) instead of the
`stretches(…)` loop, and test that a nested `{{.|…}}` is named by the sentence before it. A stretch
opened before an in-session upgrade then reads as unopened once.

## dead-letter

A stretch whose short form is empty, with no words before it (at a paragraph's start, or right
after another stretch), draws nothing to press. `lettersFor` in `hooks/register.tsx` still gives it
a letter, since `targetsIn` looks only at `drawnAs`: the letter is drawn nowhere, the next stretch
takes the one after it, and typing the unseen one is swallowed. The test "a stretch with an empty
short form and no words before it draws no link and opens from no letter" in
`tests/cc-stretch.test.tsx` pins the swallowed key, so the fix changes that test on purpose. Rare:
the saved replies hold 2 such stretches. Fix shape: leave out of `lettersFor` a target whose name
from `namesOf` is empty.

## growth-finishes

- Problem: `hooks/reply.tsx` keeps one growth per paragraph (`State.growth`), and opening or closing
  another stretch replaces it, so a stretch still growing shows the rest of its long form and its «
  in one frame. The single growth dates from the first commit. Since 0.5.2 a click on lead-in words
  opens about 0.5 s after the press, so two quick clicks on two such sentences overlap more often.
- Failure sequence: in the test kit on 0.5.1 and 0.5.2, a 32-word long form 13 words in after
  320 ms showed all 32 words one frame after a press on another short form. After two quick clicks on
  lead-in words in 0.5.2, the first went from 20 to 27 words in one frame; opened alone, it never adds
  more than 2.
- Signal: none; no recorded take shows it yet.
- Fix shape: a growth per key, each advanced on the tick and dropped when its stretch or one holding
  it closes. A stretch still shrinking can stay closed at once, as now.

## posts-hold-opens

- Problem: as of Claude Code 2.1.304 a Client's post waits for a 16 ms timer, and a later post from
  the same Client replaces one still waiting (read in the 2.1.304 binary; the API types written by
  2.1.302 describe the same). `hooks/reply.tsx` posts the open list, which survives being replaced,
  with `opened`, the one stretch just opened, which does not. When two opens in one paragraph post
  within one flush, `seen` misses the first, so the note says the reader did not open it, and it gets
  no colour count.
- Failure sequence: in 0.5.2 a press after a click on lead-in words opens their stretch as the button
  goes down, and a short form opens as it comes up; when that press and release land in one flush,
  the first open is lost. A harness keeping only the last post per flush gave
  `opened "The fix is one line.". They did not open "It merged 3 days ago."` with both drawn open.
  The test kit delivers every post, so it cannot show this.
- Signal: none live.
- Fix shape: the Client posts state only, the name and source of each stretch in its open list; the
  `ui.message` hook takes as just opened each key the stored list lacks.

## desktop-lead-in

As of 0.5.2 the desktop app draws a closed stretch with no words of its own as `[.](…/open/N)`, and
an empty short form as `[](…/open/N)`, which by CommonMark draws nothing. `linkedMarkdown` in
`hooks/register.tsx` never calls `withLeadIns`; only `compose` in `hooks/reply.tsx` does, though the
note already names such a stretch by its lead-in words on both surfaces. A scratch copy that turned
lead-in words into `[words](…/open/N)` passed all 198 tests. Not checked: what the desktop app does
with a drag or double-click that starts on link text; the terminal waits out a double-click to keep
selection working. Lone periods are 6 of 1,478 stretches in saved real-session replies.

## nested-lead-in

`compose` draws an opened long form with `grow`, which finds the short form's words in it word by
word; a lead-in mark there would break that match, so a lone period inside an opened long form draws
as one cell, as before 0.5.2: 9 of 90 lone-period links in saved paragraphs, 1 of them from a real
session. Fix shape: give `grow` the lead-in spans and put the link marks around their visible words,
or mark them only once growth ends. Either touches the code where 0.5.2's growth bug was, so rerun
the corpus and fuzz checks that release used.

## reading-note-test

Every bench task is one `claude -p` call, so nothing checks that Claude acts on the guide's last
paragraph: "Do not assume they read a long form they did not open; if it matters to what they asked,
say it again." The tests check
the note's text, never Claude's reply to it. Fix shape: a task with an earlier turn, its reply, what
was opened, and a follow-up that needs a closed detail, with the note built by `hooks/register.tsx`'s
code rather than retyped; arms `g0` and `g0` without that paragraph. It touches the hashed
`bench/grading.ts`, so older run folders refuse to resume. About 36 writer and 108 judge calls.

## fresh-held-out

The four `heldOut` tasks in `bench/tasks.ts` were read while `shortened-growth`,
`shortened-growth-words` and `shortened-growth-last-words` were shaped, as the criterion written for
each of those runs says, and the report splits only the layout-rule table by `heldOut`. Fix shape: write
four to six tasks before looking at any candidate's answers, keep them in a `--tasks` file run in
their own folder once, at the adoption decision; adding them to `TASKS` would make every 24-task run
folder refuse to resume.

## unreported-outcomes

`unreported-check` in `bench/tasks.ts` gives a check that ran with no result reported, and forbids
"The CLI smoke run passed." In saved runs (Opus 5.5 writing, Sonnet 5.5 judging, Claude Code
2.1.302) the judge found that claim in 8 of 9 `g0` replies, 7 of 12 under the shortened guides and
0 of 3 under `draft-in-thinking`; no other task drew a forbidden claim. One task, found after the
fact: a lead. Fix shape: four to six tasks where a check ran and its result is not given, two held
out, the pass test written first; arms `g0`, `draft-in-thinking`, and one line saying what to write
where the evidence is silent.

## post-pass-stretcher

Per the plugin API types written by Claude Code 2.1.302, a `turn.step` hook may rewrite a reply's
text chunks, and what leaves it is both shown and recorded; it could hold the reply until the step
ends, ask `$.model.complete` to add stretches with the guide as its system prompt, and yield that, at
the cost of streaming and one more call per reply. Saved rewrites of plain replies under the shipped
guide still hide sections behind links (14 links, 4 of them labels), and gave lone-period links at
about the in-flow rate, so seeing the whole reply first is not by itself a fix. Not checked live.

## opened-from-doc

`openedFrom`'s comment in `bench/measure.ts` describes the note's names as they were before 0.5.2,
when a lone period was named `"."`; `bench/opened.ts` maps 0.5.2's names back. The file is part of a
run's hashed asking code, so the comment changes with the next change made there for another reason.

## label-short-forms

A label short form only names what its long form holds ("What the note says.", "Install
details."). Live replies put them on links that hide several sections or a list, most of them in
one session whose replies relay another session's work. Measured on 2026-10-20 by replaying requests recorded
in live sessions (Opus 5.5 at xhigh effort, Claude Code 2.1.301 to 2.1.304, `LABELS` judged by Sonnet
and again by Opus), no change moved them:

- `sections-gist` and `sections-within`: links on sections judged labels 9 of 13 and 10 of 16,
  against 10 of 19 under `g0`.
- `sections-open` and `sections-woven`, a worked example of a stretch over several sections: text
  replies holding a label 62% and 68%, against 62% under `g0`, on 21 turns.
- A rule appended to the per-prompt note: 10 of 23 links judged labels, against 12 of 27.
- Naming the last reply's label short forms in the per-prompt note: 14 of 52 against 26 of 57 on
  eight requests from two sessions, then, preregistered, 30 of 108 against 26 of 112 on 20 new
  requests from 10 turns.

The 24 tasks rarely produce such a link (3 in 216 replies), and rewriting finished replies does not
either (9 in 22 replies, with the longest replies refused by the safety filter), so a restart needs
the replay harness, which is not in the repo. Before relying on it:

- Claude Code 2.1.304 refuses a `--settings` file over 2 MiB, and the rebuilt request travels in
  one as `CLAUDE_CODE_EXTRA_BODY`, so a larger request cannot be replayed this way.
- A request late in a turn is replayed with everything Claude did earlier in the turn kept as it
  was, so a replay measures one edited request, not what shipping the change would do.
- Every guide line tried roughly doubled tool requests in replays (10 to 18 and 21 of 36; 13 to 29
  and 26 of 63); changes to the note did not (9 to 13 of 60). Replay a neutral line first, to see
  whether any edit to the system prompt does it.

## closing-gist-kept

In 24 of 35 replies written under the shipped guide (replays of live requests, Opus 5.5, Claude
Code 2.1.304), the reply's last stretch breaks keeps-short-words: its short form, such as "Status:
Haiku run still going; /observe in a real session is next.", is not in the status block it opens.
The guide asks for that short form to be "a one-line gist of the block" and for every long form to
keep its short form's words. Not known: why the words go missing, and what the reader sees when
such a stretch opens.

## desktop-first-request

A report in [#3](https://github.com/pro-vi/cc-stretch/issues/3) guesses that the desktop app gets
no guide because it has not connected by the first request. Checked on Claude Code 2.1.322 in a
`claude -p` session fed stream-json, which the report says is how the desktop app runs Claude Code,
with a `ui_attach` sent as a control request:

- The system prompt is composed again for every prompt, before `prompt.submit`.
- With no client attached it holds no guide, whatever `CLAUDE_CODE_ENTRYPOINT` says.
- A client attached before the first prompt gets the guide in the first request. One attached after
  it gets the guide from the next prompt on.

So there, at worst, the first reply comes without stretches. Not checked: when the desktop app
sends its `ui_attach`; the app at 4.4212.0 holds code that sends one. In one desktop-app session on
2.1.295, all three long replies had stretches. A Team or Enterprise account would explain the
report as well (README, Limits).

## long-session-drift

A report in [#3](https://github.com/pro-vi/cc-stretch/issues/3) says that deep in a long session
Claude stops writing stretches, from one or two runs per setup, and proposes a reminder beside the
prompt after a reply with none. `bench/depth.ts` counts it from transcripts. On 667 transcripts of
mine (Claude Code 2.1.300 to 2.1.322, nearly all Opus 5.5):

- 1,137 of 1,171 long replies whose request carried the guide hold a stretch (97%): 92 of 92 under
  100k context tokens, 319 of 342 at 400k and over (93%).
- After a plain long reply, the next long one holds a stretch 18 times of 26.
- 5 of 2,832 long replies whose request carried no guide hold one. Those are sessions run headless
  or without the plugin; a count that does not read the request takes them for sessions where
  Claude stopped.

So no reminder is added. Not checked: a terse output style, which the report's sessions may have
used; the guide bullet it proposes names one.

## copy-on-select

A drag or double-click in a paragraph the plugin draws copies its text when the button comes up.
With "Copy on select" off (`copyOnSelect: false`), Claude Code 2.1.303's own double-click copied
nothing in a live run, so a double-click copies in a paragraph the plugin draws and not in the next.
Not checked: the same with the setting on, and whether the plugin API exposes it.

## windows-link-opener

On Windows the hooks module opens a link with `rundll32 url.dll,FileProtocolHandler <url>`, chosen
when no `uname` starts or one names MinGW, MSYS or Cygwin
([#18](https://github.com/pro-vi/cc-stretch/issues/18)). The tests answer `uname` themselves, and
the live check runs on macOS, so neither the choice nor the command has run on Windows.

## desktop-before-2.1.300

From 0.5.3 the hooks module loads in Claude Code 2.1.293 and 2.1.295, checked with `claude -p`
([#17](https://github.com/pro-vi/cc-stretch/issues/17)). Whether the desktop app with such a
version then shows stretches is not checked; `desktop-first-request` holds one reason it might not.

## live-checks-theme

The checks in `film/e2e/` start each session under the person's own theme setting and compare
colours with fixed values. `SOFT` in `film/e2e/tinted.mjs` holds the dark palette's, so since opened
words take the theme's own colours under a setting that names no palette, its step that opens a
stretch fails under `auto`. `LINK_FG` in `film/e2e/live.mjs` is `rgb(153,204,255)`, which Claude Code
2.1.322 draws for `suggestion` under `dark-daltonized`; under `dark` it draws `rgb(177,185,249)`. Fix
shape: add one `theme` to the `--settings` JSON `live.mjs` starts every session with, and write each
expected colour for that theme.

## marks-while-growing

A long form's words arrive a few at a time, so a frame can hold half of a pair of marks. Each case
below was seen in the frames `grow` and `layout` give for it, not in a take.

- A code span whose closing backtick has not arrived draws its opening backtick: `npm run test`
  shows a backtick before `npm` until `test` arrives.
- In arriving text, `inline` in `hooks/layout.ts` hides an opening `*` or `_` that has met no closing
  mark and draws the arriving text after it italic, so `_two words_` grows without its marks. An
  unpaired mark in the long form pays for it: in `Short, with a lone _id per run.` the `_` is hidden
  and `id per` is italic until the last frame, where the `_` appears and the words after it move a
  cell.
- A closing mark that arrives before its opening one is drawn: the words before the first anchor
  arrive last word first, so `Run _the whole test_ now.` grown from `now.` shows `test_` until
  `_the` arrives.
- Fix shape: `grow` in `hooks/grow.ts` pairs the marks on the whole long form and shows each word in
  the style it has there. `asArriving` in `hooks/layout.ts` then goes.

## unpaired-bold

`inline` in `hooks/layout.ts` toggles bold at every `**`, closed or not, so a `**` with no partner
(`**kwargs`, `2 ** 3`, `**/*.ts`) is not drawn and the rest of its line is bold. Italics were read
the same way until they were made to wait for their closing mark
([#23](https://github.com/pro-vi/cc-stretch/issues/23)). Bold was left alone because a
`**bold phrase**` whose last word has yet to arrive in a growing stretch would otherwise show its
`**`; the fix for `marks-while-growing` removes that reason.

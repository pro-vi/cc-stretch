# Benchmark

What the claim in the main README rests on. The current numbers are in
[`results.md`](results.md), and every one of them can be recomputed from
[`results.csv`](results.csv): one row per reply, counts only, no reply text.

Three measures, each taken with the plugin's own parser (`measure.ts`):

- **skim**: a reply with every stretch closed. What you read by default.
- **full**: every stretch open. Everything Claude wrote.
- **read**: the skim plus the stretches the reader opened.

## What it runs

**Replay** (`replay.ts`). I took real replies from four of my greenfield projects, up to 20 per
project sampled with a fixed seed, and had Claude (Opus 5.5) rewrite each one under the plugin's
guide, keeping every fact and adding nothing. Each rewrite is checked to keep the original's
content words with every stretch open. Replies under 40 words need no stretches by the guide's own
rule and are counted as written. Across 69 replies the skim was 17% of the original's words (12% to
21% per project). With every stretch open, the rewrites kept 99% of the original's content words on
average (never below 96%), and ran 6% longer: a long form repeats its short form's words so it reads
in place.

**Coverage** (`coverage.ts`). Fewer words only matter if the skim still says the important things.
For 20 of the replayed replies, a blind reader saw only one version and wrote down every decision,
action and result it was told about. A grader listed the original's must-know points and checked
both readers against the same list. The reader of the original is the control: it shows how strict
the grader is. The skim carried 68% of the top three points and 45% of all of them, against 99% for
the original. The rest is one click away, which is the deal. That missing third is the next thing to
fix. The likely place is the guide, which keeps decisions and actions out of stretches and says
nothing about results.

**Native** (`native.ts`). Replies written with the plugin on, with the reading notes that say what
was opened. So far that is five replies from the session that built the plugin: the skim was 16% of
the full text, and in the three replies with a reading note I read 51% of the words. I was clicking
everything to see if it worked, so that number is not typical of anything.

## Read these numbers honestly

- The replay is a **rewrite** of replies written without the plugin, not replies Claude wrote with
  it from the start. Native replies may stretch differently.
- These are **my** replies, written under my own instructions, which ask for a status block at the
  end of every reply. My replies run long. If yours are short, you will save less.
- The coverage grader is a model, and model graders have their own tastes. The control row is there
  to show how strict it is.
- The native sample is five replies from one session.
- It measures words, not time or understanding.

## Run it on your own transcripts

```
node bench/replay.ts --per-project 20 ~/.claude/projects/<project>... > bench/out/replay.jsonl
node bench/coverage.ts --per-project 5 > bench/out/coverage.jsonl
node bench/native.ts ~/.claude/projects/<project>/<session>.jsonl > bench/out/native.jsonl
node bench/report.ts
```

Rewrites and coverage use `claude -p` on your own account. Raw text stays in `bench/out/`, which
git ignores.

## Comparing guides

The guide in `hooks/guide.ts` is how the plugin teaches Claude to write stretchtext, so changes to it
are tested here first. `ab.ts` has each guide variant answer the same tasks, then checks the
answers two ways:

- **Layout rules** (`rules.ts`): checks of the guide's bullets that the text alone can decide, using
  the plugin's own parser. For example: the long form keeps the short form's words, and each list
  item stays visible with a stretch of its own. Each rule names the bullet it checks. Rules call no
  model and are worked out again whenever a report runs, so fixing a rule rescores every earlier run.
- **Grades** (`grading.ts`): a model judge, never told which guide wrote what, checks the skim and
  the full answer against each task's key. These grades are saved, since each one costs a call, with
  the judge's verdict on each link beside the count. The judge sees the task's question, when there
  is one, which resolves references but cannot supply results, and accepts a correct command as a
  full answer.

```
bun bench/ab.ts tasks --out bench/out/<run> --arm g0 --arm no-length-rule [--repeats 2] [--writer opus] [--judge sonnet] [--effort medium]
bun bench/ab.ts tasks-report --out bench/out/<run>
bun bench/ab.ts override --out bench/out/<run> --arm no-length-rule --repeat 1 --task cache-options --rule items-stay-visible --holds true --reason "<why the rule is wrong here>"
```

This example compares `g0` with `no-length-rule`, which drops the fixed sentence limit. `g7` would
add nothing: the plugin guide already holds its list line, so `g7` equals `g0`.

To read the answers before choosing how to grade them, pass `--judge none` to `tasks` or `run`: it
writes replies and makes no judge call. `compare` then writes `comparison.html`, with both frozen
guides and every input beside its two outputs, shown as first read, fully opened, or as written.
Failed generations stay visible, and the page has no scores. It needs a run with exactly two arms,
and refuses one whose guides or input code changed; corpus runs take `--corpus` here too.
`tasks-report` and `report` refuse such a run, and its folder cannot be graded later: a different
`--judge` is a changed input, so grade in a new `--out`.

```
bun bench/ab.ts tasks --out bench/out/short-guide --arm g0 --arm shortened --judge none --writer opus --effort xhigh
bun bench/ab.ts compare --out bench/out/short-guide
```

`--tasks <file>` replaces the task list with a JSON array of tasks shaped like those in `tasks.ts`,
for reproductions that stay private. `--task <id>`, repeated, runs only the named tasks, in the
list's order; `--limit` applies after it. An unknown id, or an empty, malformed or duplicated task
file, is refused before any model call. The manifest freezes the tasks chosen, so changing them
needs a new `--out`.

`ab.ts` runs under `bun`, because the plugin's hooks import each other without file extensions. An arm
is a variant named in `guides.ts`. The first run freezes its inputs in `<run>/manifest.json`. A
second run with the same inputs picks up where the first stopped; one with any other input (a
guide, a task, the writer or judge, the Claude Code version, or what Claude is asked: the prompts and
call flags in `grading.ts`, and the skim they show) is refused. Failed calls are kept as failures and tried again
on the next run. They never count as grades. A lock lets only one run use a folder at a time.

The report shows each rule's own count. Where someone overrode it, the adjudicated count appears
next to it, and every override is listed with its reason. An override counts only for the answer
text it was made on.

When you find something new about how Claude writes stretchtext, add it here so every later guide
gets checked against it:

1. Add tasks to `tasks.ts` that reproduce it. Put a few aside with `heldOut`, so a guide chosen on
   the others is also seen on tasks it was not chosen on.
2. Add a rule to `rules.ts`, or a fixture to an existing rule, with examples that must fail and
   examples that must pass in `tests/bench.test.ts`.
3. Add the guide change that should fix it to `guides.ts` as a new variant, and run it against `g0`.

`bun bench/stub/check.ts` runs the bench end to end with a stand-in for `claude`, without calling a
model.

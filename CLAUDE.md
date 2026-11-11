# cc-stretch

## What this is for

cc-stretch makes Claude write stretchtext, Ted Nelson's idea from 1967: a reply reads complete at its
shortest, and each phrase grows in place when the reader opens it. The guide in `hooks/guide.ts` asks
every reply for the following, and the guide bench measures how often a guide gets it. Claude does not
always deliver them. The aim is a bench good enough that every guide change is adopted on evidence,
and in time a guide chosen for each model Claude Code runs.

- At its shortest it answers on its own, and anything the reader must decide or do stays outside
  every stretch.
- A long form keeps every word of its short form, in the same order, and grows around them, so
  nothing the reader has read moves.
- A long form reads correctly in its short form's place.
- List items are stretches of their own, so a list stays in view.
- A reply that is already short needs no stretches.

## Where each promise is kept

- How Claude writes: `hooks/guide.ts`, sent with every session. Change it only through the guide
  bench (`bench/README.md`). A new way Claude gets stretchtext wrong first becomes a rule in
  `bench/rules.ts`, with examples that must fail and pass in `tests/bench.test.ts`; then the guide
  change that should fix it becomes a variant in `bench/guides.ts` and answers the bench's tasks
  beside the current guide, held-out tasks included. A variant that passes them is then adopted on
  a trial in live sessions, counted by `bench/live.ts` (`bench/README.md`, Adopting a guide).
- How a stretch is drawn: `hooks/layout.ts`, `hooks/grow.ts` and `hooks/reply.tsx`. While a
  stretch grows or shrinks, the words already on screen stay where they are.

## Checks

- `npm test` runs `claude plugin validate .` and `claude plugin test .`. As of Claude Code 2.1.302
  a test file may import only `claude-code`, `claude-code/testing` and the plugin's own files.
- `claude plugin test .` runs every `*.test.ts` and `*.test.tsx` under the folder, git-ignored ones
  too (as of Claude Code 2.1.304), so a file named that way anywhere in it runs against today's
  hooks and can fail `npm test` for everyone: a probe kept in `bench/out/`, or a copy of the plugin
  under `film/out/`. Keep a probe as `*.test.tsx.txt`, and leave `tests/` out of a copy.
- `npx tsc -p .claude-plugin/types/tsconfig.json --noEmit` typechecks the hooks; its TS5097 errors
  come from the bench's `.ts` imports and are expected. Claude Code writes the plugin API's types into
  `.claude-plugin/types/` when it loads the plugin from this folder (`claude --plugin-dir .`).
- A comment or doc that says how Claude Code behaves names the version it was checked against: the
  plugin API changes between releases.
- E2E map: `docs/e2e-map.md`, how to prove a change in a live Claude Code session.

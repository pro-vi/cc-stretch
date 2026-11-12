// Self-contained coding questions for comparing guides on replies written from scratch. Each task
// gives the writer a question and the evidence it may use (tool output it has already seen), and
// gives the judge a key the writer never sees:
//   know   what the reader must learn from the reply with every stretch closed
//   defer  what the reply should still say somewhere, but may keep inside a stretch
//   never  claims the reply must not make or leave the reader believing, open or closed
// The tasks are invented, and differ on purpose: a reply that needs no stretch, a negative answer,
// an unproved fix, an untested environment, a limited scope, a destructive command, a required
// order, several actions, an answer that is mostly code, a diagnosis, a decision and a status.
// The tasks after those ask, in ordinary words, for answers that are lists, where a guide without a
// rule for lists hid the whole list in one stretch; one rewrites a given reply instead. The ones after
// those give evidence that supports less than a reader would assume: a check run but not reported, a
// proposal described as working, a release still under observation. The series tasks ask for a
// reply of several parts, one of which is a plan or a series (steps, open checks, changes, sources):
// in live replies (Opus 5.5 and Fable 5.2, Claude Code 2.1.322) such a series was often hidden whole
// behind a sentence that only announces it. Their shapes are taken from live replies, their content
// is invented. Held-out tasks are kept out of choosing a guide, so a report can show how the choice
// does on unseen ones.

export type Task = {
  id: string
  key: { know: string[]; defer: string[]; never: string[] }
  /** The items a good answer lists, each one visible with a stretch of its own; each item is the words that name it. */
  items?: string[][]
  /** The parts of a plan or series the question asks for, each named in the reply before any click; each part is the words that name it. */
  series?: string[][]
  /** A good answer is short enough to need no stretch. */
  needsNoStretch?: true
  /** The person's instruction that requires a closing block, which the answer must make its last stretch. */
  closing?: string
  /** Kept out of choosing a guide. */
  heldOut?: true
} & (
  /** A question, and the evidence the writer may use. */
  | { kind?: 'question'; question: string; evidence: string }
  /** A reply written before stretches, for the writer to rewrite with them. */
  | { kind: 'rewrite'; reply: string }
)

/** The fields of a task the layout rules read. */
export type Layout = Pick<Task, 'items' | 'series' | 'needsNoStretch' | 'closing'>

/** `value` when it is a list of strings. */
export const stringsOf = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((s): s is string => typeof s === 'string') ? value : undefined)

/** A task read back from a run's manifest, or an error naming the field that is wrong. */
export function readTask(value: unknown): Task {
  const get = (from: unknown, key: string): unknown => (typeof from === 'object' && from !== null ? Reflect.get(from, key) : undefined)
  const strings = stringsOf
  const [id, kind, question, evidence, reply, key] = ['id', 'kind', 'question', 'evidence', 'reply', 'key'].map(name => get(value, name))
  const know = strings(get(key, 'know')), defer = strings(get(key, 'defer')), never = strings(get(key, 'never'))
  const [items, series, needsNoStretch, closing, heldOut] = ['items', 'series', 'needsNoStretch', 'closing', 'heldOut'].map(name => get(value, name))
  /** A list of word lists, or undefined when `list` is not one. */
  const wordLists = (list: unknown) => {
    const read = Array.isArray(list) ? list.map(strings) : undefined
    return read?.every((words): words is string[] => words !== undefined) === true ? read : undefined
  }
  const itemList = wordLists(items), seriesList = wordLists(series)
  if (typeof id !== 'string' || know === undefined || defer === undefined || never === undefined) throw new Error(`task ${JSON.stringify(id)} has no id or key`)
  if (
    (items !== undefined && itemList === undefined) ||
    (series !== undefined && seriesList === undefined) ||
    (needsNoStretch !== undefined && needsNoStretch !== true) ||
    (closing !== undefined && typeof closing !== 'string') ||
    (heldOut !== undefined && heldOut !== true)
  ) {
    throw new Error(`task ${id} has a malformed items, series, needsNoStretch, closing or heldOut`)
  }
  const common = {
    id,
    key: { know, defer, never },
    ...(itemList !== undefined && { items: itemList }),
    ...(seriesList !== undefined && { series: seriesList }),
    ...(needsNoStretch === true && { needsNoStretch: true as const }),
    ...(typeof closing === 'string' && { closing }),
    ...(heldOut === true && { heldOut: true as const }),
  }
  if (kind === 'rewrite' && typeof reply === 'string') return { ...common, kind, reply }
  if ((kind === undefined || kind === 'question') && typeof question === 'string' && typeof evidence === 'string') {
    return { ...common, ...(kind === 'question' && { kind }), question, evidence }
  }
  throw new Error(`task ${id} is neither a question with evidence nor a reply to rewrite`)
}

const KEYBOARD_EVIDENCE =
  'Treat this supplied capability report as given. Client elements inside a reply accept keyboard events only after a mouse click gives focus; Escape returns focus. A toolbar above the prompt is reachable with Ctrl+X Tab and supports one-letter or digit buttons; Escape returns to typing. A custom keybinding can invoke an existing engine action only when the engine is not handling that action itself, making it fragile. Slash commands such as /stretch open 2 are keyboard-only but require typing a command for each operation.'
const KEYBOARD_ITEMS = [['client', 'click', 'in-reply'], ['band', 'toolbar'], ['keybinding'], ['slash']]
const KEYBOARD_POINTS = ['Client needs an initial mouse click.', 'Toolbar is reachable without a mouse.', 'Custom keybindings can conflict with engine actions.', 'Slash commands are keyboard-only but slow.']

export const TASKS: Task[] = [
  {
    id: 'brief',
    needsNoStretch: true,
    question: 'Which git command shows the last five commits, one line each?',
    evidence: '$ git --version\ngit version 2.50.1',
    key: {
      know: ['`git log --oneline -5` (or `-n 5`) shows the last five commits, one per line.'],
      defer: [],
      never: [],
    },
  },
  {
    id: 'negation',
    question: 'I changed parseDate in src/date.ts. Do the tests pass now?',
    evidence: `$ npm test
 ✓ src/date.test.ts > parseDate > accepts plain dates
 ✓ src/date.test.ts > parseDate > accepts times with offsets
 ✗ src/date.test.ts > parseDate > accepts ISO week dates
   AssertionError: expected Invalid Date to equal 2026-01-07T00:00:00.000Z
   ❯ src/date.test.ts:41:32
       expect(parseDate('2026-W02-3')).toEqual(new Date('2026-01-07'))

 Test Files  1 failed | 11 passed (12)
      Tests  1 failed | 46 passed (47)`,
    key: {
      know: [
        'No: one test fails.',
        'The failing test is "accepts ISO week dates": an ISO week date such as 2026-W02-3 now parses as Invalid Date.',
      ],
      defer: ['The other 46 tests pass.', 'The test expected 2026-W02-3 to parse to 2026-01-07.'],
      never: ['All the tests pass.', 'The failure is unrelated to the parseDate change.'],
    },
  },
  {
    id: 'unproved',
    question: 'Did my change fix the flaky upload test?',
    evidence: `The change, in src/upload.ts: the handler now awaits the write stream's "finish" event before
reading the file back. Before, it read the file as soon as write() returned.

$ for i in $(seq 200); do npx vitest run upload.test.ts >/dev/null 2>&1 || echo fail; done | wc -l
       0
The same loop on the commit before the change printed 3.

CI history for upload.test.ts on main: 4 failures in the last 120 runs, all "file is empty".
The CI pipeline for this change is queued and has not started.`,
    key: {
      know: [
        'Probably, but it is not confirmed yet.',
        'It has not run in CI, where the test failed about 1 run in 30, so one passing CI run would prove little.',
      ],
      defer: [
        'Locally, 0 of 200 runs failed after the change, against 3 of 200 before.',
        'The cause the change addresses: the file was read back before the write stream finished.',
      ],
      never: ['The flaky test is fixed.', 'The change passes in CI.'],
    },
  },
  {
    id: 'untested-env',
    question: 'Is migration 0042 ready to deploy?',
    evidence: `migrations/0042_event_source.sql:
  ALTER TABLE events ADD COLUMN source text NOT NULL DEFAULT 'web';
  CREATE INDEX events_source_idx ON events (source);

$ npm run test:db      (runs every migration on an in-memory SQLite database)
  migrations 0001-0042 applied; 18 tests passed

Production: PostgreSQL 16. The events table holds about 40 million rows and takes writes all day.
The migration runner wraps each file in one transaction. Nobody has run 0042 on PostgreSQL.`,
    key: {
      know: [
        'Not yet: it has only been tested on SQLite, never on PostgreSQL.',
        'CREATE INDEX without CONCURRENTLY on the 40-million-row events table blocks writes to it while the index builds.',
      ],
      defer: [
        'On PostgreSQL 11 and later, adding a column with a constant default is fast.',
        'The index can be built with CREATE INDEX CONCURRENTLY, which cannot run inside the runner\'s transaction, so it needs its own migration outside one.',
      ],
      never: ['The migration is ready to deploy.', 'The migration was tested on PostgreSQL.'],
    },
  },
  {
    id: 'scope',
    question: 'Can I run scripts/reset-db.sh to get a clean database?',
    evidence: `scripts/reset-db.sh:
  #!/bin/sh
  set -e
  . ./.env
  psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  npm run migrate && npm run seed

$ grep DATABASE_URL .env
DATABASE_URL=postgres://app@db.staging.internal:5432/app

docs/environments.md: "db.staging.internal is the shared staging database. QA runs its test plans
against it; ask in #qa before changing its data."`,
    key: {
      know: [
        'Not as things are: .env points at db.staging.internal, the shared staging database, so the script would wipe it.',
        'Point DATABASE_URL at a local database first; against a local database it is safe.',
      ],
      defer: ['What the script does: drops every table in the public schema, then migrates and seeds.'],
      never: ['It is safe to run the script now.', 'The script only touches a local database.'],
    },
  },
  {
    id: 'destructive',
    question: 'How do I get rid of the old worktree at ../app-payments?',
    evidence: `$ git worktree list
/Users/me/app            4f2c1d0 [main]
/Users/me/app-payments   9b7e3a1 [feat/payments]

$ git -C ../app-payments status --short
 M src/charge.ts
?? src/refund.ts

$ git branch --merged main
* main

$ git log -1 --format=%cr feat/payments
3 weeks ago`,
    key: {
      know: [
        'It holds uncommitted work, a modified src/charge.ts and an untracked src/refund.ts, which removing it would lose.',
        'Commit or copy that work first, then run `git worktree remove ../app-payments`.',
        'Adding --force would delete those changes.',
      ],
      defer: ['The branch feat/payments is not merged into main, and removing the worktree keeps the branch.'],
      never: ['The worktree is clean.', 'Removing the worktree with --force loses nothing.'],
    },
  },
  {
    id: 'order',
    question: 'How do I upgrade from queuelib 2 to queuelib 3?',
    evidence: `queuelib CHANGELOG, 3.0.0:
  Breaking: the job payload format changed. queuelib 3 workers cannot read jobs enqueued in the
  2.x format; such jobs fail with PayloadVersionError. Run \`queuelib migrate-payloads\` while no
  2.x worker is running and nothing enqueues, then start 3.x workers. The 3.x client enqueues in
  the new format.

Our setup: four workers on queuelib 2.9, started by deploy/workers.yml. The web app enqueues jobs
all day through the queuelib client, also 2.9.`,
    key: {
      know: [
        'The order matters: stop all 2.x workers and pause enqueueing, run `queuelib migrate-payloads`, then start 3.x workers.',
        'A 3.x worker cannot read jobs in the 2.x format, so a rolling upgrade would fail those jobs.',
        'Upgrade the web app\'s client to 3.x in the same window, or it keeps enqueueing 2.x jobs.',
      ],
      defer: ['Jobs in the old format fail with PayloadVersionError.'],
      never: ['The workers can be upgraded one at a time while the others keep running.'],
    },
  },
  {
    id: 'actions',
    question: "What's left before I can publish 1.4.0 to npm?",
    evidence: `$ git status --short
(clean)
$ git log origin/main..main
(nothing: main is pushed)
$ node -p "require('./package.json').version"
1.4.0
$ grep -n '^## ' CHANGELOG.md | head -2
3:## 1.3.2
14:## 1.3.1
$ git tag --list 'v1.4*'
(no output)
$ npm run build && npm publish --dry-run
... + my-lib@1.4.0  (dry run)
$ npm profile get two-factor-auth
auth-and-writes`,
    key: {
      know: [
        'Add a 1.4.0 entry to CHANGELOG.md.',
        'Create the v1.4.0 tag and push it.',
        'Run npm publish yourself: the account asks for a two-factor code on every publish.',
      ],
      defer: ['Already done: the version is bumped to 1.4.0, main is pushed, the build and the dry run pass.'],
      never: ['Nothing is left: it is ready to publish as is.'],
    },
  },
  {
    id: 'code',
    question:
      'Write a TypeScript function that retries an async call up to 3 times with exponential backoff, but never retries a 4xx error.',
    evidence: `src/http.ts:
  export class HttpError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }

src/util.ts:
  export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

package.json has no retry library, and the team does not want a new dependency for this.`,
    key: {
      know: [
        'The function itself, in a code block: it retries failed calls with growing delays, using sleep from src/util.ts.',
        'An HttpError with a status from 400 to 499 is thrown at once, without a retry.',
      ],
      defer: ['The delays it waits between attempts.', 'Why a 4xx is not retried: the same request would fail the same way.'],
      never: ['It uses or installs a retry library.'],
    },
  },
  {
    id: 'diagnosis',
    question: 'Why do due dates show a day early for our users in California?',
    evidence: `The API returns due dates as date-only strings, e.g. {"due": "2026-03-14"}.

src/format.ts, line 12:
  export const dueLabel = (due: string) => new Date(due).toLocaleDateString()

$ TZ=America/Los_Angeles node -e "console.log(new Date('2026-03-14').toLocaleDateString('en-US'))"
3/13/2026
$ TZ=Europe/Berlin node -e "console.log(new Date('2026-03-14').toLocaleDateString('en-US'))"
3/14/2026

The database row holds 2026-03-14.`,
    key: {
      know: [
        'new Date("2026-03-14") reads a date-only string as midnight UTC, which is still the previous day in California, so the label shows a day early.',
        'Fix dueLabel in src/format.ts: format in UTC, e.g. toLocaleDateString(undefined, { timeZone: "UTC" }), or build a local date from the year, month and day.',
      ],
      defer: ['The stored date is right; users east of UTC, such as in Berlin, see the right day.'],
      never: ['The database stores the wrong date.', 'The API returns the wrong date.'],
    },
  },
  {
    id: 'decision',
    question: 'Should the job status page use websockets or polling?',
    evidence: `Hosting: the app runs on a serverless platform. Its docs: "Functions time out after 10 seconds.
WebSocket connections are not supported; use a separate service for long-lived connections."

Jobs take from 30 seconds to 5 minutes. About 50 people watch the status page at the busiest hour.
GET /jobs/:id/status reads one row by primary key; its p95 latency is 12 ms.`,
    key: {
      know: [
        'Use polling, every few seconds.',
        'The current host does not support websockets; they would need a separate always-on service.',
        'The cost of polling is a few seconds of delay before a status change shows, which these job lengths can afford.',
      ],
      defer: ['Load estimate: 50 viewers polling every 3 seconds is about 17 cheap requests a second.'],
      never: ['Websockets work on the current host.'],
    },
  },
  {
    id: 'status',
    question: 'Where are we on the auth migration?',
    evidence: `$ gh pr list --label auth-migration --state all
#212  Move sessions to Redis            MERGED   3 days ago
#218  Refresh tokens in the background  OPEN     approved; checks failing
#220  Remove the old cookie path        OPEN     review requested from @org/security 2 days ago, no response

$ gh pr checks 218
e2e  fail   login > remembers this device
unit pass
lint pass

$ gh run list --branch main --workflow e2e --limit 3
completed  failure  main  "Bump vite"          (yesterday)   failed: login > remembers this device
completed  failure  main  "Fix footer links"   (yesterday)   failed: login > remembers this device
completed  success  main  "Move sessions to Redis" (3 days ago)`,
    key: {
      know: [
        '#218 is approved but blocked by a failing e2e test, which also fails on main since yesterday, so #218 did not cause it.',
        '#220 is waiting on the security team\'s review, requested 2 days ago with no answer.',
        'The migration is not done: two of its three pull requests are open.',
      ],
      defer: ['#212, moving sessions to Redis, merged 3 days ago.', 'The failing test is "login > remembers this device".'],
      never: ['#218 broke the e2e test.', 'The auth migration is finished.'],
    },
  },
  {
    id: 'keyboard-options',
    question: 'Could we make reply navigation keyboard-only? What does the API give us?',
    evidence: KEYBOARD_EVIDENCE,
    items: KEYBOARD_ITEMS,
    key: { know: KEYBOARD_POINTS, defer: [], never: [] },
  },
  {
    id: 'cache-options',
    question: 'What are the tradeoffs among our available cache options?',
    evidence:
      'We have three implemented adapters. Memory cache has the lowest latency but is lost on restart and cannot share state across processes. SQLite persists locally and needs no separate service, but replicas cannot share one local file. Redis shares cached data across replicas, but needs a running service and adds a network hop. All three support the same TTL interface; no new adapter needs to be written.',
    items: [['memory'], ['sqlite'], ['redis']],
    key: {
      know: ['Memory is fast but temporary and process-local.', 'SQLite persists locally but is not shared across replicas.', 'Redis shares across replicas but requires a service.'],
      defer: [],
      never: [],
    },
  },
  {
    id: 'keyboard-rewrite',
    kind: 'rewrite',
    reply:
      'What the API offers:\n\n- The reply itself. The plugin draws replies with a Client element, which can listen for keys. But keys reach it only after a click gives it focus, and Esc gives focus back. Inside a reply, arrows, Tab, Enter and Backspace could move between stretches and open or close them, but you need one click to start.\n- A band above the prompt. Focus it with Ctrl+X Tab without the mouse, and its buttons then answer one digit or letter each. Esc returns to the prompt.\n- Your own keybinding. A button can claim an existing engine keybinding action, so the chord you bound in keybindings.json presses it straight from the prompt. Only engine action names are allowed, and only while the engine is not handling that action itself, so it is fragile.\n- Slash commands. Something like /stretch open 2, which is keyboard-only but slow.',
    items: KEYBOARD_ITEMS,
    key: { know: KEYBOARD_POINTS, defer: [], never: [] },
  },
  {
    id: 'export-formats',
    needsNoStretch: true,
    question: 'List the three supported export formats. Names only.',
    evidence: 'The application exports CSV, JSON, and Parquet.',
    key: { know: ['The formats are CSV, JSON and Parquet.'], defer: [], never: [] },
  },
  {
    id: 'verification-results',
    question: 'What was verified on the exact commit?',
    evidence:
      'The working tree was clean at commit 9c31a7e for both checks. npm run typecheck exited 0. npm test reported 47 passed, 0 failed and exited 0. No browser tests were run on that commit.',
    key: {
      know: ['Typecheck and unit tests passed.', 'Browser tests were not run.'],
      defer: ['The checked commit was 9c31a7e.', 'All 47 unit tests passed.'],
      never: ['Browser tests passed.', 'Every test suite was run.'],
    },
  },
  {
    id: 'verification-summary',
    question: 'Give me the verification summary for this change.',
    evidence: `At clean commit 9c31a7e, npm run typecheck exited 0, and npm test passed all 47 unit tests.
The unit tests cover parsing nested stretches, preserving literal code, and closing malformed input.
The CLI smoke check also passed: a fresh run wrote its manifest, resuming identical inputs added no rows,
and resuming changed inputs stopped before a model call. It used a stand-in model process.
The same commit has not been tested with a real model or in a running terminal.
The real-model run and terminal keyboard/resize checks remain to be done before release.
All recorded checks refer to that commit; there are no later edits.`,
    key: {
      know: [
        'Typecheck, unit tests and the CLI smoke check passed on the same commit.',
        'The smoke check used a stand-in, so it does not show real-model behavior.',
        'Real-model and running-terminal checks remain before release.',
      ],
      defer: ['The checked commit was 9c31a7e.', 'All 47 unit tests passed.', 'The smoke check covered fresh runs, unchanged resumes and refusal of changed inputs.'],
      never: ['Real-model behavior was verified.', 'Terminal keyboard and resize behavior was verified.', 'The change is ready for release.'],
    },
  },
  {
    id: 'current-capabilities',
    question: 'What is actually in place, and what would developer mode change?',
    evidence: `The current application keeps draft edits in process memory. A restart loses those drafts.
Only an explicit Save writes a file. The file writer takes a lock while saving; the lock is released
when the save ends. There is no persistent editing lock and no background autosave.
The proposed developer mode would save each edit to a local journal and replay it after a restart.
That proposal has not been implemented or tested. It would not change save-time locking.
The product sketch says drafts already survive restart, but the current implementation does not do that.`,
    key: {
      know: [
        'Current drafts are lost on restart; only explicit Save persists them.',
        'The current lock lasts only during a save.',
        'Developer mode proposes a local journal for restart recovery, but it is not implemented.',
      ],
      defer: ['Developer mode would leave save-time locking unchanged.', 'The product sketch incorrectly describes current restart recovery.'],
      never: ['Current drafts survive restart.', 'Developer mode already works.', 'An editing lock persists between saves.'],
    },
  },
  {
    id: 'unreported-check',
    question: 'What was verified on this commit?',
    evidence:
      'At clean commit 7b92eac, typecheck exited 0 and all 84 unit tests passed. The CLI smoke run used a stand-in model. The browser resize check has not been run. No code changed after these checks.',
    key: {
      know: ['Typecheck and unit tests passed.', 'The outcome of the CLI smoke run is not given.', 'The browser resize check has not been run.'],
      defer: ['All 84 unit tests passed.', 'The supplied record concerns commit 7b92eac.'],
      never: ['The CLI smoke run passed.', 'The CLI smoke run failed.', 'The browser resize check passed.'],
    },
  },
  {
    id: 'rollout-evidence',
    heldOut: true,
    question: 'Can you sum up where the release stands?',
    evidence: `The release candidate passed 63 integration tests in staging. The same artifact was then
installed on one production canary, serving 5% of requests. Its first ten minutes showed no errors.
The planned observation period is one hour, so fifty minutes remain. No rollback rehearsal has been run
for this candidate. Full rollout is waiting for that rehearsal and the rest of the observation period.
The other production instances still serve the previous release. No customer-wide success claim has been made.`,
    key: {
      know: [
        'The candidate passed staging tests and is running on a 5% production canary.',
        'Ten error-free minutes do not complete the required one-hour observation.',
        'Full rollout is waiting for the remaining observation and a rollback rehearsal.',
      ],
      defer: ['Staging passed 63 integration tests.', 'The other instances still serve the previous release.'],
      never: ['Full rollout is complete.', 'The rollback rehearsal passed.', 'The full observation period passed.'],
    },
  },
  {
    id: 'search-options-zh',
    heldOut: true,
    question: '列出这三个搜索方案，各自有什么取舍？',
    evidence: '方案一：前缀搜索，只匹配词开头；延迟最低，但不能找词中间。方案二：全文搜索，支持按相关性排序；适合文章，但默认不保证任意子串匹配。方案三：三元组搜索，支持子串和近似拼写；索引较大，写入也更慢。',
    items: [['前缀'], ['全文'], ['三元组']],
    key: { know: ['前缀搜索快，但不匹配词中间。', '全文搜索适合文章相关性，不保证任意子串。', '三元组支持子串和近似拼写，但索引大、写入慢。'], defer: [], never: [] },
  },
  {
    id: 'auth-options',
    heldOut: true,
    question: 'List the three authentication approaches and explain the tradeoffs. Include the implementation notes where they help.',
    evidence:
      'Sessions store a random token in a cookie and its state on the server; immediate revocation is easy, but every request needs a state lookup. Implementation notes: rotate the token at login, expire it on logout. Signed bearer tokens can be verified without a database lookup, but revocation needs extra state or waiting for expiry. Implementation notes: verify issuer and audience, keep expiry short. API keys suit scripts and service accounts, but copied keys remain usable until revoked. Implementation notes: store only hashes, support per-key revocation.',
    items: [['session'], ['signed', 'bearer', 'jwt'], ['api key']],
    key: {
      know: ['Sessions offer immediate revocation but require server state.', 'Signed tokens avoid lookups but complicate revocation.', 'API keys suit automation but copied keys work until revoked.'],
      defer: [],
      never: [],
    },
  },
  {
    id: 'parser-status',
    heldOut: true,
    question: 'Give me a bulleted update on the parser, renderer, and export work. End with the required status block.',
    closing: 'A closing status block is required: a horizontal rule, a Done line, a Next line, and a closing horizontal rule.',
    evidence:
      'Parser work is merged and the malformed-input test passes. The renderer change compiles, but nobody has tested resize behavior in a running app. Export work is blocked because the downstream CSV column order has not been agreed; the next step is to obtain that contract. There is no release yet.',
    items: [['parser'], ['renderer'], ['export']],
    key: { know: ['Parser merged and malformed-input test passed.', 'Renderer resize remains untested.', 'Export is blocked on CSV column order.'], defer: [], never: [] },
  },
  {
    id: 'signup-plan',
    question: 'What did the signup study find, and which of the costed options would you build? Tell it in prose, the way you would say it to me.',
    evidence: `Signup study, 4 weeks of our own funnel (11,400 visitors) beside five competitor flows.
Findings:
- Our first screen asks for four fields. 38% of visitors leave on it. All five competitors ask for one field there.
- We set a password before anything works. Median time to a first action is 2 min 50 s; three competitors with no password at signup measure 41 s.
- A new account opens on an empty workspace. 46% of new accounts never create anything. Four competitors open on filled example content.
- We take a card before the trial starts. 22% of those who reach the card form leave there. No competitor asks before the trial.
- Two competitors show "step 2 of 3". The notes hold no measurement of its effect, for them or for us.
Options the team already costed, each of which can ship alone:
- Email-only gate: the first screen asks for the email and the terms checkbox, nothing else. 2 days.
- Magic link: no password at signup; reuse the mailer that sends password resets. 3 days.
- Starter project: a new account opens on a filled sample project. 5 days.
- Card at day 10: no card form at signup; ask on day 10 of the 14-day trial. 4 days, needs billing's sign-off.
- Progress line: show "step 2 of 3". 1 day.
Constraints: legal requires the terms checkbox before an account exists. Billing requires a card before day 14.`,
    series: [['email-only', 'email only', 'only the email', 'only for the email', 'email alone'], ['magic link', 'magic-link'], ['starter project', 'sample project'], ['day 10', 'day ten', 'day-10']],
    key: {
      know: [
        'Build the email-only first screen, keeping the terms checkbox.',
        'Build the magic link in place of a password at signup.',
        'Build the starter project, so a new account opens on filled content.',
        'Move the card to day 10 of the trial, which needs billing to sign off.',
      ],
      defer: ['38% of visitors leave on the first screen.', '22% of those who reach the card form leave there.', 'The progress line has no measured effect.'],
      never: ['The progress line is known to raise signups.', 'Billing has signed off on asking for the card at day 10.'],
    },
  },
  {
    id: 'migration-open',
    question: "Where does the orders database migration stand? Tell me what's done and what's still open in a few sentences, not a checklist.",
    evidence: `Migration of the orders database to the new cluster, status at 16:00.
Done: schema copied. 41.2M rows copied, and row counts match table by table. Read traffic switched at 14:10; error rate unchanged at 0.02%.
Open:
- Write cutover: scheduled for 22:00 tonight, and needs the on-call engineer's go.
- Restore drill from a backup of the new cluster: not run yet. Dana runs it tomorrow morning.
- The nightly export job still points at the old host. The config change is written, not deployed.
- Shutdown of the old cluster: by policy it waits 7 days after the write cutover.
None of the open items affects reads.`,
    series: [['cutover', 'cut over', 'writes move'], ['restore', 'drill'], ['export'], ['shutdown', 'shut down', 'decommission', 'turned off', 'switched off']],
    key: {
      know: [
        'Reads are on the new cluster and healthy; writes are not yet.',
        "The write cutover is set for 22:00 tonight and needs the on-call engineer's go.",
        'The restore drill has not been run.',
        'The nightly export job still points at the old host.',
        'The old cluster is shut down 7 days after the write cutover.',
      ],
      defer: ['41.2M rows were copied and row counts match.', 'The error rate stayed at 0.02% after reads switched.'],
      never: ['Writes are already on the new cluster.', 'The restore drill passed.'],
    },
  },
  {
    id: 'load-test',
    question: "How did last night's load test go?",
    evidence: `Load test, 2 hours at three times peak (1,800 requests a second), build 7f3c.
p50 38 ms. p95 210 ms (target 250). p99 480 ms (target 500). Error rate 0.04% (target 0.1%). No restarts.
Two things did not look right:
- The search service's memory grew from 1.1 GB to 2.9 GB over the run and had not come down 30 minutes after it. Its limit is 4 GB.
- The queue worker fell behind from minute 70. The backlog peaked at 12,400 jobs and took 25 minutes to drain after the test.
Neither caused an error during the test. Nobody has looked into the cause of either. A 4-hour test is planned for Thursday.`,
    series: [['memory'], ['queue', 'backlog']],
    key: {
      know: [
        'Latency and error rate met their targets at three times peak.',
        "The search service's memory grew to 2.9 GB of its 4 GB limit and did not come back down.",
        'The queue worker fell behind and its backlog took 25 minutes to drain.',
      ],
      defer: ['p95 was 210 ms against a target of 250.', 'A 4-hour test is planned for Thursday.'],
      never: ['A memory leak is confirmed.', 'The system can take three times peak for longer than two hours.'],
    },
  },
  {
    id: 'config-changes',
    question: 'What changed in the gateway config between 2.3 and 2.4, and do I need to do anything?',
    evidence: `$ diff gateway-2.3.yaml gateway-2.4.yaml   (summarised)
timeout.upstream: 30s -> 10s
retries.max: 3 -> 2
tls.min_version: 1.1 -> 1.2
log.format: text -> json
cache.ttl: new key, 60s by default (2.3 had no cache)
auth.legacy_header: removed (the gateway no longer reads the X-Auth-Token header)
$ grep -rln "X-Auth-Token" services/
services/billing/client.py
services/reports/fetch.py
services/reports/export.py`,
    series: [['timeout', '10s', '10 s'], ['retr'], ['tls'], ['json', 'log format'], ['cache'], ['x-auth-token', 'legacy header', 'legacy_header']],
    key: {
      know: [
        'You must act: three files in billing and reports still send X-Auth-Token, which 2.4 no longer reads.',
        'The upstream timeout drops from 30 s to 10 s and retries from 3 to 2.',
        'The minimum TLS version is now 1.2.',
        'Logs are now JSON.',
        'A cache is on by default with a 60 s TTL.',
      ],
      defer: ['The three files are services/billing/client.py, services/reports/fetch.py and services/reports/export.py.'],
      never: ['No action is needed.', 'Every service has already stopped sending X-Auth-Token.'],
    },
  },
  {
    id: 'audit-rules',
    question: 'What rules did the docs audit come up with? I want to hand them to the writers.',
    evidence: `Docs audit: 60 pages read, 5 rules proposed, each with what it was seen on.
1. One task per page. 14 pages mix installing and configuring.
2. Commands go in code blocks, never inline in a sentence. Seen on 23 pages.
3. Every page names the version it was checked on. 41 pages name none.
4. A screenshot only where a sentence cannot describe the screen. 9 pages hold more than six.
5. No "simply" and no "just". Seen on 31 pages.
Not audited: the API reference, which is generated.`,
    series: [['one task'], ['code block'], ['version'], ['screenshot'], ['simply', 'just']],
    key: {
      know: [
        'One task per page.',
        'Commands go in code blocks, not inline.',
        'Every page names the version it was checked on.',
        'Screenshots only where a sentence cannot describe the screen.',
        'No "simply" or "just".',
      ],
      defer: ['The audit read 60 pages.', 'The generated API reference was not audited.'],
      never: ['The API reference was audited.'],
    },
  },
  {
    id: 'pricing-open',
    question: 'Is the pricing page ready to ship?',
    evidence: `Pricing page, state on Tuesday.
Built and reviewed: the three plan cards, the monthly and annual switch, the FAQ. Lighthouse score 96. Marketing approved the copy on Monday.
Still undecided, and each one changes what the page shows:
- The annual discount: 15% or 20%. Finance answers by Thursday. The switch shows 20% as a placeholder.
- Whether the Enterprise card shows a price or "Contact us". Sales wants no price.
- Which currency visitors from the EU see. The page has US dollars only today.
- The footer's tax wording, which legal has not signed off.`,
    series: [['discount'], ['enterprise'], ['currency', 'eur', 'dollar'], ['legal', 'footer', 'tax']],
    key: {
      know: [
        'The page is not ready: four decisions are open.',
        'The annual discount is undecided between 15% and 20%.',
        'Whether the Enterprise card shows a price is undecided.',
        'The currency for visitors from the EU is undecided.',
        "Legal has not signed off the footer's tax wording.",
      ],
      defer: ['The Lighthouse score is 96.', 'Marketing approved the copy on Monday.'],
      never: ['The annual discount is 20%.', 'Legal has signed off the footer.'],
    },
  },
  {
    id: 'benchmark-weak',
    question: "How solid is the new parser's speedup number?",
    evidence: `Benchmark: the new parser against the old one, on the 12 files in bench/fixtures.
Result: median 2.3 times faster (range 1.4 to 3.9). All 12 outputs are byte-identical to the old parser's.
What the number rests on:
- One machine: an M3 laptop, on battery power.
- Twelve files, all under 200 KB. Production files run to 40 MB, and none that large was measured.
- Each file was parsed once after a warm-up run, so the page cache was warm every time.
- The old parser was built without the release flag, the new one with it.`,
    series: [['one machine', 'single machine', 'laptop'], ['200 kb', '40 mb', 'small', 'large file', 'production-sized', 'production files'], ['warm', 'cache'], ['release flag', 'release build', 'without the release', 'unoptimi', 'optimi']],
    key: {
      know: [
        'The 2.3 times figure is not solid yet.',
        'It was measured on one machine.',
        'No file over 200 KB was measured, and production files reach 40 MB.',
        'Every run had a warm cache.',
        'The old parser was built without the release flag, so the comparison is unfair to it.',
      ],
      defer: ['The speedup ranged from 1.4 to 3.9 times.', "All 12 outputs match the old parser's byte for byte."],
      never: ['The new parser is 2.3 times faster in production.', 'Large files were measured.'],
    },
  },
  {
    id: 'release-contents',
    question: "What's in 3.2, and does anyone need to change anything to upgrade?",
    evidence: `Changes merged for 3.2.
Features: export to Parquet; per-project API tokens.
Fixes: a crash on a CSV file with an empty header row; wrong totals when a filter and a group-by are combined; the date picker ignoring the user's time zone.
Breaking: the config key \`auth.token\` is renamed \`auth.api_token\`. 3.2 reads only the new name, and stops at startup when it finds the old one.
Not in 3.2: single sign-on, moved to 3.3.`,
    series: [['auth.api_token', 'auth.token'], ['parquet'], ['per-project', 'api tokens'], ['csv'], ['totals', 'group-by', 'group by'], ['time zone', 'time-zone', 'timezone', 'date picker']],
    key: {
      know: [
        'To upgrade, rename the config key auth.token to auth.api_token: 3.2 stops at startup on the old name.',
        '3.2 adds export to Parquet and per-project API tokens.',
        'It fixes a crash on an empty CSV header row.',
        'It fixes wrong totals when a filter and a group-by are combined.',
        "It fixes the date picker ignoring the user's time zone.",
      ],
      defer: ['Single sign-on moved to 3.3.'],
      never: ['Single sign-on is in 3.2.', 'Nothing has to change to upgrade.'],
    },
  },
  {
    id: 'review-fixes',
    heldOut: true,
    question: 'What did you change after the review? Prose is fine.',
    evidence: `Review of PR #212 (rate limiter): 7 comments. What was done for each:
1. Bug: the bucket refilled on every request, not once a second. Fixed; a new test holds the refill at 5 tokens a second.
2. Bug: limits were keyed by IP address only, so a whole office shared one bucket. Now keyed by API key, falling back to IP.
3. Renamed \`lim\` to \`limiter\` in 4 files.
4. Moved the default limit (120 a minute) from code into config.
5. Added the \`Retry-After\` header that 429 responses were missing.
6. A comment asked for Redis-backed buckets. Not done: declined for this PR, buckets stay in memory, and the PR description says so.
7. Fixed a typo in the README.
All 48 tests pass. The PR has not been reviewed again.`,
    series: [['refill'], ['api key', 'keyed', 'keying', 'per-key', 'bucket key', 'key scheme', 'per-ip'], ['retry-after', 'missing header'], ['redis']],
    key: {
      know: [
        'The refill bug is fixed: the bucket refills once a second.',
        'Limits are now keyed by API key, falling back to IP.',
        'The missing Retry-After header on 429 responses was added.',
        'Redis-backed buckets were declined for this PR.',
        'The PR has not been reviewed again.',
      ],
      defer: ['`lim` was renamed to `limiter`.', 'The default limit moved into config.', 'All 48 tests pass.'],
      never: ['Redis-backed buckets were added.', 'The reviewer approved the changes.'],
    },
  },
  {
    id: 'cleanup-left',
    heldOut: true,
    question: 'Did the cleanup of the old staging account finish?',
    evidence: `Cleanup of the old staging account, run today.
Deleted: 14 instances, 6 load balancers, 31 volumes and both managed databases (their final snapshots are kept 30 days).
Left, and why:
- The bucket "stg-audit-logs": it has a retention lock until 2027-01-31 and cannot be deleted before then.
- Two DNS records, api.stg and cdn.stg: removed from the zone, but resolvers may hold them for up to 48 hours.
- The IAM role "ci-deploy-stg": the mobile app's CI pipeline still assumes it. Its owners were asked on Monday and have not answered.
What is left costs about $4 a month.`,
    series: [['bucket', 'audit'], ['dns', 'api.stg', 'cdn.stg'], ['role', 'iam']],
    key: {
      know: [
        'Not all of it: three things are left.',
        'The audit-log bucket is locked until 2027-01-31.',
        'Two DNS records may still resolve for up to 48 hours.',
        "The CI role is still used by the mobile app's pipeline, and its owners have not answered.",
      ],
      defer: ['14 instances, 6 load balancers and 31 volumes were deleted.', 'What is left costs about $4 a month.'],
      never: ['Everything was deleted.', 'The mobile team agreed to stop using the role.'],
    },
  },
  {
    id: 'estimate-sources',
    heldOut: true,
    question: 'Which sources does the 2027 seat estimate rest on, and how far do you trust each?',
    evidence: `Estimate: 14,000 seats by the end of 2027. Built from four sources:
- The billing export of February 2026: 9,850 paid seats. Exact, from our own system.
- The sales pipeline sheet: 3,100 seats in late-stage deals. The sheet is kept by hand; of 12 deals spot-checked, 2 had stale seat counts.
- An analyst report (Marlow, 2025): 18% yearly growth for the segment. One firm's figure; its method is not published.
- Churn of 6% a year, from the 2024 cohort table. One cohort only.`,
    series: [['billing'], ['pipeline'], ['analyst', 'marlow', 'growth'], ['churn', 'cohort']],
    key: {
      know: [
        'The billing export is exact.',
        'The pipeline sheet is kept by hand, and 2 of 12 deals checked were stale.',
        "The analyst's growth figure is one firm's, with no published method.",
        'The churn figure comes from one cohort.',
      ],
      defer: ['The estimate is 14,000 seats by the end of 2027.', 'The billing export shows 9,850 paid seats.'],
      never: ['The estimate has been checked against actual 2027 numbers.', 'Every source is reliable.'],
    },
  },
  {
    id: 'incident-plan-zh',
    heldOut: true,
    question: '这次排查发现了什么？接下来打算怎么做？用几句话说，不要列表。',
    evidence: `排查记录：支付回调丢失。
发现一：网关重启时会丢掉内存里的重试队列。3 月 2 日那次重启丢了 17 条回调。
发现二：回调接口的超时设为 2 秒，而对方平均 2.4 秒才响应，约 6% 的回调因此超时。
发现三：告警只看错误率，不看回调积压，所以当时没有人收到通知。
已定的下一步，按顺序：
1. 把重试队列落盘，本周完成。
2. 超时改为 5 秒，今天可以上线。
3. 新增一条告警：回调积压超过 100 条就通知值班，本周完成。
4. 补发 3 月 2 日丢失的 17 条回调，要等第 1 步上线之后。`,
    series: [['落盘', '持久化', '写入磁盘', '写到磁盘'], ['5 秒', '5秒', '五秒', '改超时', '调超时'], ['补发']],
    key: {
      know: ['重试队列要落盘。', '超时改为 5 秒。', '新增回调积压的告警。', '补发 3 月 2 日丢失的 17 条回调，在队列落盘上线之后。'],
      defer: ['3 月 2 日的重启丢了 17 条回调。', '约 6% 的回调超时。'],
      never: ['丢失的回调已经补发。', '重试队列已经落盘。'],
    },
  },
]

// Drives the guide bench through its run-folder cases with the stand-in `claude` in this folder, and
// live.ts through transcripts written here, so they are checked without a model call. Exits 1 if a
// case did not hold.
//   bun bench/stub/check.ts
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GUIDE } from '../../hooks/guide.ts'
import { readManifest } from '../manifest.ts'

const STUB = new URL('.', import.meta.url).pathname
const AB = new URL('../ab.ts', import.meta.url).pathname
const LIVE = new URL('../live.ts', import.meta.url).pathname
const scratch = mkdtempSync(join(tmpdir(), 'cc-stretch-bench-check-'))

/** Runs the bench, or another of its scripts, with the stand-in first on PATH; returns its exit status and output. */
function bench(args: string[], env: Record<string, string> = {}, script = AB) {
  const run = spawnSync('bun', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env, PATH: `${STUB}:${process.env.PATH ?? ''}` } })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}
const tasks = (out: string, arm = 'g0', env: Record<string, string> = {}, limit = ['--limit', '2'], concurrency = '4') =>
  bench(['tasks', '--out', out, '--arm', arm, ...limit, '--writer', 'opus', '--judge', 'haiku', '--concurrency', concurrency], env)
const rowsIn = (out: string, file: string) =>
  readFileSync(join(out, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { status: string; reason?: string })
const snapshot = (out: string) =>
  readdirSync(out).sort().map(name => `${name}:${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}`).join('\n')

let failed = 0
function check(name: string, holds: boolean, detail: string) {
  console.log(`${holds ? 'ok  ' : 'FAIL'} ${name}`)
  if (!holds) {
    failed += 1
    console.log(detail.split('\n').map(line => `     ${line}`).join('\n'))
  }
}

// A fresh run freezes its inputs and grades every answer.
const fresh = join(scratch, 'fresh')
let r = tasks(fresh)
const ok = (out: string, file: string) => rowsIn(out, file).filter(row => row.status === 'ok').length
check('a fresh run writes a manifest, two answers and two grades', r.status === 0 && ok(fresh, 'answers.jsonl') === 2 && ok(fresh, 'graded.jsonl') === 2, r.output)

// A resume with the same inputs has nothing left to do.
const before = snapshot(fresh)
r = tasks(fresh)
check('a resume with the same inputs adds no row', r.status === 0 && snapshot(fresh) === before, r.output)

// A resume with another guide is refused before any call, and changes no file.
r = tasks(fresh, 'g7')
check('a resume with another guide is refused and changes nothing', r.status === 1 && r.output.includes('these differ: arms.g0, arms.g7') && snapshot(fresh) === before, r.output)
r = tasks(join(scratch, 'unknown'), 'g99')
check('an arm that names no variant is refused before anything is written', r.status === 1 && r.output.includes('no guide variant') && !readdirSync(scratch).includes('unknown'), r.output)

// So is a resume under another version of Claude Code.
r = tasks(fresh, 'g0', { STUB_VERSION: '9.9.10 (Claude Code)' })
check('a resume under another Claude Code version is refused', r.status === 1 && r.output.includes('claude') && snapshot(fresh) === before, r.output)

// A judge answering outside its words, in its key verdicts or in its labels, leaves failures and
// never grades; a resume with a sound judge grades them.
for (const garbled of ['key', 'labels']) {
  const junk = join(scratch, `junk-${garbled}`)
  r = tasks(junk, 'g0', { STUB_JUDGE: garbled })
  check(`a judge confused in its ${garbled} leaves failure rows and no grade`, r.status === 1 && ok(junk, 'graded.jsonl') === 0 && rowsIn(junk, 'graded.jsonl').every(row => row.status === 'error'), r.output)
  r = tasks(junk)
  check(`after confused ${garbled}, a resume with a sound judge grades what failed`, r.status === 0 && ok(junk, 'graded.jsonl') === 2, r.output)
}

// A call answered by another model stops the run and grades nothing from it.
const changed = join(scratch, 'changed')
r = tasks(changed, 'g0', { STUB_FAIL_MATCH: 'parseDate' })
check('a refused writer call leaves a failure row', r.status === 1 && rowsIn(changed, 'answers.jsonl').some(row => row.status === 'error'), r.output)
r = tasks(changed, 'g0', { STUB_RESOLVE: '-v2' })
check('a writer answering as another model stops the run', r.status === 1 && rowsIn(changed, 'answers.jsonl').some(row => row.reason?.startsWith('model changed') === true), r.output)

// A call answered by another model stops the run there: the jobs after it are not started.
const halt = join(scratch, 'halt')
tasks(halt, 'g0', { STUB_FAIL_MATCH: 'parseDate|flaky upload' }, ['--limit', '3'])
r = tasks(halt, 'g0', { STUB_RESOLVE: '-v2' }, ['--limit', '3'], '1')
check('a model change stops the run before its other jobs', r.status === 1 && r.output.includes('stopped: a model changed') && r.output.includes('0 of 2 jobs finished'), r.output)

// Calls failing in a row stop a run before it has sent every job.
r = tasks(join(scratch, 'failing'), 'g0', { STUB_FAIL_MATCH: '.' }, ['--limit', '9'], '1')
check('eight calls failing in a row stop a run', r.status === 1 && r.output.includes('stopped: 8 calls failed in a row') && r.output.includes('0 of 9 jobs finished, 8 failed'), r.output)

// A resume cuts away a last line left by an interrupted write before appending, so its rows stay readable.
const cut = join(scratch, 'cut')
tasks(cut, 'g0', { STUB_JUDGE: 'key' })
appendFileSync(join(cut, 'graded.jsonl'), '{"arm":"g0","repeat":1,"id":"cut')
r = tasks(cut)
const cutReport = bench(['tasks-report', '--out', cut])
check('a resume after a cut line grades on, and its folder still reads', r.status === 0 && r.output.includes('dropped its last line') && cutReport.status === 0 && cutReport.output.includes('2 of 2 tasks graded'), `${r.output}\n${cutReport.output}`)

// A flag that is misspelt, or a count that is not a whole number of at least 1, stops before anything runs.
const typo = bench(['tasks', '--out', join(scratch, 'typo'), '--arm', 'g0', '--repeat', '2'])
const zero = bench(['tasks', '--out', join(scratch, 'zero'), '--arm', 'g0', '--concurrency', '0'])
check('a misspelt flag or a zero count is refused before anything is written', typo.status === 1 && typo.output.includes('--repeat') && zero.status === 1 && zero.output.includes('whole number') && !readdirSync(scratch).includes('typo') && !readdirSync(scratch).includes('zero'), `${typo.output}\n${zero.output}`)

// A report skips a last line cut short by an interrupted write, and says so.
appendFileSync(join(fresh, 'answers.jsonl'), '{"arm":"a","repeat":1,"id":"cut')
r = bench(['tasks-report', '--out', fresh])
check('a report skips a cut last line and says so', r.status === 0 && r.output.includes('cut short') && r.output.includes('2 of 2 tasks graded'), r.output)

// A report counts each layout rule per arm, with held-out tasks in a table of their own. The stand-in
// writer stretches each item of a memory, SQLite and Redis list, so only the cache task keeps its
// items visible, and the short tasks break the rule that they need no stretch.
const every = join(scratch, 'every')
r = tasks(every, 'g7', {}, [])
const report = bench(['tasks-report', '--out', every])
check(
  'a report counts each layout rule per arm, held-out tasks apart',
  r.status === 0 && report.status === 0 &&
    report.output.includes('Layout rules, tasks for choosing a guide') && report.output.includes('Layout rules, held-out tasks') &&
    report.output.includes('| no-stretch-in-short-reply | 2 / 2 |') && report.output.includes('| items-stay-visible | 2 / 3 |') &&
    report.output.includes('| items-stay-visible | 3 / 3 |') && !report.output.includes('g7, 1, cache-options: items-stay-visible') &&
    // The stand-in's reply names no part of any series a task asks for.
    report.output.includes('| series-in-view | 8 / 8 |') && report.output.includes('| series-in-view | 4 / 4 |'),
  `${r.output}\n${report.output}`,
)

// A person's override shows beside the rule's own count, only for the answer it was made on.
const overrideArgs = (task: string, reason: string[]) => ['override', '--out', every, '--arm', 'g7', '--repeat', '1', '--task', task, '--rule', 'items-stay-visible', '--holds', 'true', ...reason]
r = bench(overrideArgs('keyboard-options', ['--reason', 'the band paragraph names its own option']))
check('an override is recorded for an answer that exists', r.status === 0 && r.output.includes('recorded'), r.output)
r = bench(overrideArgs('no-such-task', ['--reason', 'x']))
const s1 = r.status
r = bench(overrideArgs('cache-options', []))
const noRepeat = bench(['override', '--out', every, '--arm', 'g7', '--task', 'cache-options', '--rule', 'items-stay-visible', '--holds', 'true', '--reason', 'x'])
check('an override for no answer, with no reason, or with no repeat, is refused', s1 === 1 && r.status === 1 && r.output.includes('--reason is required') && noRepeat.status === 1 && noRepeat.output.includes('--repeat'), `${r.output}\n${noRepeat.output}`)
appendFileSync(join(every, 'overrides.jsonl'), `${JSON.stringify({ arm: 'g7', repeat: 1, id: 'auth-options', rule: 'items-stay-visible', holds: true, reason: 'made on an older answer', at: 'then', answer: 'not-this-text' })}\n`)
const adjudicated = bench(['tasks-report', '--out', every])
check(
  'a report shows raw and adjudicated counts, and every override with its reason',
  adjudicated.status === 0 && adjudicated.output.includes('| items-stay-visible | 2 / 3, 1 / 3 adjudicated |') &&
    adjudicated.output.includes('by a person: the band paragraph names its own option') &&
    adjudicated.output.includes('not applied as the answer changed since: made on an older answer') && adjudicated.output.includes('| items-stay-visible | 3 / 3 |'),
  adjudicated.output,
)

// A corpus run writes every reply's must-know points before any rewrite. A reply whose points failed
// gets no rewrite, the run exits 1, and a resume finishes it. The replies say what the stand-in's
// rewrite says, so its rewrites keep their content words.
const corpusFile = join(scratch, 'corpus.jsonl')
const plain = 'The options are below.\n\n- Memory is fast, but lost on restart.\n- SQLite persists locally, unshared.\n- Redis is shared across replicas.'
writeFileSync(corpusFile, [
  { id: 'p#s#1', project: 'p', session: 's', turn: 1, reply: plain },
  { id: 'p#s#2', project: 'p', session: 's', turn: 2, reply: `${plain} Second.` },
].map(row => JSON.stringify(row)).join('\n') + '\n')
const corpusRun = join(scratch, 'corpus-run')
const run = (env: Record<string, string> = {}) => bench(['run', '--out', corpusRun, '--corpus', corpusFile, '--arm', 'g0', '--repeats', '1'], env)
r = run({ STUB_FAIL_MATCH: '\\{"points"[\\s\\S]*Second' })
const rewritten = rowsIn(corpusRun, 'rewrites.jsonl').length
check('a corpus run rewrites only replies whose points exist, and exits 1', r.status === 1 && ok(corpusRun, 'points.jsonl') === 1 && rewritten === 1 && ok(corpusRun, 'judged.jsonl') === 1, r.output)
r = run()
const corpusReport = bench(['report', '--out', corpusRun, '--corpus', corpusFile])
check('a resume finishes the corpus run, and its report reads both replies', r.status === 0 && ok(corpusRun, 'judged.jsonl') === 2 && corpusReport.status === 0 && corpusReport.output.includes('labels on sections or lists') && corpusReport.output.includes('on the status block') && corpusReport.output.includes('2 of 2 replies judged'), `${r.output}\n${corpusReport.output}`)

// One run at a time per folder: a lock held by a live process refuses a second, and one left by a
// process that has gone is taken over.
const locked = join(scratch, 'locked')
mkdirSync(locked)
writeFileSync(join(locked, 'run.lock'), String(process.pid))
const held = tasks(locked)
writeFileSync(join(locked, 'run.lock'), '999999')
r = tasks(locked, 'g0', {}, ['--limit', '1'])
check('a folder another live run holds is refused, and a dead run\'s lock is taken over', held.status === 1 && held.output.includes('in use by another run') && r.status === 0, `${held.output}\n${r.output}`)

// A flag given twice, or a corpus command with no folders, stops before anything is written.
const twice = bench(['tasks', '--out', join(scratch, 'twice'), '--arm', 'g0', '--repeats', '2', '--repeats', '1'])
const twoArms = bench(['override', '--out', every, '--arm', 'g7', '--arm', 'g0', '--repeat', '1', '--task', 'cache-options', '--rule', 'items-stay-visible', '--holds', 'true', '--reason', 'x'])
const noDirs = bench(['corpus', '--corpus', join(scratch, 'empty.jsonl')])
check(
  'a flag given twice, two arms for one override, or a corpus with no folders, is refused',
  twice.status === 1 && twice.output.includes('given twice') && twoArms.status === 1 && twoArms.output.includes('--arm is given twice') && noDirs.status === 1 && !readdirSync(scratch).includes('empty.jsonl'),
  `${twice.output}\n${twoArms.output}\n${noDirs.output}`,
)

// A folder from before manifests, or with an unreadable one, is refused.
const old = join(scratch, 'old')
mkdirSync(old)
writeFileSync(join(old, 'answers.jsonl'), '{"arm":"a","repeat":1,"id":"brief","text":"x"}\n')
r = tasks(old)
check('a folder holding rows but no manifest is refused', r.status === 1 && r.output.includes('before run manifests'), r.output)
const broken = join(scratch, 'broken')
mkdirSync(broken)
writeFileSync(join(broken, 'manifest.json'), '{"command":"tasks"}')
r = tasks(broken)
check('an unreadable manifest is refused', r.status === 1 && r.output.includes('not a guide bench manifest'), r.output)

// A focused comparison names tasks without changing the shared task list or resuming another set.
const selected = join(scratch, 'selected')
const select = (...ids: string[]) => bench(['tasks', '--out', selected, '--arm', 'g7', ...ids.flatMap(id => ['--task', id])])
r = select('cache-options', 'brief')
const selectedIds = r.status === 0 ? readManifest(readFileSync(join(selected, 'manifest.json'), 'utf8')).tasks?.map(t => t.id) : []
check('named tasks run exactly the requested set in tasks.ts order', r.status === 0 && JSON.stringify(selectedIds) === JSON.stringify(['brief', 'cache-options']) && ok(selected, 'answers.jsonl') === 2, r.output)
const selectedBefore = r.status === 0 ? snapshot(selected) : ''
r = select('brief')
check('resuming with another task selection is refused without writes', selectedBefore !== '' && r.status === 1 && r.output.includes('tasks.cache-options') && snapshot(selected) === selectedBefore, r.output)
const unknownTask = join(scratch, 'unknown-task')
r = bench(['tasks', '--out', unknownTask, '--arm', 'g7', '--task', 'no-such-task'])
check('an unknown task is refused before creating a run', r.status === 1 && r.output.includes('no task named no-such-task') && !readdirSync(scratch).includes('unknown-task'), r.output)

// Private reproductions can be supplied without adding their text to the shared task corpus.
const taskFile = join(scratch, 'tasks.json')
const external = { id: 'external-task', question: 'Name the cache options.', evidence: 'Memory, SQLite and Redis are available.', key: { know: ['Memory, SQLite and Redis are available.'], defer: [], never: [] } }
writeFileSync(taskFile, JSON.stringify([external]))
const supplied = join(scratch, 'supplied')
const suppliedArgs = ['tasks', '--out', supplied, '--arm', 'g7', '--tasks', taskFile]
r = bench(suppliedArgs)
const suppliedIds = r.status === 0 ? readManifest(readFileSync(join(supplied, 'manifest.json'), 'utf8')).tasks?.map(t => t.id) : []
check('a supplied task file replaces the default task list', r.status === 0 && JSON.stringify(suppliedIds) === '["external-task"]' && ok(supplied, 'answers.jsonl') === 1, r.output)
const suppliedBefore = r.status === 0 ? snapshot(supplied) : ''
writeFileSync(taskFile, JSON.stringify([{ ...external, question: 'Explain the cache options.' }]))
r = bench(suppliedArgs)
check('changing a supplied task refuses resume without writes', suppliedBefore !== '' && r.status === 1 && r.output.includes('tasks.external-task') && snapshot(supplied) === suppliedBefore, r.output)
for (const input of [[], [external, external], [{ id: 'broken' }]]) {
  writeFileSync(taskFile, JSON.stringify(input))
  r = bench(['tasks', '--out', join(scratch, 'invalid-tasks'), '--arm', 'g7', '--tasks', taskFile])
  check('invalid supplied tasks are refused before creating a run', r.status === 1 && !readdirSync(scratch).includes('invalid-tasks'), r.output)
}

// A generation-only run must make no judge call, including point extraction.
// The stand-in refuses every grading prompt, so a stray call fails the run.
const noJudge = { STUB_FAIL_MATCH: 'Output only JSON|Write down, as a short numbered list' }
const blockedJudge = join(scratch, 'blocked-judge')
r = tasks(blockedJudge, 'g0', noJudge, ['--limit', '1'])
check('the no-judge test guard rejects a real grading attempt', r.status === 1 && ok(blockedJudge, 'answers.jsonl') === 1 && ok(blockedJudge, 'graded.jsonl') === 0, r.output)
const ungraded = join(scratch, 'ungraded')
const ungradedArgs = ['tasks', '--out', ungraded, '--arm', 'g0', '--arm', 'shortened', '--task', 'brief', '--judge', 'none']
r = bench(ungradedArgs, noJudge)
check('generation-only tasks write both answers without invoking a judge', r.status === 0 && ok(ungraded, 'answers.jsonl') === 2 && !existsSync(join(ungraded, 'graded.jsonl')), r.output)
const ungradedBefore = snapshot(ungraded)
r = bench(ungradedArgs, noJudge)
check('generation-only resume reuses completed answers', r.status === 0 && snapshot(ungraded) === ungradedBefore, r.output)
r = bench(['compare', '--out', ungraded], noJudge)
check('comparison shows both frozen guides and the saved answers without grades', r.status === 0 && readFileSync(join(ungraded, 'comparison.html'), 'utf8').includes('No scores or rankings'), r.output)
r = bench(['tasks-report', '--out', ungraded], noJudge)
check('a score report refuses an ungraded run', r.status === 1 && r.output.includes('this run has no grades'), r.output)
const incomplete = join(scratch, 'ungraded-incomplete')
r = bench(['tasks', '--out', incomplete, '--arm', 'g0', '--arm', 'shortened', '--task', 'brief', '--judge', 'none'], { STUB_FAIL_MATCH: '.' })
check('failed generations remain visible in a comparison', r.status === 1 && bench(['compare', '--out', incomplete]).status === 0 && readFileSync(join(incomplete, 'comparison.html'), 'utf8').includes('Generation failed:'), r.output)
const rawCorpus = join(scratch, 'ungraded-corpus.jsonl')
writeFileSync(rawCorpus, JSON.stringify({ id: 'one', project: 'sample', session: 'session', turn: 0, reply: 'Memory is fast. SQLite persists. Redis is shared.' }) + '\n')
const rawRun = join(scratch, 'ungraded-rewrites')
r = bench(['run', '--out', rawRun, '--corpus', rawCorpus, '--arm', 'g0', '--arm', 'shortened', '--repeats', '1', '--judge', 'none'], noJudge)
check('generation-only rewriting skips point extraction and every judge', r.status === 0 && ok(rawRun, 'rewrites.jsonl') === 2 && !existsSync(join(rawRun, 'points.jsonl')) && !existsSync(join(rawRun, 'judged.jsonl')), r.output)

// Live counts: transcripts written here as Claude Code 2.1.322 writes the rows live.ts reads, three
// sessions under the plugin's guide and three under a guide on trial, each with two long replies.
const TRIAL = GUIDE.replace('- Stretches nest:', '- Stretches may nest:')
if (TRIAL === GUIDE) throw new Error('the guide on trial must differ from the plugin\'s')
const trialFile = join(scratch, 'trial-guide.txt')
writeFileSync(trialFile, `${TRIAL}\n`)
const LONG = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ')
const KEPT = `${LONG} {{The build fails.|The build fails on a stale cache.}}`
const REWORDED = `${LONG} {{The build fails.|CI is broken by a stale cache.}}`
const liveDir = join(scratch, 'live')
mkdirSync(liveDir)
/** Writes a session's transcript into `dir`: its replies under `guide`, each on its day, the first followed by a reading note that names its stretch as opened. */
function transcript(dir: string, name: string, guide: string, replies: string[], days: string | string[], tail = '') {
  const rows: unknown[] = [{ type: 'api-request-shape', shapeHash: 'shape-1', shape: { system: [{ type: 'text', text: 'You are Claude Code.' }, { type: 'text', text: `Be brief.\n\n${guide}\n\nOther instructions.` }] } }]
  replies.forEach((reply, i) => {
    rows.push({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'What broke?' } })
    if (i === 1) rows.push({ type: 'attachment', attachment: { type: 'hook_additional_context', content: ['Stretchtext: since your last reply the reader opened "The build fails.".'] } })
    rows.push({ type: 'api-request', id: `request-${i}`, shapeHash: 'shape-1', params: { model: 'claude-opus-5-5' } })
    rows.push({ type: 'assistant', requestRef: `request-${i}`, timestamp: `${typeof days === 'string' ? days : days[i]}T10:00:00.000Z`, message: { role: 'assistant', content: [{ type: 'text', text: reply }], usage: { input_tokens: 10 } } })
  })
  // A request body's row is never parsed, so what follows its opening may be anything.
  const lines = [...rows.map(row => JSON.stringify(row)), '{"type":"api-request-blob", not JSON at all']
  writeFileSync(join(dir, `${name}.jsonl`), `${lines.join('\n')}\n${tail}`)
}
// The third session under the plugin's guide began before the day a trial might start, and wrote its second reply after it.
for (const n of [1, 2, 3]) transcript(liveDir, `shipped-${n}`, GUIDE, [REWORDED, n === 1 ? KEPT : REWORDED], n === 3 ? ['2026-01-01', '2026-01-05'] : '2026-01-05')
// The last line of a session still being written is cut short, and is skipped.
for (const n of [1, 2, 3]) transcript(liveDir, `trial-${n}`, TRIAL, [KEPT, KEPT], '2026-01-05', n === 1 ? '{"type":"assis' : '')
const liveFiles = readdirSync(liveDir).sort().map(name => join(liveDir, name))
const live = (args: string[], env: Record<string, string> = {}) => bench(args, env, LIVE)
r = live(['--guide', `candidate=${trialFile}`, ...liveFiles])
check(
  'live counts name each guide, count its replies by session and print the difference with its interval',
  r.status === 0 &&
    r.output.includes('in 6 transcripts.') &&
    r.output.includes('| | shipped | candidate |') &&
    r.output.includes('| replies, in sessions | 6, in 3 | 6, in 3 |') &&
    r.output.includes('| keeps-short-words | 5 of 6 (83%) | 0 of 6 (0%) |') &&
    r.output.includes('| links the reader opened, of links in view, where a reading note followed | 3 of 3 (100%) | 3 of 3 (100%) |') &&
    // Drawn again, the three shipped sessions break the rule in 3 to 6 of 6 replies, and all three draws land on the session with 1 of 2 once in 27.
    r.output.includes('- keeps-short-words: -83 (-100 to -50)'),
  r.output,
)
r = live(['--guide', `candidate=${trialFile}`, '--since', '2026-01-02', ...liveFiles])
check('live counts leave out a session begun before --since, the replies it wrote later too', r.status === 0 && r.output.includes('2 in sessions begun earlier') && r.output.includes('| replies, in sessions | 4, in 2 | 6, in 3 |'), r.output)
r = live(['--guide', `candidate=${trialFile}`, '--sessions', ...liveFiles])
check('with --sessions, live counts print how many sessions each guide has and each rate can be taken over, and no rate', r.status === 0 && r.output.includes('| replies, in sessions | 6, in 3 | 6, in 3 |') && r.output.includes('| keeps-short-words | 3 | 3 |') && r.output.includes('| a reply under 40 words holds a stretch | 0 | 0 |') && r.output.includes('| a link in view is a label, by the judge | 3 | 3 |') && !r.output.includes('%'), r.output)
r = live(liveFiles)
check('a guide no name was given for is counted as unnamed', r.status === 0 && r.output.includes('| | shipped | unnamed |'), r.output)
const noDay = live(['--since', 'yesterday', ...liveFiles])
const noFile = live(['--guide', `candidate=${join(scratch, 'no-such-guide.txt')}`, ...liveFiles])
check('live counts refuse a --since that is no day and a --guide file that cannot be read', noDay.status === 1 && noDay.output.includes('YYYY-MM-DD') && noFile.status === 1 && noFile.output.includes('cannot read'), `${noDay.output}\n${noFile.output}`)

// Labels: the stand-in judge calls a short form that ends in a colon a label. The session under the
// plugin's guide holds one among its three links, and a closing block whose link is not counted.
const labelDir = join(scratch, 'labels')
mkdirSync(labelDir)
const PLAN = '{{The plan:|The plan: build, then ship.}}'
const CLOSING = '{{Status:|Status: built.\n\n---\n\n**Next** · ship\n\n---}}'
transcript(labelDir, 'shipped-a', GUIDE, [`${LONG} ${PLAN} ${KEPT}`, `${LONG} ${KEPT}\n\n${CLOSING}`], '2026-01-05')
// The trial session's second reply holds no link but its closing block's, so the judge is not asked about it.
transcript(labelDir, 'trial-a', TRIAL, [`${LONG} ${KEPT}`, `${LONG}\n\n${CLOSING}`], '2026-01-05')
const labelFiles = readdirSync(labelDir).sort().map(name => join(labelDir, name))
const verdictFile = join(scratch, 'verdicts.jsonl')
const labelled = (extra: string[], env: Record<string, string> = {}) => live(['--guide', `candidate=${trialFile}`, '--labels', verdictFile, ...extra, ...labelFiles], env)
const LABEL_ROW = '| a link in view is a label, by the judge | 1 of 3 (33%) | 0 of 1 (0%) |'
r = labelled(['--judge', 'haiku'], { STUB_JUDGE: 'labels' })
check('a judge confused in its labels is asked twice, and the replies go without a verdict', r.status === 0 && r.output.includes("0 have the judge's verdicts and 3 have none") && r.output.includes('| a link in view is a label, by the judge | none | none |') && !existsSync(verdictFile), r.output)
r = labelled(['--judge', 'haiku'])
check(
  'live counts ask the judge about each reply with a link in view, and count labels per link, a closing block\'s left out',
  r.status === 0 && r.output.includes("3 have the judge's verdicts (stub-haiku) and 0 have none") && r.output.includes(LABEL_ROW) && r.output.includes('- a link in view is a label, by the judge: -33 (-33 to -33)') && rowsIn(scratch, 'verdicts.jsonl').length === 3,
  r.output,
)
const savedVerdicts = readFileSync(verdictFile, 'utf8')
check('the saved verdicts hold no word of a reply', !savedVerdicts.includes('build') && !savedVerdicts.includes('word1'), savedVerdicts)
// A last line cut short by an interrupted write is dropped before the next verdict is added.
appendFileSync(verdictFile, '{"asked":"cut')
r = labelled(['--judge', 'haiku'], { STUB_FAIL_MATCH: '.' })
check('saved verdicts are read again without a call, past a last line cut short', r.status === 0 && r.output.includes(LABEL_ROW) && readFileSync(verdictFile, 'utf8') === savedVerdicts, r.output)
r = labelled([], { STUB_FAIL_MATCH: '.' })
const noLabels = live(['--judge', 'haiku', ...labelFiles])
check('without --judge the saved verdicts are counted, and --judge without --labels is refused', r.status === 0 && r.output.includes(LABEL_ROW) && noLabels.status === 1 && noLabels.output.includes('--labels'), `${r.output}\n${noLabels.output}`)
// With --sessions nothing is asked: a judge that would fail every call is never called, and no file is written.
const unasked = join(scratch, 'unasked.jsonl')
r = live(['--sessions', '--labels', unasked, '--judge', 'haiku', ...labelFiles], { STUB_FAIL_MATCH: '.' })
check('with --sessions the judge is not asked', r.status === 0 && !r.output.includes('asking') && !existsSync(unasked) && r.output.includes('| a link in view is a label, by the judge | 1 |'), r.output)

console.log(failed === 0 ? `all cases hold (scratch: ${scratch})` : `${failed} cases failed (scratch: ${scratch})`)
process.exit(failed === 0 ? 0 : 1)

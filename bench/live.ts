// Counts how often replies written in live sessions go wrong, by the guide and the model that wrote
// them (bench/README.md, Live), and how two guides differ. Only replies whose request is recorded
// with a guide in its system prompt are counted (Claude Code 2.1.300 to 2.1.322 record it).
//   bun bench/live.ts [--guide <name>=<file>]... [--since <YYYY-MM-DD>] [--against <name>] [--sessions]
//                     [--labels <file> [--judge <model>] [--concurrency 4]] ~/.claude/projects/*/*.jsonl
// A recorded guide is named `shipped` when it is the plugin's own, by its name in guides.ts when it
// is a variant there, by --guide's name when its text is that file's, and `unnamed` otherwise. A
// guide that only adds text after another's last line is told from it only when it has a name.
// --since leaves out every session whose first reply was written before that day (UTC): a trial
// splits only the sessions begun after its setting was made. --against names the guide the others
// are compared with, `shipped` unless given. --sessions prints only how many sessions each guide
// has and each rate can be taken over, so a trial is not read before it has them.
// --labels adds how many links in view a judge calls labels, a closing block's link left out, from
// the verdicts saved in <file>; with --judge, that model is first asked about each reply the file
// has no verdict for, through `claude -p`, and its verdicts are added to the file. A row there
// holds a hash of what the judge was asked and its verdicts, never a reply's text. Keep one judge
// to a file.
// Runs under bun, as the plugin's hooks import each other without file extensions.
import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { GUIDE } from '../hooks/guide.ts'
import { counted, differenceOf, FAILURES, guideIn, LABEL, sum, takesLabel, talliesOf, totalOf } from './counts.ts'
import type { Counted } from './counts.ts'
import { claudeArgs, LABELS, readLabels, resultOf } from './grading.ts'
import type { Label } from './grading.ts'
import { VARIANTS } from './guides.ts'
import { messageOf, rowsOf } from './manifest.ts'
import { marked } from './measure.ts'
import { hiddenIn } from './rules.ts'
import { stringsOf } from './tasks.ts'
import { GUIDE_HEADING, sessionOf } from './transcripts.ts'

/** Judge calls failing in a row before the asking stops, as a run in ab.ts stops. */
const MAX_FAILURES = 8

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const { values: flags, positionals: paths } = (() => {
  try {
    return parseArgs({
      options: {
        guide: { type: 'string', multiple: true }, since: { type: 'string' }, against: { type: 'string' }, sessions: { type: 'boolean' },
        labels: { type: 'string' }, judge: { type: 'string' }, concurrency: { type: 'string' },
      },
      allowPositionals: true,
    })
  } catch (error) {
    return fail(messageOf(error))
  }
})()
if (paths.length === 0) fail('usage: bun bench/live.ts [--guide <name>=<file>]... [--since <YYYY-MM-DD>] [--against <name>] [--sessions] [--labels <file> [--judge <model>] [--concurrency 4]] <transcript.jsonl>...')
const since = flags.since
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail(`--since wants a day as YYYY-MM-DD, not ${since}`)
const base = flags.against ?? 'shipped'
const labelsFile = flags.labels
if (flags.judge !== undefined && labelsFile === undefined) fail('--judge needs --labels <file>, where the verdicts are kept')
if (flags.concurrency !== undefined && flags.judge === undefined) fail('--concurrency needs --judge')
const concurrency = Number(flags.concurrency ?? 4)
if (!Number.isInteger(concurrency) || concurrency < 1) fail(`--concurrency wants a whole number of at least 1, not ${flags.concurrency ?? ''}`)

// Each guide's text by its name. A text keeps the first name it was given, and a name from --guide comes first.
const named = new Map<string, string>()
const name = (as: string, text: string) => {
  if (![...named.values()].includes(text)) named.set(as, text)
}
for (const given of flags.guide ?? []) {
  const at = given.indexOf('=')
  if (at < 1) fail(`--guide wants <name>=<file>, not ${given}`)
  const file = given.slice(at + 1)
  try {
    name(given.slice(0, at), readFileSync(file, 'utf8').trim())
  } catch {
    fail(`--guide ${given}: cannot read ${file}`)
  }
}
name('shipped', GUIDE)
for (const [variant, text] of Object.entries(VARIANTS)) name(variant, text)

type Verdict = { given: Label[]; models: string[] }
type Question = { asked: string; prompt: string; links: number }
/**
 * What the label judge is asked about `reply`, under the hash its verdicts are kept by, and how many
 * links that is; undefined for a reply with no link in view the label count takes.
 */
function questionOf(reply: string): Question | undefined {
  const { skim, longs } = marked(reply)
  if (!longs.some(long => takesLabel(hiddenIn(long)))) return undefined
  const prompt = LABELS(skim, longs)
  return { asked: hash('sha256', prompt), prompt, links: longs.length }
}

// The replies to count, in the order met, each with what the judge is asked about it where labels are counted.
type Kept = { model: string; guide: string; session: string; reply: string; opened?: ReadonlySet<string>; question?: Question }
const kept: Kept[] = []
const left = { unread: 0, unrecorded: 0, unguided: 0, early: 0 }
for (const path of paths) {
  let session: ReturnType<typeof sessionOf>
  try {
    session = sessionOf(path)
  } catch {
    left.unread += 1
    continue
  }
  const guides = new Map([...session.systems].map(([hash, system]) => [hash, guideIn(system, named, GUIDE_HEADING)]))
  const isEarly = since !== undefined && (session.turns[0]?.at ?? '').slice(0, 10) < since
  for (const turn of session.turns) {
    if (turn.shapeHash === undefined) {
      left.unrecorded += 1
      continue
    }
    const guide = guides.get(turn.shapeHash)
    if (guide === undefined) {
      left.unguided += 1
      continue
    }
    if (isEarly) {
      left.early += 1
      continue
    }
    kept.push({ model: turn.model ?? 'unknown model', guide, session: turn.session, reply: turn.reply, opened: turn.opened, question: labelsFile === undefined ? undefined : questionOf(turn.reply) })
  }
}

// The judge's verdicts on a reply's links in view, and the models that gave them, by a hash of what
// the judge was asked: the reply as first seen and each link's long form.
type Verdicts = Map<string, Verdict>

/** The verdicts `file` holds. With `mayRepair`, a last line with no line end is mended in the file, as the next row would be joined to it: one a write cut short is dropped. */
function savedIn(file: string, mayRepair: boolean): Verdicts {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let saved: ReturnType<typeof rowsOf>
  try {
    saved = rowsOf(text)
  } catch (error) {
    return fail(`${file}: ${messageOf(error)}`)
  }
  if (mayRepair && text !== '' && !text.endsWith('\n')) writeFileSync(file, saved.isCut ? text.slice(0, text.lastIndexOf('\n') + 1) : `${text}\n`)
  const verdicts: Verdicts = new Map()
  for (const row of saved.rows) {
    const { asked, models, verdicts: given } = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
    if (typeof asked !== 'string' || !Array.isArray(given) || !given.every((v): v is Label => v === 'gist' || v === 'label')) return fail(`${file} holds a row that is no saved verdict`)
    verdicts.set(asked, { given, models: stringsOf(models) ?? [] })
  }
  return verdicts
}

/** Asks `judge` about each kept reply `verdicts` holds nothing for, `concurrency` at a time, and adds each answer to `verdicts` and to `file`. */
async function ask(judge: string, file: string, verdicts: Verdicts): Promise<void> {
  const jobs = new Map<string, Question>()
  for (const { question } of kept) {
    if (question !== undefined && !verdicts.has(question.asked)) jobs.set(question.asked, question)
  }
  if (jobs.size === 0) return
  // Called as `claude` in ab.ts calls it: in an empty folder outside any repository, with stdin closed at once.
  const blank = mkdtempSync(join(tmpdir(), 'cc-stretch-bench-'))
  /** One `claude -p` answer, read as the verdict on each of `links` links. */
  const answerTo = (prompt: string, links: number) =>
    new Promise<Verdict>((resolve, reject) => {
      const child = execFile('claude', claudeArgs(judge, prompt, {}), { maxBuffer: 1 << 26, timeout: 900000, cwd: blank }, (_error, stdout) => {
        try {
          const answer = resultOf(stdout)
          resolve({ given: readLabels(answer.text, links), models: answer.models })
        } catch (reading) {
          reject(reading)
        }
      })
      child.stdin?.end()
    })
  const queue = [...jobs]
  let done = 0
  let failures = 0
  let lastFailure = ''
  console.error(`asking ${judge} about the links of ${jobs.size} replies`)
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (failures < MAX_FAILURES) {
      const job = queue.shift()
      if (job === undefined) break
      const [asked, { prompt, links }] = job
      // An answer that cannot be read is asked for once more, then the reply goes without a verdict.
      for (let attempt = 0; attempt < 2 && !verdicts.has(asked); attempt++) {
        try {
          const answer = await answerTo(prompt, links)
          appendFileSync(file, `${JSON.stringify({ asked, judge, models: answer.models, verdicts: answer.given })}\n`)
          verdicts.set(asked, answer)
          failures = 0
        } catch (error) {
          failures += 1
          lastFailure = messageOf(error)
        }
      }
      done += 1
      if (done % 25 === 0) console.error(`${done} of ${jobs.size} asked`)
    }
  }))
  if (failures >= MAX_FAILURES) console.error(`stopped asking after ${MAX_FAILURES} calls failed in a row (the last: ${lastFailure}); ${queue.length} replies were not asked about`)
}

// With --sessions no rate is printed, so no verdict is asked for.
const judge = flags.sessions ? undefined : flags.judge
const verdicts: Verdicts = labelsFile === undefined ? new Map() : savedIn(labelsFile, judge !== undefined)
if (labelsFile !== undefined && judge !== undefined) await ask(judge, labelsFile, verdicts)

// The counted replies, by model and then by guide, in the order first met.
const found = new Map<string, Map<string, Counted[]>>()
const judgedBy = new Set<string>()
const labelled = { judged: 0, unjudged: 0 }
for (const { model, guide, session, reply, opened, question } of kept) {
  const answer = question === undefined ? undefined : verdicts.get(question.asked)
  if (question !== undefined) labelled[answer === undefined ? 'unjudged' : 'judged'] += 1
  for (const by of answer?.models ?? []) judgedBy.add(by)
  const byGuide = found.get(model) ?? new Map<string, Counted[]>()
  found.set(model, byGuide)
  const replies = byGuide.get(guide) ?? []
  byGuide.set(guide, replies)
  replies.push(counted(session, reply, opened, answer?.given))
}

const percent = (part: number, whole: number) => (whole === 0 ? 'n/a' : `${Math.round((100 * part) / whole)}%`)
const share = (part: number, whole: number) => (whole === 0 ? 'none' : `${part} of ${whole} (${percent(part, whole)})`)
const points = (rate: number) => `${rate > 0 ? '+' : ''}${Math.round(100 * rate)}`

console.log(
  [
    `Live replies whose request carried a guide, in ${paths.length - left.unread} transcripts${left.unread > 0 ? ` (${left.unread} more could not be read)` : ''}${since === undefined ? '' : `, in sessions begun on ${since} or later`}.`,
    `Left out: ${left.unrecorded} replies whose request is not recorded, ${left.unguided} whose request carried no guide${since === undefined ? '' : `, ${left.early} in sessions begun earlier`}.`,
    ...(flags.sessions
      ? ['Under each guide: its replies and their sessions, then the sessions each rate can be taken over.']
      : labelsFile === undefined
      ? []
      : [`Labels: of the replies with a link the label count takes, ${labelled.judged} have the judge's verdicts${judgedBy.size === 0 ? '' : ` (${[...judgedBy].sort().join(', ')})`} and ${labelled.unjudged} have none.`]),
  ].join('\n'),
)

const failures = labelsFile === undefined ? FAILURES : [...FAILURES, LABEL]
const models = [...found].sort(([, a], [, b]) => sum([...b.values()].map(r => r.length)) - sum([...a.values()].map(r => r.length)))
for (const [model, byGuide] of models) {
  const guides = [...byGuide.keys()].sort((a, b) => (a === base ? -1 : b === base ? 1 : (byGuide.get(b)?.length ?? 0) - (byGuide.get(a)?.length ?? 0)))
  const row = (title: string, cell: (replies: Counted[]) => string) => `| ${title} | ${guides.map(guide => cell(byGuide.get(guide) ?? [])).join(' | ')} |`
  const sessions = (replies: Counted[]) => new Set(replies.map(reply => reply.session)).size
  const head = [
    `\n## ${model}\n`,
    `| | ${guides.join(' | ')} |`,
    `|${'---|'.repeat(guides.length + 1)}`,
    row('replies, in sessions', replies => `${replies.length}, in ${sessions(replies)}`),
  ]
  if (flags.sessions) {
    console.log(
      [
        ...head,
        ...FAILURES.map(failure => row(failure.name, replies => String(talliesOf(replies, failure).length))),
        // Before the judge is asked: the sessions that hold a link its verdict would be counted on.
        row(LABEL.name, replies => String(sessions(replies.filter(reply => reply.labelLinks > 0)))),
      ].join('\n'),
    )
    continue
  }
  const noted = (replies: Counted[]) => replies.filter(reply => reply.opened !== undefined && reply.inView > 0)
  console.log(
    [
      ...head,
      row('words with every stretch closed, of words with every one open', replies => percent(sum(replies.map(r => r.skim)), sum(replies.map(r => r.full)))),
      ...failures.map(failure => row(failure.name, replies => {
        const { hits, of } = totalOf(talliesOf(replies, failure))
        return share(hits, of)
      })),
      row('links the reader opened, of links in view, where a reading note followed', replies => share(sum(noted(replies).map(r => r.opened ?? 0)), sum(noted(replies).map(r => r.inView)))),
      row('words the reader had then read, of words with every stretch open', replies => percent(sum(noted(replies).map(r => r.read ?? 0)), sum(noted(replies).map(r => r.full)))),
    ].join('\n'),
  )
  const baseReplies = byGuide.get(base)
  for (const guide of guides) {
    const replies = byGuide.get(guide)
    if (guide === base || baseReplies === undefined || replies === undefined) continue
    console.log(`\n${guide} against ${base}: each rate under ${guide} minus the rate under ${base}, in points, and the interval that holds 95% of that difference when sessions are drawn again.\n`)
    for (const failure of failures) {
      const d = differenceOf(talliesOf(baseReplies, failure), talliesOf(replies, failure))
      console.log(`- ${failure.name}: ${d === undefined ? 'nothing to compare' : `${points(d.difference)} (${points(d.low)} to ${points(d.high)})`}`)
    }
  }
}

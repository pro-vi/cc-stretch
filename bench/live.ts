// Counts how often replies written in live sessions go wrong, by the guide and the model that wrote
// them (bench/README.md, Live), and how two guides differ. Only replies whose request is recorded
// with a guide in its system prompt are counted (Claude Code 2.1.300 to 2.1.322 record it).
//   bun bench/live.ts [--guide <name>=<file>]... [--since <YYYY-MM-DD>] [--against <name>] ~/.claude/projects/*/*.jsonl
// A recorded guide is named `shipped` when it is the plugin's own, by its name in guides.ts when it
// is a variant there, by --guide's name when its text is that file's, and `unnamed` otherwise. A
// guide that only adds text after another's last line is told from it only when it has a name.
// --since leaves out replies written before that day (UTC), as a trial's start does. --against
// names the guide the others are compared with, `shipped` unless given. Runs under bun, as the
// plugin's hooks import each other without file extensions.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { GUIDE } from '../hooks/guide.ts'
import { counted, differenceOf, FAILURES, guideIn, sum, talliesOf, totalOf } from './counts.ts'
import type { Counted } from './counts.ts'
import { VARIANTS } from './guides.ts'
import { messageOf } from './manifest.ts'
import { GUIDE_HEADING, sessionOf } from './transcripts.ts'

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const { values: flags, positionals: paths } = (() => {
  try {
    return parseArgs({ options: { guide: { type: 'string', multiple: true }, since: { type: 'string' }, against: { type: 'string' } }, allowPositionals: true })
  } catch (error) {
    return fail(messageOf(error))
  }
})()
if (paths.length === 0) fail('usage: bun bench/live.ts [--guide <name>=<file>]... [--since <YYYY-MM-DD>] [--against <name>] <transcript.jsonl>...')
const since = flags.since
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail(`--since wants a day as YYYY-MM-DD, not ${since}`)
const base = flags.against ?? 'shipped'

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

// The counted replies, by model and then by guide, in the order first met.
const found = new Map<string, Map<string, Counted[]>>()
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
    if (since !== undefined && (turn.at ?? '').slice(0, 10) < since) {
      left.early += 1
      continue
    }
    const model = turn.model ?? 'unknown model'
    const byGuide = found.get(model) ?? new Map<string, Counted[]>()
    found.set(model, byGuide)
    const replies = byGuide.get(guide) ?? []
    byGuide.set(guide, replies)
    replies.push(counted(turn.session, turn.reply, turn.opened))
  }
}

const percent = (part: number, whole: number) => (whole === 0 ? 'n/a' : `${Math.round((100 * part) / whole)}%`)
const share = (part: number, whole: number) => (whole === 0 ? 'none' : `${part} of ${whole} (${percent(part, whole)})`)
const points = (rate: number) => `${rate > 0 ? '+' : ''}${Math.round(100 * rate)}`

console.log(
  [
    `Live replies whose request carried a guide, in ${paths.length - left.unread} transcripts${left.unread > 0 ? ` (${left.unread} more could not be read)` : ''}${since === undefined ? '' : `, written on ${since} or later`}.`,
    `Left out: ${left.unrecorded} replies whose request is not recorded, ${left.unguided} whose request carried no guide${since === undefined ? '' : `, ${left.early} written earlier`}.`,
  ].join('\n'),
)

const models = [...found].sort(([, a], [, b]) => sum([...b.values()].map(r => r.length)) - sum([...a.values()].map(r => r.length)))
for (const [model, byGuide] of models) {
  const guides = [...byGuide.keys()].sort((a, b) => (a === base ? -1 : b === base ? 1 : (byGuide.get(b)?.length ?? 0) - (byGuide.get(a)?.length ?? 0)))
  const row = (title: string, cell: (replies: Counted[]) => string) => `| ${title} | ${guides.map(guide => cell(byGuide.get(guide) ?? [])).join(' | ')} |`
  const noted = (replies: Counted[]) => replies.filter(reply => reply.opened !== undefined && reply.inView > 0)
  console.log(
    [
      `\n## ${model}\n`,
      `| | ${guides.join(' | ')} |`,
      `|${'---|'.repeat(guides.length + 1)}`,
      row('replies, in sessions', replies => `${replies.length}, in ${new Set(replies.map(reply => reply.session)).size}`),
      row('words with every stretch closed, of words with every one open', replies => percent(sum(replies.map(r => r.skim)), sum(replies.map(r => r.full)))),
      ...FAILURES.map(failure => row(failure.name, replies => {
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
    for (const failure of FAILURES) {
      const d = differenceOf(talliesOf(baseReplies, failure), talliesOf(replies, failure))
      console.log(`- ${failure.name}: ${d === undefined ? 'no replies to compare' : `${points(d.difference)} (${points(d.low)} to ${points(d.high)})`}`)
    }
  }
}

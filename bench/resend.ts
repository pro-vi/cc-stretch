// Sends a request recorded in a live session again with its guide swapped, and counts what the
// replies do (bench/README.md, Sending a live request again).
//   bun bench/resend.ts cases --out <dir> [--where stretch|closing|dropped] [--per-session 1]
//                             [--guide <name>=<file>]... <transcript>...
//   bun bench/resend.ts verify --out <dir> [--case <n>]...
//   bun bench/resend.ts run --out <dir> --arm <guide>... [--guide <name>=<file>]... [--repeats 2]
//                           [--concurrency 2] [--case <n>]...
//   bun bench/resend.ts report --out <dir>
// cases freezes <dir>/cases.json. A case is one assistant row's text that --where picks, whose
// request rebuilds to its recorded digest, holds a guide this bench can name in exactly one system
// block, and fits a settings file. --per-session takes that many, spread over the session. A guide
// is named as in guides.ts (the plugin's own is `g0`), or by --guide.
// verify sends a case unchanged to a receiver on this machine: without --case, the first case of
// each model and effort. run sends only cases whose model and effort verify has passed under the
// Claude Code now installed.
// run sends a case under one arm, then its repeats, before the next, so a repeat can read the
// prompt its first send cached. It ends at the first reply, and a reply that asks for a tool is counted,
// not read. A reply is kept with the guide text and Claude Code version it was sent under; a folder
// that holds one sent under another is refused.
// A case file names transcripts and the replies hold a session's text: keep <dir> under
// bench/out/, which git ignores. Runs under bun, as the plugin's hooks import each other without
// file extensions.
import { execFile, execFileSync } from 'node:child_process'
import { hash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { CLOSING, closingOf, isInStretch } from './closing.ts'
import type { Closing } from './closing.ts'
import { counted, FAILURES, guideIn, sum, totalOf } from './counts.ts'
import { VARIANTS } from './guides.ts'
import { lock } from './lock.ts'
import { messageOf } from './manifest.ts'
import { marked, measure } from './measure.ts'
import { canonical, recordingOf, requestBehind } from './requests.ts'
import type { Body, Recording } from './requests.ts'
import { GUIDE_HEADING, linesOf } from './transcripts.ts'

/** Claude Code 2.1.304 refuses a `--settings` file over 2 MiB, and the rebuilt request travels in one. */
const SETTINGS_LIMIT = 2 * 1048576
const sha256 = (text: string) => hash('sha256', text)
const settingsOf = (body: Body) => JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(body) } })

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const OPTIONS = {
  out: { type: 'string' }, where: { type: 'string' }, 'per-session': { type: 'string' }, guide: { type: 'string', multiple: true },
  case: { type: 'string', multiple: true }, arm: { type: 'string', multiple: true }, repeats: { type: 'string' }, concurrency: { type: 'string' },
} as const
/** Each command takes only its own flags, so a misspelt or misplaced one stops it instead of being ignored. */
const FLAGS: Record<string, readonly string[]> = {
  cases: ['out', 'where', 'per-session', 'guide'], verify: ['out', 'case'], run: ['out', 'arm', 'guide', 'repeats', 'concurrency', 'case'], report: ['out'],
}
const { positionals, values } = (() => {
  try {
    return parseArgs({ allowPositionals: true, options: OPTIONS })
  } catch (error) {
    return fail(messageOf(error))
  }
})()
const [command = '', ...transcripts] = positionals
const allowed = FLAGS[command] ?? fail(`usage: bun bench/resend.ts ${Object.keys(FLAGS).join('|')} --out <dir> ...`)
const stray = Object.keys(values).find(name => !allowed.includes(name))
if (stray !== undefined) fail(`${command} takes no --${stray}`)
const out = values.out ?? fail('--out <dir> is required')
const casesFile = join(out, 'cases.json'), verifiedFile = join(out, 'verified.json'), replies = join(out, 'replies')
/** `given` as a whole number of at least `least`, or `fallback` where the flag `name` was left out. */
const count = (name: string, given: string | undefined, fallback: number, least = 1): number => {
  if (given === undefined) return fallback
  return /^\d+$/.test(given) && Number(given) >= least ? Number(given) : fail(`--${name} wants a whole number of at least ${least}, not ${given}`)
}
const claudeVersion = () => execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim()

/** The guides this run can name: the variants of guides.ts, then each --guide <name>=<file>. */
function guides(): Map<string, string> {
  const named = new Map(Object.entries(VARIANTS))
  for (const given of values.guide ?? []) {
    const at = given.indexOf('=')
    if (at < 1) fail(`--guide wants <name>=<file>, not ${given}`)
    try {
      named.set(given.slice(0, at), readFileSync(given.slice(at + 1), 'utf8').trim())
    } catch {
      fail(`--guide ${given}: cannot read ${given.slice(at + 1)}`)
    }
  }
  return named
}

/** The request behind one reply of a transcript: where it is, its digest, and what was recorded of it. No text. */
type Case = {
  transcript: string; line: number; digest: string; version: string; model: string; effort?: string
  /** The name of the guide its system prompt held, the bytes it takes in a settings file, and what became of the recorded reply's closing block. */
  guide: string; bytes: number; closing: Closing
}
const readCases = (): Case[] => (existsSync(casesFile) ? (JSON.parse(readFileSync(casesFile, 'utf8')) as Case[]) : fail(`${casesFile}: no cases yet; run \`cases\` first`))
/** The cases `--case` names, each with its index, or all of them. */
function selected(all: Case[]): { c: Case; index: number }[] {
  const only = values.case?.map(given => count('case', given, 0, 0))
  const unknown = only?.find(index => all[index] === undefined)
  if (unknown !== undefined) fail(`no case ${unknown}`)
  return all.map((c, index) => ({ c, index })).filter(({ index }) => only === undefined || only.includes(index))
}
/** A case's model and effort: `verify` shows that a request with these arrives unchanged. */
const pairOf = (c: Case) => `${c.model}, ${c.effort ?? 'default'} effort`
/** The text of the guide a case's session ran under, as `cases` kept it. */
const ownGuide = (c: Case) => readFileSync(join(out, `guide-${c.guide}.txt`), 'utf8')

const WHERE: Record<string, (text: string) => boolean> = {
  stretch: text => marked(text).longs.length > 0,
  closing: text => isInStretch(closingOf(text)),
  dropped: text => closingOf(text) === 'dropped',
}

/** The case for the reply at `line`; throws, saying why, where its request cannot be sent again. */
function caseOf(recording: Recording, transcript: string, line: number, reply: { text: string; version?: string }, named: Map<string, string>): Case {
  const { body, digest } = requestBehind(recording, line)
  const system = body.system.map(block => block.text ?? '')
  const guide = guideIn(system.join('\n'), named, GUIDE_HEADING)
  const text = guide === undefined ? undefined : named.get(guide)
  if (guide === undefined || text === undefined) throw new Error('its guide has no name here')
  // The guide is swapped in place, so exactly one system block must hold it.
  if (system.filter(block => block.includes(text)).length !== 1) throw new Error('its guide is not in exactly one system block')
  const bytes = Buffer.byteLength(settingsOf(body))
  if (bytes > SETTINGS_LIMIT) throw new Error('its request is too large to send')
  return { transcript, line, digest, version: reply.version ?? '', model: body.model, effort: body.output_config?.effort, guide, bytes, closing: closingOf(reply.text) }
}

function cases() {
  if (transcripts.length === 0) fail('cases wants the transcripts to read, as ~/.claude/projects/<dir>/<session>.jsonl')
  if (existsSync(casesFile)) fail(`${casesFile} is already frozen; use another --out`)
  const picks = WHERE[values.where ?? 'stretch'] ?? fail(`--where is one of ${Object.keys(WHERE).join(', ')}`)
  const perSession = count('per-session', values['per-session'], 1)
  const named = guides()
  const frozen: Case[] = []
  for (const transcript of transcripts) {
    const recording = recordingOf(linesOf(transcript, true), sha256)
    const eligible: Case[] = []
    const leftOut = new Map<string, number>()
    for (const [line, reply] of recording.replies) {
      if (!picks(reply.text)) continue
      try {
        eligible.push(caseOf(recording, transcript, line, reply, named))
      } catch (error) {
        leftOut.set(messageOf(error), (leftOut.get(messageOf(error)) ?? 0) + 1)
      }
    }
    const step = Math.max(1, Math.floor(eligible.length / perSession))
    const taken = eligible.filter((_, i) => i % step === 0).slice(0, perSession)
    console.log(`${basename(transcript)}: ${eligible.length} replies could be sent again, ${taken.length} taken${[...leftOut].map(([why, n]) => `; ${n} left out: ${why}`).join('')}`)
    frozen.push(...taken)
  }
  if (frozen.length === 0) fail('no reply of these transcripts can be sent again')
  mkdirSync(out, { recursive: true })
  for (const name of new Set(frozen.map(c => c.guide))) writeFileSync(join(out, `guide-${name}.txt`), named.get(name) ?? '')
  writeFileSync(casesFile, `${JSON.stringify(frozen, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(`froze ${frozen.length} cases in ${casesFile}`)
}

/** Each of `some` cases' requests by digest, rebuilt and held to the digest frozen for it. A transcript is read once for all of its cases. */
function rebuilt(some: Case[]): Map<string, Body> {
  const bodies = new Map<string, Body>()
  for (const transcript of new Set(some.map(c => c.transcript))) {
    const mine = some.filter(c => c.transcript === transcript)
    const recording = recordingOf(linesOf(transcript, true), sha256, Math.max(...mine.map(c => c.line)))
    for (const c of mine) {
      const request = requestBehind(recording, c.line)
      if (request.digest !== c.digest) fail(`${transcript}, line ${c.line}, no longer rebuilds to its frozen request`)
      bodies.set(c.digest, request.body)
    }
  }
  return bodies
}

/** A copy of `body` with the guide `own` of its session replaced by `guide`. */
function armed(body: Body | undefined, own: string, guide: string): Body {
  const copy = structuredClone(body ?? fail('a request was not rebuilt'))
  const holder = copy.system.find(block => (block.text ?? '').includes(own)) ?? fail('a request no longer holds its guide')
  // As a function, so that a `$` in a guide's text is not read as a replacement pattern.
  holder.text = (holder.text ?? '').replace(own, () => guide)
  return copy
}

/** What one `claude -p` run with a rebuilt request gave: its text, the tools it asked for, and how it ended. */
type Sent = { exitCode: number | null; text: string; tools: string[]; error?: string }
const outcomeOf = (sent: Sent): 'tool' | 'text' | 'failed' => (sent.tools.length > 0 ? 'tool' : sent.exitCode === 0 && sent.text.trim() !== '' ? 'text' : 'failed')

/**
 * Sends `body` through `claude -p` as the whole request: as of Claude Code 2.1.326 it merges
 * CLAUDE_CODE_EXTRA_BODY, here set in a settings file, over the request it would have made, which
 * `verify` checks. The file holds a session's conversation, so only this user can read it and it is
 * removed after the call.
 */
function send(body: Body, effort: string | undefined, env: Record<string, string | undefined> = {}): Promise<Sent> {
  const folder = mkdtempSync(join(tmpdir(), 'cc-stretch-resend-'))
  const settings = join(folder, 'settings.json')
  writeFileSync(settings, settingsOf(body), { mode: 0o600 })
  const args = ['-p', '--safe-mode', '--settings', settings, '--no-session-persistence', '--tools', '', '--max-turns', '1', '--model', body.model,
    ...(effort === undefined ? [] : ['--effort', effort]), '--output-format', 'stream-json', '--verbose', 'Continue.']
  type Event = { type?: string; is_error?: boolean; result?: unknown; message?: { content?: { type?: string; text?: string; name?: string }[] } }
  return new Promise(resolve => {
    const child = execFile('claude', args, { maxBuffer: 1 << 26, timeout: 900000, cwd: folder, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...env } }, (error, stdout, stderr) => {
      rmSync(folder, { recursive: true, force: true })
      // One event a line; a line that is no JSON is not an event.
      const events = stdout.split('\n').flatMap((line): Event[] => {
        try {
          return [JSON.parse(line) as Event]
        } catch {
          return []
        }
      })
      const blocks = events.flatMap(event => (event.type === 'assistant' ? (event.message?.content ?? []) : []))
      const refused = events.find(event => event.type === 'result' && event.is_error === true && typeof event.result === 'string')
      const why = refused !== undefined ? String(refused.result).split('\n')[0] : error === null ? undefined : (/\S.*/.exec(stderr)?.[0] ?? messageOf(error))
      resolve({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        text: blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'),
        tools: blocks.filter(block => block.type === 'tool_use').map(block => block.name ?? ''),
        ...(why !== undefined && { error: why }),
      })
    })
    child.stdin?.end()
  })
}

/** Sends `body` to a receiver on this machine, and says how what arrived differs from it: undefined where it arrived as meant. */
async function arrival(body: Body, effort: string | undefined): Promise<string | undefined> {
  const intended = body as Record<string, unknown>
  let differing: string[] | undefined
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const arrived = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
      // As of Claude Code 2.1.326: what it adds for the transport is no part of a recorded request, and its beta names travel in a header.
      for (const key of ['metadata', 'stream', 'thread', 'diagnostics']) delete arrived[key]
      arrived.betas = String(request.headers['anthropic-beta'] ?? '').split(',').filter(Boolean)
      differing = [...new Set([...Object.keys(arrived), ...Object.keys(intended)])].filter(key => canonical(arrived[key]) !== canonical(intended[key]))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      event('message_start', { message: { id: 'msg_receiver', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'RECEIVED' } })
      event('content_block_stop', { index: 0 })
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
      event('message_stop', {})
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // An empty profile and made-up credentials: nothing of this account goes to the receiver, and nothing reaches a model.
  const profile = mkdtempSync(join(tmpdir(), 'cc-stretch-resend-profile-'))
  const sent = await send(body, effort, {
    CLAUDE_CONFIG_DIR: profile, ANTHROPIC_API_KEY: 'receiver-only', ANTHROPIC_AUTH_TOKEN: 'receiver-only', CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_CUSTOM_HEADERS: undefined,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  })
  await new Promise(resolve => server.close(resolve))
  rmSync(profile, { recursive: true, force: true })
  if (differing === undefined) return `nothing reached the receiver (${sent.error ?? `exit ${sent.exitCode}`})`
  if (differing.length > 0) return `these fields differ: ${differing.join(', ')}`
  // The receiver's answer read back shows that a reply's text is read from what Claude Code prints.
  return sent.text === 'RECEIVED' ? undefined : `the receiver's answer came back as ${JSON.stringify(sent.text.slice(0, 40))}`
}

/** The Claude Code version `verify` last ran under, and the model and effort pairs it passed there. */
type Verified = { claude: string; pairs: string[] }
const readVerified = (): Verified => (existsSync(verifiedFile) ? (JSON.parse(readFileSync(verifiedFile, 'utf8')) as Verified) : { claude: '', pairs: [] })

async function verify() {
  const all = readCases()
  // Without --case, the first case of each model and effort.
  const checked = selected(all).filter(({ c, index }) => values.case !== undefined || all.findIndex(other => pairOf(other) === pairOf(c)) === index)
  const bodies = rebuilt(checked.map(({ c }) => c))
  const claude = claudeVersion()
  const before = readVerified()
  const pairs = new Set(before.claude === claude ? before.pairs : [])
  for (const { c, index } of checked) {
    const why = await arrival(armed(bodies.get(c.digest), ownGuide(c), ownGuide(c)), c.effort)
    // A failure takes back an earlier pass for the same model and effort.
    if (why === undefined) pairs.add(pairOf(c))
    else {
      pairs.delete(pairOf(c))
      process.exitCode = 1
    }
    console.log(why === undefined ? `case ${index} (${pairOf(c)}) arrived as it was meant, under ${claude}` : `case ${index} (${pairOf(c)}) did not arrive as meant: ${why}`)
  }
  writeFileSync(verifiedFile, `${JSON.stringify({ claude, pairs: [...pairs] } satisfies Verified, null, 2)}\n`)
}

/** A reply as kept in the run folder, with the SHA-256 of the guide text and the Claude Code version it was sent under. */
type Reply = Sent & { case: number; arm: string; repeat: number; guide: string; claude: string }
const replyFile = (index: number, arm: string, repeat: number) => join(replies, `${index}-${arm}-${repeat}.json`)

async function run() {
  const chosen = selected(readCases())
  const arms = values.arm ?? []
  const named = guides()
  if (arms.length === 0) fail(`--arm <guide> is required: ${[...named.keys()].join(', ')}`)
  const unknown = arms.find(arm => !named.has(arm))
  if (unknown !== undefined) fail(`--arm ${unknown} names no guide; give its text with --guide ${unknown}=<file>`)
  const claude = claudeVersion()
  const verified = readVerified()
  const unverified = chosen.find(({ c }) => verified.claude !== claude || !verified.pairs.includes(pairOf(c)))
  if (unverified !== undefined) fail(`no request for ${pairOf(unverified.c)} has been shown to arrive unchanged under ${claude}; run \`verify\` first`)
  const repeats = count('repeats', values.repeats, 2)
  const concurrency = count('concurrency', values.concurrency, 2)
  try {
    lock(out)
  } catch (error) {
    fail(messageOf(error))
  }
  mkdirSync(replies, { recursive: true })
  /** Whether a slot already holds a reply or a tool request. One sent under another guide text or Claude Code version stops the run: a report would count it under this one. */
  const isSent = (index: number, arm: string, repeat: number): boolean => {
    const file = replyFile(index, arm, repeat)
    if (!existsSync(file)) return false
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Reply
    if (outcomeOf(kept) === 'failed') return false
    return kept.guide === sha256(named.get(arm) ?? '') && kept.claude === claude ? true : fail(`${file} was sent under another guide text or Claude Code version; use a new --out`)
  }
  // A case under one arm, with its repeats one after another, is one unit of work for one worker.
  const units = chosen.flatMap(({ c, index }) => arms.map(arm => ({ c, index, arm, todo: Array.from({ length: repeats }, (_, r) => r + 1).filter(repeat => !isSent(index, arm, repeat)) })))
    .filter(unit => unit.todo.length > 0)
  const bodies = rebuilt(units.map(unit => unit.c))
  const queue = units.values()
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (const { c, index, arm, todo } of queue) {
      const guide = named.get(arm) ?? ''
      const body = armed(bodies.get(c.digest), ownGuide(c), guide)
      for (const repeat of todo) {
        const sent = await send(body, c.effort)
        writeFileSync(replyFile(index, arm, repeat), `${JSON.stringify({ case: index, arm, repeat, guide: sha256(guide), claude, ...sent } satisfies Reply, null, 2)}\n`, { mode: 0o600 })
        console.log(`case ${index}, ${arm}, repeat ${repeat}: ${{ tool: 'asked for a tool', text: 'replied', failed: `failed: ${sent.error ?? `exit ${sent.exitCode}`}` }[outcomeOf(sent)]}`)
      }
    }
  }))
}

function report() {
  const all = readCases()
  const found = existsSync(replies) ? readdirSync(replies).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(replies, name), 'utf8')) as Reply) : []
  if (found.length === 0) fail(`${out} holds no reply yet`)
  // Arms in the order guides.ts names them, then any other.
  const sent = new Set(found.map(reply => reply.arm))
  const arms = [...Object.keys(VARIANTS).filter(arm => sent.has(arm)), ...[...sent].filter(arm => !Object.hasOwn(VARIANTS, arm)).sort()]
  // What each text reply did, worked out once.
  const read = new Map(found.filter(reply => outcomeOf(reply) === 'text').map(reply => [reply, { counts: counted(String(reply.case), reply.text), closing: closingOf(reply.text), sizes: measure(reply.text) }] as const))
  const texts = (mine: Reply[]) => mine.flatMap(reply => read.get(reply) ?? [])
  const mean = (numbers: number[]) => (numbers.length === 0 ? 'n/a' : String(Math.round(sum(numbers) / numbers.length)))
  type Row = [string, (mine: Reply[]) => string | number]
  const rows: Row[] = [
    ['requests sent', mine => mine.length],
    ['asked for a tool', mine => mine.filter(reply => outcomeOf(reply) === 'tool').length],
    ['failed', mine => mine.filter(reply => outcomeOf(reply) === 'failed').length],
    ['replied', mine => texts(mine).length],
    ...Object.entries(CLOSING).map(([closing, { label }]): Row => [label, mine => texts(mine).filter(reply => reply.closing === closing).length]),
    ...FAILURES.map((failure): Row => [failure.name, mine => {
      const { hits, of } = totalOf(texts(mine).map(reply => failure.tally(reply.counts)))
      return `${hits} of ${of}`
    }]),
    ['words closed / open, a reply', mine => `${mean(texts(mine).map(reply => reply.sizes.skim))} / ${mean(texts(mine).map(reply => reply.sizes.full))}`],
  ]
  console.log(`${all.length} cases, ${found.length} requests sent under ${[...new Set(found.map(reply => reply.claude))].join(' and ')}\n\n| | ${arms.join(' | ')} |\n|${'---|'.repeat(arms.length + 1)}`)
  for (const [name, cell] of rows) console.log(`| ${name} | ${arms.map(arm => cell(found.filter(reply => reply.arm === arm))).join(' | ')} |`)
  console.log(`\nBy case: its model, the guide its session ran under and what became of the recorded reply's closing block; then, per arm, each reply in order (t asked for a tool, x failed, ${Object.values(CLOSING).map(({ code, label }) => `${code} ${label}`).join(', ')})\n`)
  all.forEach((c, index) => {
    const mine = found.filter(reply => reply.case === index).sort((a, b) => a.repeat - b.repeat)
    if (mine.length === 0) return
    const cell = (arm: string) => mine.filter(reply => reply.arm === arm).map(reply => {
      const closing = read.get(reply)?.closing
      return closing !== undefined ? CLOSING[closing].code : outcomeOf(reply) === 'tool' ? 't' : 'x'
    }).join('')
    console.log(`- case ${index} (${c.model}, ${c.guide}, ${CLOSING[c.closing].code}): ${arms.map(arm => `${arm} ${cell(arm) || '-'}`).join(' | ')}`)
  })
}

// `command` is one of FLAGS's keys by now.
const COMMANDS = { cases, verify, run, report }
await COMMANDS[command as keyof typeof COMMANDS]()

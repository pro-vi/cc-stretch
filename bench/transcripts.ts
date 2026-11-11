// Reads Claude Code session transcripts (the JSONL files under ~/.claude/projects, as written by
// Claude Code 2.1.29x to 2.1.322) into turns: the person's prompt, the reply they read, the request
// that wrote it (its system prompt, model and the context tokens it read) where the transcript
// records it, and the reading note cc-stretch attached to their next prompt, if any. `turnsOf` gives
// the turns; `sessionOf` gives them with each system prompt their requests carried.
import { closeSync, openSync, readSync } from 'node:fs'
import { GUIDE } from '../hooks/guide.ts'
import { openedFrom } from './measure.ts'
import { shortsNamed } from './opened.ts'

/** The guide's heading, which a system prompt holds when cc-stretch added the guide to it. */
export const GUIDE_HEADING = GUIDE.slice(0, GUIDE.indexOf('\n'))

export type Turn = {
  session: string
  index: number
  prompt: string
  /** The text after the turn's last tool call: what the person reads as the answer. */
  reply: string
  /** When the reply's last text was written, as the transcript stamps it. */
  at?: string
  /**
   * Whether the request that wrote the reply carried the guide in its system prompt, and the tokens
   * that request read as context. Claude Code 2.1.300 to 2.1.322 record both; undefined where the
   * transcript does not.
   */
  guided?: boolean
  context?: number
  /** The hash `Session.systems` holds that request's system prompt under, and the model it asked for; undefined where the transcript does not record the request. */
  shapeHash?: string
  model?: string
  /**
   * Short forms the reader opened, from the note on the next prompt, beside the names it gives stretches
   * with no words of their own (bench/opened.ts); undefined when there was none.
   */
  opened?: Set<string>
}

type Block = { type?: string; text?: string }
type Usage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
type Row = {
  type?: string
  isMeta?: boolean
  timestamp?: string
  /** Set on newer transcripts: `human` for a prompt the person typed. */
  origin?: { kind?: string }
  message?: { role?: string; content?: string | Block[]; usage?: Usage }
  attachment?: { type?: string; content?: unknown }
  /**
   * As of Claude Code 2.1.322: an `api-request` row holds the request's `id`, the `shapeHash` of its
   * system prompt and, in `params`, what it asked for; an `api-request-shape` row holds that system
   * prompt under the same hash; and an assistant row names its request by id in `requestRef`.
   */
  id?: string
  requestRef?: string
  shapeHash?: string
  shape?: { system?: Block[] }
  params?: { model?: string }
}

/** A transcript's turns, and each system prompt its requests carried, by the hash a turn names it by. */
export type Session = { turns: Turn[]; systems: Map<string, string> }

/** How an `api-request-blob` row starts, as of Claude Code 2.1.322: a request's body, most of a recent transcript's bytes, and nothing a turn is read from. */
const BLOB = Buffer.from('{"type":"api-request-blob"')

/**
 * A file's lines, one at a time, without the rows that hold request bodies. The file is never held
 * whole: a long session's transcript runs past the longest string node can make (536 MB as of Node
 * 24.14.0).
 */
function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(1 << 20)
    let held: Buffer[] = []
    const lineOf = (last: Buffer) => {
      const line = held.length === 0 ? last : Buffer.concat([...held, last])
      held = []
      return line.length === 0 || line.subarray(0, BLOB.length).equals(BLOB) ? undefined : line.toString('utf8')
    }
    for (let size = readSync(fd, chunk, 0, chunk.length, null); size > 0; size = readSync(fd, chunk, 0, chunk.length, null)) {
      const read = chunk.subarray(0, size)
      let start = 0
      for (let end = read.indexOf(10); end !== -1; end = read.indexOf(10, start)) {
        const line = lineOf(read.subarray(start, end))
        if (line !== undefined) yield line
        start = end + 1
      }
      // The next read overwrites the chunk, so what is left of it is copied.
      if (start < size) held.push(Buffer.from(read.subarray(start)))
    }
    const line = lineOf(Buffer.alloc(0))
    if (line !== undefined) yield line
  } finally {
    closeSync(fd)
  }
}

const textOf = (content: string | Block[] | undefined) =>
  typeof content === 'string' ? content : (content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')

/**
 * A prompt the person typed. Newer transcripts say so in `origin`; older ones are judged by
 * content: not a tool result, a reminder, a command's echo, a skill's text or a notification.
 */
function isPrompt(row: Row): boolean {
  if (row.type !== 'user' || row.isMeta || row.message?.role !== 'user') return false
  if (row.origin !== undefined) return row.origin.kind === 'human'
  const content = row.message.content
  if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) return false
  const text = textOf(content).trim()
  return text !== '' && !/^(<|Base directory for this skill|\[Image|Caveat:|This session is being continued)/.test(text)
}

export const turnsOf = (path: string): Turn[] => sessionOf(path).turns

export function sessionOf(path: string): Session {
  const session = path.split('/').pop()?.replace('.jsonl', '') ?? path
  const turns: Turn[] = []
  // Each system prompt, and whether it holds the guide, by its hash; and what each request asked for, by its id.
  const systems = new Map<string, string>()
  const guidedShapes = new Map<string, boolean>()
  const requests = new Map<string, { shapeHash: string; model?: string }>()
  let current: { prompt: string; texts: string[]; request?: string; context?: number; at?: string } | null = null
  const close = () => {
    if (current && current.texts.length > 0) {
      const request = requests.get(current.request ?? '')
      const guided = request === undefined ? undefined : guidedShapes.get(request.shapeHash)
      turns.push({
        session, index: turns.length, prompt: current.prompt, reply: current.texts.join('\n\n').trim(), at: current.at, guided, context: current.context,
        ...(request !== undefined && guided !== undefined && { shapeHash: request.shapeHash, model: request.model }),
      })
    }
  }
  // A line that is no JSON is the last one of a session still being written; anywhere else the file is not a transcript.
  let cut = false
  for (const line of linesOf(path)) {
    if (cut) throw new Error(`${path}: a line before the last is not JSON`)
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      cut = true
      continue
    }
    if (row.type === 'api-request-shape' && row.shapeHash !== undefined) {
      const system = (row.shape?.system ?? []).map(block => block.text ?? '').join('\n')
      systems.set(row.shapeHash, system)
      guidedShapes.set(row.shapeHash, system.includes(GUIDE_HEADING))
      continue
    }
    if (row.type === 'api-request' && row.id !== undefined && row.shapeHash !== undefined) {
      requests.set(row.id, { shapeHash: row.shapeHash, model: row.params?.model })
      continue
    }
    if (isPrompt(row)) {
      close()
      current = { prompt: textOf(row.message?.content).trim(), texts: [] }
      continue
    }
    const note = row.type === 'attachment' && row.attachment?.type === 'hook_additional_context' ? JSON.stringify(row.attachment.content) : ''
    const last = turns.at(-1)
    if (note.includes('Stretchtext:') && last !== undefined) {
      const text = JSON.parse(`"${/Stretchtext:[^"\\]*(?:\\.[^"\\]*)*/.exec(note)?.[0] ?? ''}"`) as string
      last.opened = shortsNamed(last.reply, openedFrom(text))
      continue
    }
    if (!current || row.type !== 'assistant') continue
    const content = row.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      // A tool call starts the reply over: only the text after the last one is the answer.
      if (block.type === 'tool_use') current.texts = []
      else if (block.type === 'text' && (block.text ?? '').trim() !== '') {
        current.texts.push(block.text ?? '')
        current.request = row.requestRef
        current.at = row.timestamp
        const usage = row.message?.usage
        current.context = usage && (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      }
    }
  }
  close()
  return { turns, systems }
}

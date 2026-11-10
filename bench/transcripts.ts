// Reads Claude Code session transcripts (the JSONL files under ~/.claude/projects, as written by
// Claude Code 2.1.29x to 2.1.322) into turns: the person's prompt, the reply they read, whether the
// request that wrote it carried the guide and the context tokens it read, where the transcript
// records them, and the reading note cc-stretch attached to their next prompt, if any.
import { readFileSync } from 'node:fs'
import { GUIDE } from '../hooks/guide.ts'
import { openedFrom } from './measure.ts'
import { shortsNamed } from './opened.ts'

/** The guide's heading, which a system prompt holds when cc-stretch added the guide to it. */
const GUIDE_HEADING = GUIDE.slice(0, GUIDE.indexOf('\n'))

export type Turn = {
  session: string
  index: number
  prompt: string
  /** The text after the turn's last tool call: what the person reads as the answer. */
  reply: string
  /**
   * Whether the request that wrote the reply carried the guide in its system prompt, and the tokens
   * that request read as context. Claude Code 2.1.300 to 2.1.322 record both; undefined where the
   * transcript does not.
   */
  guided?: boolean
  context?: number
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
  /** Set on newer transcripts: `human` for a prompt the person typed. */
  origin?: { kind?: string }
  message?: { role?: string; content?: string | Block[]; usage?: Usage }
  attachment?: { type?: string; content?: unknown }
  /**
   * As of Claude Code 2.1.322: an `api-request` row holds the request's `id` and the `shapeHash` of
   * its system prompt, an `api-request-shape` row holds that system prompt under the same hash, and
   * an assistant row names its request by id in `requestRef`.
   */
  id?: string
  requestRef?: string
  shapeHash?: string
  shape?: { system?: Block[] }
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

export function turnsOf(path: string): Turn[] {
  const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const session = path.split('/').pop()?.replace('.jsonl', '') ?? path
  const turns: Turn[] = []
  // Whether each system prompt holds the guide, by its hash, and each request's system prompt hash, by its id.
  const guidedShapes = new Map<string, boolean>()
  const shapeOf = new Map<string, string>()
  let current: { prompt: string; texts: string[]; request?: string; context?: number } | null = null
  const close = () => {
    if (current && current.texts.length > 0) {
      const guided = guidedShapes.get(shapeOf.get(current.request ?? '') ?? '')
      turns.push({ session, index: turns.length, prompt: current.prompt, reply: current.texts.join('\n\n').trim(), guided, context: current.context })
    }
  }
  for (const row of rows) {
    if (row.type === 'api-request-shape' && row.shapeHash !== undefined) {
      guidedShapes.set(row.shapeHash, (row.shape?.system ?? []).some(block => block.text?.includes(GUIDE_HEADING) === true))
      continue
    }
    if (row.type === 'api-request' && row.id !== undefined && row.shapeHash !== undefined) {
      shapeOf.set(row.id, row.shapeHash)
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
        const usage = row.message?.usage
        current.context = usage && (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      }
    }
  }
  close()
  return turns
}

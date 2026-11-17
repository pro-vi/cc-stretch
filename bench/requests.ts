// Rebuilds the requests Claude Code recorded in a session transcript, so that one can be sent again
// with one thing changed (resend.ts). As read from transcripts of Claude Code 2.1.302 to 2.1.325, a
// transcript holds, beside its user and assistant rows:
//   api-request-shape  a system prompt and tool list, under a hash
//   api-request-blob   a message the transcript's own rows do not hold whole, under a hash
//   api-request        one request: what it asked for, its shape's hash, its messages by hash (the
//                      first `keep` of an earlier request's, then a tail), where cache marks sit,
//                      and the digest of the whole request
// and an assistant row names the request that wrote it. A request rebuilt here is checked against
// that digest, so what is sent again is the recorded request or nothing. The hashes are SHA-256; the
// caller hands the function in, since a module the plugin's tests load imports no node module.

/**
 * `value` as JSON with every object's keys sorted, the text Claude Code hashes. Message and shape
 * hashes leave `cache_control` out; a request's digest keeps it.
 */
export function canonical(value: unknown, omitCache = false): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, omitCache)).join(',')}]`
  return `{${Object.keys(value).sort().filter(key => !(omitCache && key === 'cache_control'))
    .map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key), omitCache)}`).join(',')}}`
}

type Block = { type?: string; text?: string }
type Message = { role: string; content: Block[] }
/** A request as Claude Code sends it: what it asked for, its system prompt and tools, and its messages. */
export type Body = { model: string; system: Block[]; messages: Message[]; output_config?: { effort?: string }; betas?: string[] }

type Request = { shapeHash: string; params: object; refs: string[]; cacheControl: { path: (string | number)[]; value: unknown }[]; digest: string; isWhole: boolean }
/** What a transcript records of its requests: messages and shapes by hash, requests by id, and each reply's text by the line of the row that holds it. */
export type Recording = {
  hashOf: (text: string) => string
  messages: Map<string, Message>
  shapes: Map<string, object>
  requests: Map<string, Request>
  replies: Map<number, { text: string; requestRef?: string; version?: string }>
}

const field = (value: unknown, name: string | number): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined)
const blocksOf = (content: unknown): Block[] | undefined =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Block[]) : undefined

/**
 * The recording in a transcript's lines, numbered from 1, up to line `through` where given, with
 * `hashOf` the SHA-256 of a text in hex. A row whose content does not match its own hash throws,
 * with its line. A last line that is no JSON is the one a running session is still writing, and is
 * skipped; anywhere else it throws.
 */
export function recordingOf(lines: Iterable<string>, hashOf: (text: string) => string, through = Infinity): Recording {
  const recording: Recording = { hashOf, messages: new Map(), shapes: new Map(), requests: new Map(), replies: new Map() }
  // A message is written over several rows: consecutive user rows, or assistant rows with one message id.
  let run: { role: string; id: unknown; content: Block[] } | undefined
  let line = 0
  let cutAt = 0
  for (const raw of lines) {
    line += 1
    if (line > through) break
    if (raw === '') continue
    if (cutAt > 0) throw new Error(`line ${cutAt} is not JSON`)
    let row: unknown
    try {
      row = JSON.parse(raw)
    } catch {
      cutAt = line
      continue
    }
    const type = field(row, 'type')
    if (type === 'api-request-shape') {
      const shape = field(row, 'shape'), expected = field(row, 'shapeHash')
      if (typeof shape !== 'object' || shape === null || hashOf(canonical(shape, true)) !== expected) throw new Error(`the shape at line ${line} does not match its hash`)
      recording.shapes.set(String(expected), shape)
    } else if (type === 'api-request-blob') {
      const recorded = field(row, 'message'), content = blocksOf(field(recorded, 'content')), expected = field(row, 'hash')
      const message = { ...(recorded as object), role: String(field(recorded, 'role')), content: content ?? [] }
      if (content === undefined || hashOf(canonical(message, true)) !== expected) throw new Error(`the message at line ${line} does not match its hash`)
      recording.messages.set(String(expected), message)
    } else if (type === 'api-request') {
      const id = field(row, 'id'), keep = field(row, 'keep'), tail = field(row, 'tail'), base = field(row, 'base')
      if (typeof id !== 'string' || typeof keep !== 'number' || !Number.isInteger(keep) || keep < 0 || !Array.isArray(tail)) throw new Error(`the request at line ${line} lists no messages`)
      const earlier = base === undefined ? [] : recording.requests.get(String(base))?.refs
      if (earlier === undefined || keep > earlier.length) throw new Error(`the request at line ${line} builds on one the transcript does not hold`)
      recording.requests.set(id, {
        shapeHash: String(field(row, 'shapeHash')), params: (field(row, 'params') ?? {}) as object, refs: [...earlier.slice(0, keep), ...tail.map(String)],
        cacheControl: (field(row, 'cacheControl') ?? []) as Request['cacheControl'], digest: String(field(row, 'requestDigest')),
        isWhole: field(row, 'cut') === undefined && field(row, 'withheld') === undefined,
      })
    } else if (type === 'user' || type === 'assistant') {
      const message = field(row, 'message'), role = field(message, 'role'), content = blocksOf(field(message, 'content'))
      if (typeof role !== 'string' || content === undefined) {
        run = undefined
        continue
      }
      const id = field(message, 'id')
      if (run === undefined || run.role !== role || (role !== 'user' && (typeof id !== 'string' || run.id !== id))) run = { role, id, content: [] }
      run.content.push(...content)
      const whole = { role, content: [...run.content] }
      const key = hashOf(canonical(whole, true))
      if (!recording.messages.has(key)) recording.messages.set(key, whole)
      const text = content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
      if (type === 'assistant' && text !== '') {
        const requestRef = field(row, 'requestRef'), version = field(row, 'version')
        recording.replies.set(line, { text, ...(typeof requestRef === 'string' && { requestRef }), ...(typeof version === 'string' && { version }) })
      }
    }
  }
  return recording
}

/**
 * The request that wrote the reply at `line`, rebuilt whole and equal to the digest Claude Code
 * recorded for it. Throws, saying why, where the transcript does not hold all of it.
 */
export function requestBehind(recording: Recording, line: number): { body: Body; digest: string } {
  const reply = recording.replies.get(line)
  if (reply === undefined) throw new Error('no reply at that line')
  const request = recording.requests.get(reply.requestRef ?? '')
  if (request === undefined) throw new Error('the request is not recorded')
  if (!request.isWhole) throw new Error('part of the request was withheld')
  const shape = recording.shapes.get(request.shapeHash)
  if (shape === undefined) throw new Error('the system prompt is not recorded')
  const messages = request.refs.map(ref => recording.messages.get(ref))
  if (messages.includes(undefined)) throw new Error('a message is not recorded')
  // A copy, so the cache marks put back below do not reach the recording's own messages.
  const body: unknown = structuredClone({ ...request.params, ...shape, messages })
  for (const { path, value } of request.cacheControl) {
    const target = path.reduce<unknown>(field, body)
    if (typeof target !== 'object' || target === null) throw new Error('a cache mark points at nothing')
    Reflect.set(target, 'cache_control', value)
  }
  if (recording.hashOf(canonical(body)) !== request.digest) throw new Error('the rebuilt request does not match its digest')
  return { body: body as Body, digest: request.digest }
}

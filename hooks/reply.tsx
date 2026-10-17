import type { ClientModule, ClientPointerEvent, ClientSurface, TextProps } from 'claude-code'

import { grow, lengthOf } from './grow'
import { continuationOf, isMarkup, layout, link, linkAt, targetsIn, tint, widthOf } from './layout'
import type { Action, Row, Run } from './layout'
import { closeAfter, isLinkable, KEY_SEPARATOR, parse } from './parse'
import { DEFAULT_LOOK, lookProps } from './look'
import type { Look } from './look'
import type { Segment, Stretch } from './parse'

// Draws one paragraph of a reply that holds stretches. It runs where the reader's screen draws it,
// so a press answers at once and the growth moves on the screen's own frame clock. What the reader
// opens is posted to the hooks module, which keeps it across redraws, notes it for Claude and picks
// its colour.

/**
 * The colours of an open stretch: of the words it added (faded unless it is the newest) and of its
 * closer, which never fades, as a faded closer reads as disabled.
 */
export type Tint = { words: string; closer: string }

/** A stretch the reader asked to open or close from the keyboard, numbered so each ask acts once. */
type Ask = { key: string; action: Action; n: number }

/** While letters show: whether typing one opens or closes, and the letter of each stretch they cover. */
type Letters = { action: Action; keys: Record<string, string> }

/** The paragraph, the stretches the reader already has open in it, the tint of each, the last ask, its letters, and how pressable phrases look. */
export type ReplyProps = { text: string; open: string[]; tints: Record<string, Tint>; ask: Ask | null; letters: Letters | null; look?: Look }

/**
 * What the instance posts to the hooks module when the open stretches change, with the stretch the
 * reader just opened: its short form for the note to Claude, its key for its colour.
 */
export type ReplyPost = { open: string[]; opened?: { short: string; key: string } }

/** What the instance posts to the hooks module when the reader drags across its text: the text, for the clipboard. */
export type CopyPost = { copy: string }

/**
 * A run as drawn: a letter over the first character of a short form or a «, or the rest of that
 * text after it; or text the reader dragged across.
 */
type DrawnRun = Run & { isLetter?: true; isAfterLetter?: true; isSelected?: true }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
type Cell = { x: number; y: number }
/** Text the reader dragged across: from the cell the press went down on to the one under the pointer. */
type Selection = { anchor: Cell; head: Cell; isDragging: boolean }
/** What is open, what is growing, the number of the last ask acted on, and what the reader selected. */
type State = { open: string[]; growth: Growth | null; asked: number; selection: Selection | null }

const FRAME_MS = 16
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// What the last call drew, per instance, so a press is matched against the rows on screen: the rows
// as laid out, and as drawn with any letters over them.
const drawn = new WeakMap<object, { laid: Row[]; rows: Row[]; segments: Segment[] }>()
// The last ask each instance was handed, acted on at its next frame rather than while drawing.
const asks = new WeakMap<object, Ask>()

const Reply: ClientModule<ReplyProps, State> = (props, surface) => {
  const { Box, Link, Text } = surface.elements
  // An ask made before this instance was drawn is not acted on again.
  const fresh: State = { open: props.open, growth: null, asked: props.ask?.n ?? 0, selection: null }
  if (surface.state === undefined) {
    surface.setState(fresh)
    surface.onPointer(event => pointer(surface, event))
    surface.every(FRAME_MS, () => tick(surface))
  }
  // As of Claude Code 2.1.302 a paragraph an older plugin version drew stays on screen after
  // /reload-plugins, and this code is handed its old props, without the ask or the letters.
  const ask = props.ask ?? null
  const letters = props.letters ?? null
  if (ask !== null) asks.set(surface, ask)
  const state = surface.state ?? fresh
  const segments = parse(props.text)
  // Read through Maps, which hold own keys only: a stretch keyed `constructor` must not find Object's.
  const tints = new Map(Object.entries(props.tints))
  const laid = layout(compose(segments, state, tints), surface.columns > 0 ? surface.columns : 80)
  const lettering = lettered(laid, letters)
  drawn.set(surface, { laid, rows: lettering, segments })
  const rows = state.selection === null ? lettering : selected(lettering, state.selection)
  // In Claude Code 2.1.302 in WezTerm 20260905-195314-b99b1ca2, the cells that start the next
  // paragraph were seen taking the style this paragraph's last row ends in, a stretch's underline or a
  // letter's background, so a last row that ends styled ends in one plain cell.
  const last = rows.at(-1)?.at(-1)
  const tail = last !== undefined && Object.keys(styleOf(last, props.look ?? DEFAULT_LOOK)).length > 0 ? <Text> </Text> : null

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Text wrap="truncate">
          {row.length === 0
            ? ' '
            : row.map(run => {
                const piece = <Text {...styleOf(run, props.look ?? DEFAULT_LOOK)}>{run.text}</Text>
                return run.href === undefined ? piece : <Link href={run.href}>{piece}</Link>
              })}
          {i === rows.length - 1 && tail}
        </Text>
      ))}
    </Box>
  )
}

export default Reply

/**
 * The paragraph as the reader sees it now: closed stretches as pressable short forms, open ones in
 * full then a «, the words each added in its tint.
 */
function compose(segments: Segment[], state: State, tints: ReadonlyMap<string, Tint>): string {
  const write = (parts: Segment[]): string => parts.map(part => (typeof part === 'string' ? part : draw(part))).join('')
  const draw = (stretch: Stretch): string => {
    if (stretch.long === undefined || !stretch.isClosed) return stretch.short
    // A short form over several lines is drawn open, or as written when its long form is empty.
    if (!isLinkable(stretch)) return stretch.long.length === 0 ? stretch.short : write(stretch.long)
    const colours = tints.get(stretch.key)
    const paint = (word: string) => (colours === undefined || isMarkup(word) ? word : tint(colours.words, word))
    if (state.growth?.key === stretch.key) return grow(stretch.short, stretch.long, easeInOut(state.growth.progress), draw, paint)
    if (!state.open.includes(stretch.key)) return link('open', stretch.key, stretch.short)
    const closer = link('close', stretch.key, '«')
    const long = grow(stretch.short, stretch.long, 1, draw, paint)
    return closeAfter(long, colours === undefined ? closer : tint(colours.closer, closer), '\n')
  }

  return write(segments)
}

/**
 * The rows with each letter drawn over the first character of what a press on its stretch acts on,
 * its short form or its «, so nothing on screen moves; the rest of that text is marked.
 */
function lettered(rows: Row[], letters: Letters | null): DrawnRun[][] {
  if (letters === null) return rows
  const keys = new Map(Object.entries(letters.keys))
  const done = new Set<string>()
  return rows.map(row =>
    row.flatMap((run): DrawnRun[] => {
      const { link } = run
      const letter = link?.action === letters.action ? keys.get(link.key) : undefined
      if (link === undefined || letter === undefined) return [run]
      if (done.has(link.key)) return [{ ...run, isAfterLetter: true }]
      done.add(link.key)
      const first = GRAPHEMES.segment(run.text).containing(0)?.segment
      if (first === undefined) return [run]
      const rest = run.text.slice(first.length)
      // A letter takes one cell, so a wide first character keeps its second cell as a space.
      const cover: DrawnRun = { ...run, text: widthOf(first) > 1 ? `${letter} ` : letter, isLetter: true }
      return rest === '' ? [cover] : [cover, { ...run, text: rest, isAfterLetter: true }]
    }),
  )
}

/**
 * A press on a short form or a « opens or closes its stretch. As of Claude Code 2.1.302 a Client
 * holds the pointer from a press until its release and the transcript selects nothing meanwhile, so a
 * drag from anywhere else selects here: the cells it crosses are highlighted, and on release their
 * text goes to the clipboard.
 */
function pointer(surface: ClientSurface<State>, event: ClientPointerEvent) {
  const state = surface.state
  const shown = drawn.get(surface)
  if (state === undefined || shown === undefined) return
  const { selection } = state
  if (event.type === 'down' && event.button === 'left') {
    const target = linkAt(shown.rows, event.x, event.y)
    if (target !== undefined && openOrClose(surface, target.action, target.key)) return
    const cell = clamped(shown.rows, event)
    surface.setState({ ...state, selection: { anchor: cell, head: cell, isDragging: true } })
    return
  }
  // A selection left on screen goes once the pointer moves off the paragraph: as of Claude Code
  // 2.1.302 a press elsewhere does not reach this instance to take it down.
  if (event.type === 'leave' && selection?.isDragging === false) {
    surface.setState({ ...state, selection: null })
    return
  }
  if (selection?.isDragging !== true) return
  if (event.type === 'move') {
    const head = clamped(shown.rows, event)
    if (head.x !== selection.head.x || head.y !== selection.head.y) surface.setState({ ...state, selection: { ...selection, head } })
    return
  }
  if (event.type !== 'up') return
  const text = textIn(shown.laid, selection)
  // A click (a press that moved nowhere) takes a selection down, and so does a release off the
  // paragraph, which as of Claude Code 2.1.302 no leave follows.
  const isOff = event.x < 0 || event.y < 0 || event.x >= surface.columns || event.y >= shown.rows.length
  surface.setState({ ...state, selection: text === '' || isOff ? null : { ...selection, isDragging: false } })
  if (text !== '') surface.post({ copy: text } satisfies CopyPost)
}

/** The cell under the pointer, kept to the rows drawn: above them is their start, below them their end. */
function clamped(rows: Row[], { x, y }: Cell): Cell {
  if (y < 0) return { x: 0, y: 0 }
  if (y >= rows.length) return { x: Number.POSITIVE_INFINITY, y: Math.max(0, rows.length - 1) }
  return { x: Math.max(0, x), y }
}

/** The selection's first and last cells in reading order, both selected; none when it covers no cell. */
function span({ anchor, head }: Selection): { from: Cell; to: Cell } | undefined {
  if (anchor.x === head.x && anchor.y === head.y) return undefined
  const isForward = anchor.y < head.y || (anchor.y === head.y && anchor.x < head.x)
  return isForward ? { from: anchor, to: head } : { from: head, to: anchor }
}

/** The columns of row `y` a selection covers, from the first to the last, both included. */
function columnsOf(y: number, { from, to }: { from: Cell; to: Cell }): [number, number] | undefined {
  if (y < from.y || y > to.y) return undefined
  return [y === from.y ? from.x : 0, y === to.y ? to.x : Number.POSITIVE_INFINITY]
}

/** Each run of `rows` with the part a selection covers split out and marked, character by character. */
function selected(rows: DrawnRun[][], selection: Selection): DrawnRun[][] {
  const covered = span(selection)
  if (covered === undefined) return rows
  return rows.map((row, y) => {
    const columns = columnsOf(y, covered)
    if (columns === undefined) return row
    const [first, last] = columns
    const out: DrawnRun[] = []
    let at = 0
    for (const run of row) {
      let piece: DrawnRun | undefined
      for (const { segment } of GRAPHEMES.segment(run.text)) {
        const isSelected = at >= first && at <= last
        if (piece !== undefined && (piece.isSelected === true) === isSelected) piece.text += segment
        else {
          piece = { ...run, text: segment, ...(isSelected && { isSelected: true }) }
          out.push(piece)
        }
        at += widthOf(segment)
      }
    }
    return out
  })
}

/**
 * The text a selection covers, as the reader would paste it: a line wrapped over several rows joined
 * back into one, without the lead its later rows start with, and each line's trailing spaces gone.
 */
function textIn(rows: Row[], selection: Selection): string {
  const covered = span(selection)
  if (covered === undefined) return ''
  let text = ''
  for (let y = covered.from.y; y <= covered.to.y; y += 1) {
    const row = rows[y] ?? []
    const [first, last] = columnsOf(y, covered) ?? [0, Number.POSITIVE_INFINITY]
    const continuation = continuationOf(row)
    // A row a line wrapped onto starts after its lead, as the line itself had none there.
    const start = continuation === undefined ? first : Math.max(first, continuation.lead)
    let piece = ''
    let at = 0
    for (const run of row) {
      for (const { segment } of GRAPHEMES.segment(run.text)) {
        if (at >= start && at <= last) piece += segment
        at += widthOf(segment)
      }
    }
    if (y > covered.from.y) text = continuation === undefined ? `${text.trimEnd()}\n` : `${text}${continuation.join}`
    text += piece
  }

  return text.trimEnd()
}

/**
 * Opens or closes stretch `key` as a press on it does; false when no link on screen does that, as
 * for a letter the hooks gave a stretch still growing open, whose « is not drawn yet.
 */
function openOrClose(surface: ClientSurface<State>, action: Action, key: string, asked?: number): boolean {
  const state = surface.state
  const shown = drawn.get(surface)
  if (state === undefined || shown === undefined || !hasLink(shown.rows, action, key)) return false

  // A stretch still shrinking when another press lands is closed at once, so what can be pressed is
  // judged without it: a press inside it, or a letter put up before it closed, does nothing.
  const open = state.growth !== null && !state.growth.isOpening ? closed(state.open, state.growth.key) : state.open
  const stretch = targetsIn(shown.segments, open, action).find(one => one.key === key)
  if (stretch?.long === undefined) return false
  const duration = 1000 * Math.min(1.4, 0.45 + lengthOf(stretch.long) / 70)
  const acted = asked ?? state.asked
  if (action === 'open') {
    const next = [...open.filter(k => k !== stretch.key), stretch.key]
    surface.setState({ open: next, growth: { key: stretch.key, isOpening: true, progress: 0, duration }, asked: acted, selection: null })
    surface.post({ open: next, opened: { short: stretch.short.trim(), key: stretch.key } } satisfies ReplyPost)
  } else {
    surface.setState({ open, growth: { key: stretch.key, isOpening: false, progress: 1, duration }, asked: acted, selection: null })
  }

  return true
}

function tick(surface: ClientSurface<State>) {
  const state = surface.state
  const ask = asks.get(surface)
  if (state !== undefined && ask !== undefined && ask.n > state.asked) {
    // The ask is spent with no change when its stretch cannot be pressed for it.
    if (!openOrClose(surface, ask.action, ask.key, ask.n)) surface.setState({ ...state, asked: ask.n })
    return
  }
  if (state?.growth == null) return
  const { growth } = state
  const progress = growth.progress + ((growth.isOpening ? 1 : -1) * FRAME_MS) / growth.duration
  if (progress > 0 && progress < 1) {
    surface.setState({ ...state, growth: { ...growth, progress } })
    return
  }
  // A shrunk stretch, and every stretch inside it, leaves the open list as its growth ends.
  const open = growth.isOpening ? state.open : closed(state.open, growth.key)
  surface.setState({ ...state, open, growth: null })
  if (!growth.isOpening) surface.post({ open } satisfies ReplyPost)
}

/** Whether `rows` draw a link that does `action` to stretch `key`. */
function hasLink(rows: Row[], action: Action, key: string): boolean {
  return rows.some(row => row.some(run => run.link?.action === action && run.link.key === key))
}

function closed(open: string[], key: string): string[] {
  return open.filter(k => k !== key && !k.startsWith(`${key}${KEY_SEPARATOR}`))
}

function styleOf(run: DrawnRun, look: Look): TextProps {
  // A phrase a press acts on carries the look: underlined in the text's own colour by default,
  // leaving colour to code, to the words a click added and to a hyperlink inside the phrase. A
  // closer is tinted like those words. While a letter covers the phrase it stays underlined, whatever
  // the look, and the letter's own colours stand alone.
  const looked = run.link && !run.isLetter && !run.isAfterLetter ? lookProps(look, !run.tint && !run.code && run.href === undefined) : undefined
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.underline && { underline: true }),
    // A highlight wins over a run's own dim too, such as a link target's: see lookProps.
    ...(run.dim && looked?.backgroundColor === undefined && { dimColor: true }),
    ...(run.tint && { color: run.tint }),
    ...(run.code && { color: 'permission' }),
    ...(run.link && (looked ?? { underline: true })),
    // A hyperlink is underlined in the suggestion colour, so it is not read as a stretch to press.
    ...(run.href !== undefined && { underline: true, color: 'suggestion' }),
    // A letter is drawn bold on the theme's error colour, and the rest of its short form or « on its
    // permission colour, both in inverse text.
    ...(run.isAfterLetter && { color: 'inverseText', backgroundColor: 'permission' }),
    ...(run.isLetter && { color: 'inverseText', backgroundColor: 'error', bold: true }),
    // Text the reader dragged across is drawn inverse, as a terminal draws its own selection.
    ...(run.isSelected && { inverse: true }),
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

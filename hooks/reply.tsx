import type { ClientModule, ClientPointerEvent, ClientSurface, TextProps } from 'claude-code'

import { grow, lengthOf } from './grow'
import { continuationOf, hrefAt, isMarkup, isWebLink, layout, link, linkAt, namesOf, openedOf, targetsIn, tint, widthOf, withLeadIns } from './layout'
import type { Action, OpenedStretch, Row, Run } from './layout'
import { closeAfter, isLinkable, KEY_SEPARATOR, parse } from './parse'
import { DEFAULT_LOOK, drawsHighlight, lookProps } from './look'
import type { Hex } from './contrast'
import type { DrawnLook } from './look'
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

/**
 * The paragraph, the stretches the reader already has open in it, the tint of each, the last ask, its
 * letters, how pressable phrases look, and under the tinted highlight each stretch's own highlight, by
 * key, in place of the look's.
 */
export type ReplyProps = {
  text: string
  open: string[]
  tints: Record<string, Tint>
  ask: Ask | null
  letters: Letters | null
  look?: DrawnLook
  highlights: Record<string, Hex>
}

/**
 * What the instance posts to the hooks module when the open stretches change, with the stretch the
 * reader just opened: as the note to Claude names it, and its key, for its colour.
 */
export type ReplyPost = { open: string[]; opened?: OpenedStretch & { key: string } }

/** What the instance posts to the hooks module when the reader drags across its text: the text, for the clipboard. */
export type CopyPost = { copy: string }

/** What the instance posts when the reader ctrl- or alt-clicks a hyperlink: where it goes, for the hooks module to open. */
export type FollowPost = { follow: string }

/**
 * A run as drawn: a letter over the first character of a short form or a «, or the rest of that
 * text after it; or text the reader dragged across.
 */
type DrawnRun = Run & { isLetter?: true; isAfterLetter?: true; isSelected?: true }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
type Cell = { x: number; y: number }
/**
 * Text the reader dragged across: from the cell the press went down on to the one under the pointer.
 * A word picked by a double-click covers both its ends, even when they are the same cell. `link` is
 * the link the press went down on, which its release acts on unless the pointer `hasMoved` to another
 * cell first. `follow` is the web link a ctrl- or alt-press went down on, which its release opens on
 * the same terms.
 */
type Selection = { anchor: Cell; head: Cell; isDragging: boolean; isWord?: true; link?: Run['link']; follow?: string; hasMoved?: true }
/**
 * One cell a double-click looks through for a word: what it shows, and where. `startsApart` marks
 * the first cell of a row that no word runs onto from the row before.
 */
type WordCell = { segment: string; x: number; y: number; width: number; startsApart?: true }
/** What is open, what is growing, the number of the last ask acted on, and what the reader selected. */
type State = { open: string[]; growth: Growth | null; asked: number; selection: Selection | null }

const FRAME_MS = 16
// Two presses make a double-click when the second comes less than this long after the first and at
// most this many cells from it, across and down: the limits of Claude Code 2.1.303's own double-click,
// so a paragraph that holds a stretch answers like the paragraphs around it.
const DOUBLE_CLICK_MS = 500
const DOUBLE_CLICK_CELLS = 1
// Lead-in words open once a second press can no longer make a double-click of the first.
const DOUBLE_CLICK_FRAMES = Math.ceil(DOUBLE_CLICK_MS / FRAME_MS)
// What a double-click takes as one word: Claude Code 2.1.303's own word characters, and `#` as well,
// so that `#12806` comes out whole.
const WORD = /[\p{L}\p{N}_/.\-+~\\#]/u
// What a URL is made of: as Claude Code 2.1.303's own double-click does, a URL is taken from its
// scheme on, whatever style it is drawn in.
const IN_URL = /^(?![<>"'`])[!-~]$/
// What a URL does not end on: the punctuation after it, and a closing bracket it does not open.
const AFTER_URL = '.,;:!?'
const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// What the last call drew, per instance, so a press is matched against the rows on screen: the rows
// as laid out, and as drawn with any letters over them.
const drawn = new WeakMap<object, { laid: Row[]; rows: Row[]; segments: Segment[] }>()
// The last ask each instance was handed, acted on at its next frame rather than while drawing.
const asks = new WeakMap<object, Ask>()
// The last press each instance saw, where and when it went down, and the stretch whose lead-in words
// it went down on, if any, so the next press soon after, close by and on the same words makes a
// double-click; a quick third press, measured from the second, picks the word again. It is dropped
// when its release lands on another cell, so two quick drags from one cell stay two drags, and when a
// stretch opens or closes, which ends a double-click begun before it.
const presses = new WeakMap<object, Cell & { at: number; key?: string }>()
// A click on lead-in words, per instance: the stretch it opens, the frames left before a second press
// can no longer make it a double-click, and whether the button is up. A double-click there picks a
// word, as it does in any text, and a drag from there selects.
const pendingOpens = new WeakMap<object, { key: string; framesLeft: number; isReleased: boolean }>()

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
  // /reload-plugins, and this code is handed its old props, without the ask, the letters, the look or
  // the highlights.
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
  const rows = state.selection === null ? lettering : selected(lettering, laid, state.selection)
  const look = props.look ?? DEFAULT_LOOK
  const highlights = new Map(Object.entries(props.highlights ?? {}))
  const lookFor = (run: DrawnRun): DrawnLook => {
    const highlight = run.link && highlights.get(run.link.key)
    return highlight === undefined ? look : { ...look, highlight }
  }

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">
          {row.length === 0
            ? ' '
            : row.map(run => {
                const piece = <Text {...styleOf(run, lookFor(run))}>{run.text}</Text>
                return run.href === undefined ? piece : <Link href={run.href}>{piece}</Link>
              })}
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
  // The lead-in words of a link with no words of its own open it too, also while another stretch
  // grows: `layout` never lets half a code span or link drawn by that growth run over their marks.
  const write = (parts: Segment[], isParagraphEnd = false): string =>
    withLeadIns(parts, stretch => !state.open.includes(stretch.key), isParagraphEnd)
      .map(part => (typeof part === 'string' ? part : draw(part)))
      .join('')
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

  return write(segments, true)
}

/**
 * The rows with each letter drawn over the first character of what a press on its stretch acts on:
 * its lead-in words if it has them, else its short form, or its «, so nothing on screen moves; the
 * rest of that text is marked.
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
 * A click on a short form or a « opens or closes its stretch as the button comes up, and a click on
 * lead-in words opens it once no second press has made a double-click. As of Claude Code 2.1.302
 * a Client holds the pointer from a press until its release and the transcript selects nothing
 * meanwhile, so a drag from anywhere, a link included, selects here: the cells it crosses are
 * highlighted, and on release their text goes to the clipboard. A double-click selects here too,
 * taking the URL or word under it at once, except on a short form or a «, which the first click acted on.
 * A ctrl- or alt-click on a web link posts it for the hooks module to open as the button comes up,
 * and a ctrl- or alt-drag from one selects; away from a web link either acts as a plain one.
 */
function pointer(surface: ClientSurface<State>, event: ClientPointerEvent) {
  const state = surface.state
  const shown = drawn.get(surface)
  if (state === undefined || shown === undefined) return
  const { selection } = state
  if (event.type === 'down' && event.button === 'left') {
    const href = event.ctrl === true || event.alt === true ? hrefAt(shown.rows, event.x, event.y) : undefined
    const follow = href !== undefined && isWebLink(href) ? href : undefined
    // A web link inside a short form is the link's under ctrl or alt, not the stretch's.
    const target = follow === undefined ? linkAt(shown.rows, event.x, event.y) : undefined
    const leadInKey = target?.isLeadIn === true ? target.key : undefined
    const cell = clamped(shown.rows, event)
    const at = performance.now()
    const last = presses.get(surface)
    const isDouble =
      last !== undefined &&
      at - last.at < DOUBLE_CLICK_MS &&
      Math.abs(cell.x - last.x) <= DOUBLE_CLICK_CELLS &&
      Math.abs(cell.y - last.y) <= DOUBLE_CLICK_CELLS &&
      last.key === leadInKey
    // A press that makes no double-click of a click on lead-in words lets that click open its stretch
    // first, so two quick clicks on two stretches open both.
    if (pendingOpens.get(surface)?.isReleased === true && !isDouble) openPending(surface)
    const latest = surface.state ?? state
    // A double-click picks a word in text and in lead-in words, not on a short form or a «.
    const word = follow === undefined && isDouble && (target === undefined || leadInKey !== undefined) ? wordAt(shown.laid, cell) : undefined
    presses.set(surface, { ...cell, at, ...(leadInKey !== undefined && { key: leadInKey }) })
    if (word !== undefined) {
      pendingOpens.delete(surface)
      const picked: Selection = { ...word, isDragging: false, isWord: true }
      surface.setState({ ...latest, selection: picked })
      const text = textIn(shown.laid, picked)
      if (text !== '') surface.post({ copy: text } satisfies CopyPost)
      return
    }
    if (leadInKey !== undefined) pendingOpens.set(surface, { key: leadInKey, framesLeft: DOUBLE_CLICK_FRAMES, isReleased: false })
    surface.setState({ ...latest, selection: { anchor: cell, head: cell, isDragging: true, ...(target !== undefined && { link: target }), ...(follow !== undefined && { follow }) } })
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
    if (head.x === selection.head.x && head.y === selection.head.y) return
    surface.setState({ ...state, selection: { ...selection, head, hasMoved: true } })
    return
  }
  if (event.type !== 'up') return
  const { link: pressed, follow } = selection
  // A press that moved to another cell was a drag, which selects; one that did not is a click on its link.
  if (follow !== undefined && selection.hasMoved !== true) {
    surface.setState({ ...state, selection: null })
    surface.post({ follow } satisfies FollowPost)
    return
  }
  if (pressed !== undefined && selection.hasMoved !== true) {
    surface.setState({ ...state, selection: null })
    // A click on lead-in words opens at a frame once a double-click can no longer follow.
    const pending = pendingOpens.get(surface)
    if (pressed.isLeadIn !== true) openOrClose(surface, pressed.action, pressed.key)
    else if (pending !== undefined) pending.isReleased = true
    return
  }
  const text = textIn(shown.laid, selection)
  if (text !== '' || selection.anchor.x !== selection.head.x || selection.anchor.y !== selection.head.y) presses.delete(surface)
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
function span({ anchor, head, isWord }: Selection): { from: Cell; to: Cell } | undefined {
  if (anchor.x === head.x && anchor.y === head.y && isWord !== true) return undefined
  const isForward = anchor.y < head.y || (anchor.y === head.y && anchor.x < head.x)
  return isForward ? { from: anchor, to: head } : { from: head, to: anchor }
}

/**
 * The URL or the word around cell `at` as a selection's two ends, its first and last cells, which a
 * line wrapped inside it puts on different rows; none when the cell is in no URL and holds no word
 * character, so a double-click on a space or a comma picks nothing.
 */
function wordAt(rows: Row[], at: Cell): { anchor: Cell; head: Cell } | undefined {
  const cells = cellsIn(rows)
  const hit = cells.findIndex(cell => cell.y === at.y && at.x >= cell.x && at.x < cell.x + Math.max(1, cell.width))
  const ends = urlAround(cells, hit) ?? wordAround(cells, hit)
  const first = ends && cells[ends[0]]
  const last = ends && cells[ends[1]]
  if (first === undefined || last === undefined) return undefined
  return { anchor: { x: first.x, y: first.y }, head: { x: last.x + Math.max(1, last.width) - 1, y: last.y } }
}

/**
 * Every cell of `rows` in reading order, without the lead a wrapped line's later rows start with. A
 * row starts apart from the one before unless a line wrapped onto it inside a word.
 */
function cellsIn(rows: Row[]): WordCell[] {
  const cells: WordCell[] = []
  rows.forEach((row, y) => {
    const continuation = continuationOf(row)
    let x = 0
    for (const run of row) {
      for (const { segment } of GRAPHEMES.segment(run.text)) {
        const width = widthOf(segment)
        if (x >= (continuation?.lead ?? 0)) {
          const isApart = cells.at(-1)?.y !== y && continuation?.join !== ''
          cells.push({ segment, x, y, width, ...(isApart && { startsApart: true }) })
        }
        x += width
      }
    }
  })
  return cells
}

/** The first and last of the cells around `hit` that `isIn` holds for, within one line. */
function around(cells: WordCell[], hit: number, isIn: (cell: WordCell | undefined) => boolean): [number, number] {
  let first = hit
  let last = hit
  while (cells[first]?.startsApart !== true && isIn(cells[first - 1])) first -= 1
  while (cells[last + 1]?.startsApart !== true && isIn(cells[last + 1])) last += 1
  return [first, last]
}

/**
 * The URL around cell `hit`: its run of URL characters, cut at the last scheme at or before it and
 * the next scheme after it, less what a URL does not end on; none when `hit` is in no URL.
 */
function urlAround(cells: WordCell[], hit: number): [number, number] | undefined {
  const isInUrl = (cell: WordCell | undefined) => IN_URL.test(cell?.segment ?? '')
  if (!isInUrl(cells[hit])) return undefined
  const [first, last] = around(cells, hit, isInUrl)
  // Each cell of the run holds one character, so a place in its text is a place among its cells.
  const text = cells.slice(first, last + 1).map(cell => cell.segment).join('')
  const offset = hit - first
  const starts = [...text.matchAll(/(?:https?|file):\/\//g)].map(match => match.index)
  const from = starts.findLast(start => start <= offset)
  if (from === undefined) return undefined
  let url = text.slice(from, starts.find(start => start > offset))
  while (url !== '') {
    const end = url.slice(-1)
    const opener = OPENERS[end]
    const isUnopened = opener !== undefined && url.split(end).length > url.split(opener).length
    if (!AFTER_URL.includes(end) && !isUnopened) break
    url = url.slice(0, -1)
  }
  return offset < from + url.length ? [first + from, first + from + url.length - 1] : undefined
}

/**
 * The run of word characters around cell `hit`, without the full stops it ends on unless it is
 * nothing else; none when `hit` holds no word character.
 */
function wordAround(cells: WordCell[], hit: number): [number, number] | undefined {
  const isWord = (cell: WordCell | undefined) => WORD.test(cell?.segment ?? '')
  if (!isWord(cells[hit])) return undefined
  const [first, last] = around(cells, hit, isWord)
  const isStop = (at: number) => cells[at]?.segment === '.'
  let end = last
  while (end > first && isStop(end)) end -= 1
  return [first, isStop(end) ? last : end]
}

/**
 * The columns of `row`, row `y`, a selection covers, from the first to the last, both included. A row
 * a line wrapped onto is covered after its lead, as the line itself had none there.
 */
function columnsOf(y: number, row: Row, { from, to }: { from: Cell; to: Cell }): [number, number] | undefined {
  if (y < from.y || y > to.y) return undefined
  const lead = continuationOf(row)?.lead ?? 0
  return [Math.max(y === from.y ? from.x : 0, lead), y === to.y ? to.x : Number.POSITIVE_INFINITY]
}

/**
 * Each run of `rows` with the part a selection covers split out and marked, character by character:
 * the cells `textIn` copies. `laid` is `rows` before letters were drawn over them, which is where a
 * wrapped row's lead is recorded.
 */
function selected(rows: DrawnRun[][], laid: Row[], selection: Selection): DrawnRun[][] {
  const covered = span(selection)
  if (covered === undefined) return rows
  return rows.map((row, y) => {
    const columns = columnsOf(y, laid[y] ?? [], covered)
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
    const [start, last] = columnsOf(y, row, covered) ?? [0, Number.POSITIVE_INFINITY]
    const continuation = continuationOf(row)
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
    surface.post({ open: next, opened: { ...openedOf(stretch, namesOf(shown.segments)), key: stretch.key } } satisfies ReplyPost)
  } else {
    surface.setState({ open, growth: { key: stretch.key, isOpening: false, progress: 1, duration }, asked: acted, selection: null })
  }
  presses.delete(surface)

  return true
}

/** Opens the stretch a click on lead-in words is waiting to open; false when it could not. */
function openPending(surface: ClientSurface<State>): boolean {
  const pending = pendingOpens.get(surface)
  pendingOpens.delete(surface)
  return pending !== undefined && openOrClose(surface, 'open', pending.key)
}

function tick(surface: ClientSurface<State>) {
  const pending = pendingOpens.get(surface)
  if (pending !== undefined) pending.framesLeft -= 1
  if (pending !== undefined && pending.framesLeft <= 0 && pending.isReleased && openPending(surface)) return
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

function styleOf(run: DrawnRun, look: DrawnLook): TextProps {
  // A phrase a press acts on carries the look: underlined in the text's own colour by default,
  // leaving colour to code, to the words a click added and to a hyperlink inside the phrase. A
  // closer is tinted like those words.
  const isPlainText = !run.tint && !run.code && run.href === undefined
  // While a letter covers the phrase, the rest of it keeps a highlight drawn on it, so a tinted one
  // still shows the colour the stretch opens in; any other part is drawn in inverse text on the
  // permission colour, underlined whatever the look.
  const isOnPermission = run.isAfterLetter && !drawsHighlight(look, isPlainText)
  const looked = run.link && !run.isLetter && !isOnPermission ? lookProps(look, isPlainText, run.dim) : undefined
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.underline && { underline: true }),
    // A pressable run's own dim, such as a link target's, is drawn by lookProps, which knows the highlight.
    ...(run.dim && looked === undefined && { dimColor: true }),
    ...(run.tint && { color: run.tint }),
    ...(run.code && { color: 'permission' }),
    ...(run.link && (looked ?? { underline: true })),
    // A hyperlink is underlined in the suggestion colour, so it is not read as a stretch to press.
    ...(run.href !== undefined && { underline: true, color: 'suggestion' }),
    ...(isOnPermission && { color: 'inverseText', backgroundColor: 'permission' }),
    // A letter is drawn bold in inverse text on the theme's error colour.
    ...(run.isLetter && { color: 'inverseText', backgroundColor: 'error', bold: true }),
    // Text the reader dragged across is drawn inverse, as a terminal draws its own selection.
    ...(run.isSelected && { inverse: true }),
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}

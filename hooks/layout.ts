// Lays out a paragraph that holds stretches, for a Client to draw: its markdown as rows of styled
// runs, wrapped to the region's width, so a press can be matched to the phrase under it. Claude
// Code draws every paragraph without a stretch with its own markdown.

import { closesFence, codeSpan, drawnAs, isLinkable, isRule, openingFence, stretches } from './parse'
import type { Segment, Stretch } from './parse'

/** What a press on a pressable phrase does to its stretch. */
export type Action = 'open' | 'close'

export type Run = {
  text: string
  bold?: true
  italic?: true
  code?: true
  underline?: true
  dim?: true
  /** The colour of the words a stretch added. */
  tint?: string
  /**
   * The stretch a press acts on, and how. `isLeadIn` marks lead-in words: the words written just before
   * a link with no words of its own, and the punctuation glued after an empty short form, which a press
   * opens too. They stay a run apart from the link, so rows break where they would without it.
   */
  link?: { action: Action; key: string; isLeadIn?: true }
  /** Where a markdown link or a bare URL goes, drawn as a hyperlink. */
  href?: string
}

export type Row = Run[]

/** How a row a line wrapped onto joins the row before it: what the break took out, and the lead's cells. */
export type Continuation = { join: string; lead: number }

// The rows a line wrapped onto, so a copy of several rows gives back the line as written.
const continuations = new WeakMap<Row, Continuation>()

/** How `row` continues the row before it, if a line wrapped onto it. */
export function continuationOf(row: Row): Continuation | undefined {
  return continuations.get(row)
}

// Noncharacters frame a pressable phrase, a tinted word or an arriving word in composed text: Unicode
// keeps them for a program's own use, where the Private Use Area holds icons such as Nerd Font's. A
// start mark with no separator after it is read as a character, so a stray one still lets its line
// be laid out.
const START = '\ufdd0'
const SEP = '\ufdd1'
const END = '\ufdd2'
const PHRASE_MARK = /[\ufdd0-\ufdd2]/
/** What a pressable phrase adds around its label, none of it drawn: its start with the action and key it carries, and its end. For `replace`. */
const PHRASE_FRAME = new RegExp(`${START}[^${SEP}]*${SEP}[^${SEP}]*${SEP}|${END}`, 'g')
const TINT = '\ufdd3'
const TINT_END = '\ufdd4'
const ARRIVING = '\ufdd5'
const ARRIVING_END = '\ufdd6'

// A mark drawn on the letter before it, or a character no terminal draws, takes no cell.
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]/u

// A character drawn as a picture by default, such as 🚀, takes two cells; the first is U+231A, so
// widthOf tests nothing below it. A flag is two regional indicators that take two cells together,
// so each one keeps its single cell.
const EMOJI = /(?!\p{Regional_Indicator})\p{Emoji_Presentation}/u

// Where a row may break in text without spaces. Chinese and Japanese break between any two
// characters. Korean spaces its words, so it breaks at spaces as Latin text does. Thai, Lao, Khmer
// and Burmese write words without spaces, and a row breaks between words where Intl.Segmenter
// finds them. Closing punctuation, a Japanese small kana, the long-vowel mark and a mark drawn on
// the letter before it never start a row; opening punctuation never ends one.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u
const SEGMENTED = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const NO_START = /[\p{Pe}\p{Pf},.:;!?，。、；：？！…·ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーゝゞヽヾ々]/u
const NO_END = /[\p{Ps}\p{Pi}]/u
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' })

// The marks that start a markdown block on a line. The benchmark reads lines with the same ones.
export const TABLE_ROW = /^\s*\|/
export const HEADING = /^#{1,6}\s+(.*)$/
export const QUOTE = /^>\s?(.*)$/
export const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

/** A line's text without its tint and arriving marks, with each remaining character's tint and whether it is arriving. */
type Line = { text: string; tints: (string | undefined)[]; arriving: boolean[] }

/** `word` drawn in `colour`. */
export function tint(colour: string, word: string): string {
  return `${TINT}${colour}${SEP}${word}${TINT_END}`
}

/**
 * `text` as what a growing or shrinking long form shows at one frame, marked as arriving line by line.
 * A `*` or `_` in it that opens italics and meets no closing mark is then not drawn, and the rest of
 * the arriving text on its line is italic: its closing mark may be in a word not shown at this frame.
 * A rule or a fence line stays bare, since `closeAfter` reads a long form's last line for one.
 */
export function asArriving(text: string): string {
  const isBare = (line: string) => isRule(line) || openingFence(line) !== undefined
  return text.split('\n').map(line => (isBare(line) ? line : `${ARRIVING}${line}${ARRIVING_END}`)).join('\n')
}

/** Whether a word is markdown syntax rather than text: a bullet, a list number, a rule, a fence, a pipe, a heading mark. */
export function isMarkup(word: string): boolean {
  return !HAS_WORDS.test(word) || /^\d+[.)]$/.test(word) || openingFence(word) !== undefined
}

/**
 * A pressable phrase for composed text: drawn as `label`, a press does `action` to stretch `key`;
 * `leadIn` marks lead-in words, which open it.
 */
export function link(action: Action | 'leadIn', key: string, label: string): string {
  return `${START}${action}${SEP}${key}${SEP}${label}${END}`
}

/** Punctuation that ends a sentence at the end of a word, before any closing quote or bracket. */
const SENTENCE_END = /[.!?]["'”’)\]]*$/
/** Sentence-ending punctuation of scripts that write no space after it, so it can stand inside a word. */
const UNSPACED_SENTENCE_END = /[。！？](?=[^。！？]*$)/u
/** Markup a pressed phrase would cut in two: emphasis, a markdown link, HTML, a URL, a table's pipe. */
const CUT_MARKUP = /[*[\]<>|~]|:\/\/|(?:^|[^\p{L}\p{N}])_|_(?:$|[^\p{L}\p{N}])/u
/** A bold phrase that ends a piece of a line, with any punctuation after it. */
const BOLD_END = /(?<![*\\])\*\*(?=\S)([^*\n]*?\S)\*\*[.,;:!?"'”’]*$/
const HAS_WORDS = /[\p{L}\p{N}]/u

/**
 * Where the lead-in words that close `text` stand, back to the start of their sentence: the line's
 * start, a list or quote mark, or a sentence's closing punctuation, so a comma or a dash inside the
 * sentence does not leave the reader pressing only its last clause. A code span counts as one word, and
 * so does a bold phrase; other markup a press would cut in two ends them, and leading pieces with no
 * letter or digit are left out. The line's own mark (an indent, a list, quote or heading mark) is never
 * taken. Words are split at spaces only, where `wrap` breaks a row, and none is taken whose edge stands
 * against other white space, so the words' edges add no place to break. Spaces after the words are not
 * theirs. Undefined when no words stand there, in a table, and after an unclosed code span or `[` on
 * the line, which a press on the words would leave half pressed.
 */
export function leadInOf(text: string): { from: number; to: number } | undefined {
  const lineStart = text.lastIndexOf('\n') + 1
  const line = text.slice(lineStart)
  if (TABLE_ROW.test(line) || /\[[^\]]*$/.test(line)) return undefined
  const block = HEADING.exec(line)?.[1] ?? QUOTE.exec(line)?.[1] ?? LIST_ITEM.exec(line)?.[3] ?? line.trimStart()
  const floor = line.length - block.length
  const pieces: { at: number; text: string; isSpace: boolean; isCode: boolean }[] = []
  for (let i = 0; i < line.length; ) {
    const span = line[i] === '`' ? codeSpan(line, i) : undefined
    if (span?.open !== undefined) return undefined
    const isCode = span !== undefined
    const stop = span?.stop ?? i + (/^( +|[^ `]+)/.exec(line.slice(i))?.[0].length ?? 1)
    const piece = line.slice(i, stop)
    pieces.push({ at: i, text: piece, isSpace: /^ +$/.test(piece), isCode })
    i = stop
  }
  const previous = (k: number) => {
    let at = k - 1
    while (at >= 0 && pieces[at]?.isSpace) at -= 1
    return at
  }
  const last = previous(pieces.length)
  const end = last < 0 ? 0 : (pieces[last]?.at ?? 0) + (pieces[last]?.text.length ?? 0)
  let from: number | undefined
  for (let k = last; k >= 0; k = previous(k)) {
    const piece = pieces[k]
    if (piece === undefined) break
    if (!piece.isCode && CUT_MARKUP.test(piece.text)) {
      // A bold phrase is taken whole when it starts a piece outside a code span, holds words and no
      // other markup, and no sentence ends inside it.
      const bold = BOLD_END.exec(line.slice(0, piece.at + piece.text.length))
      const start = bold === null ? -1 : pieces.findIndex(p => p.at === bold.index && !p.isCode)
      const inner = bold?.[1] ?? ''
      const isBoldWhole =
        start !== -1 && start <= k && HAS_WORDS.test(inner) && !CUT_MARKUP.test(inner) &&
        pieces.slice(start, k).every(p => p.isSpace || p.isCode || !SENTENCE_END.test(p.text))
      if (!isBoldWhole) break
      k = start
      from = pieces[k]?.at
    } else {
      // The line's own indent, list or heading mark.
      if (piece.at < floor) break
      const cut = piece.isCode ? null : UNSPACED_SENTENCE_END.exec(piece.text)
      if (cut !== null) {
        // The words start where a row may break after the full stop: a closing quote or bracket stays with it.
        let at = 0
        for (const unit of breakables(piece.text)) {
          if (at >= cut.index + cut[0].length) break
          at += unit.length
        }
        if (HAS_WORDS.test(piece.text.slice(at))) from = piece.at + at
        break
      }
      from = piece.at
    }
    const before = pieces[previous(k)]
    if (before !== undefined && !before.isCode && SENTENCE_END.test(before.text)) break
  }
  if (from === undefined || from < floor) return undefined
  // A leading emoji, arrow or bullet is not a word to press.
  for (const piece of pieces) {
    if (piece.at < from || piece.isSpace) continue
    if (piece.at >= end || piece.isCode || HAS_WORDS.test(piece.text)) break
    from = piece.at + piece.text.length
  }
  while (from < end && line[from] === ' ') from += 1
  const charBefore = line[from - 1] ?? ' '
  const firstChar = line[from] ?? ''
  const lastChar = line[end - 1] ?? ''
  if (/\s/.test(firstChar + lastChar) || (from > floor && /[^\S ]/.test(charBefore))) return undefined
  return HAS_WORDS.test(line.slice(from, end)) ? { from: lineStart + from, to: lineStart + end } : undefined
}

/** Roughly what `stretch` draws: its short form, closed or as text, else its long form and a «. */
function drawnText(stretch: Stretch, isShut: (stretch: Stretch) => boolean): string {
  const long = () => (stretch.long ?? []).map(part => (typeof part === 'string' ? part : drawnText(part, isShut))).join('')
  switch (drawnAs(stretch)) {
    case 'text':
      return stretch.short
    case 'open':
      return long()
    case 'link':
      return isShut(stretch) ? stretch.short : `${long()} «`
  }
}

/** A short form whose lead-in words open it too: none at all, or only punctuation or symbols. */
const WORDLESS = /^[\p{P}\p{S}]*$/u

/**
 * `parts` with the lead-in words of each closed link that has no words of its own, such as a lone
 * period, marked by `link('leadIn', …)` to open it as well; `isShut` says which links are drawn closed, and
 * `isParagraphEnd` whether nothing is drawn after `parts`. The text stays as written. Where an empty
 * short form joins its lead-in words to the text after it, a row cannot break between the two: that
 * text's first piece is marked too when it is only punctuation, such as the sentence's period, so the
 * marks add no place to break; otherwise the words are left.
 */
export function withLeadIns(parts: Segment[], isShut: (stretch: Stretch) => boolean, isParagraphEnd: boolean): Segment[] {
  const { leadIns, tails } = leadInsOf(parts, isShut, isParagraphEnd)
  return parts.map((part, i) => {
    if (typeof part !== 'string') return part
    let marked = ''
    let at = 0
    for (const span of [tails.get(i), leadIns.get(i)]) {
      if (span === undefined) continue
      marked += part.slice(at, span.from) + link('leadIn', span.key, part.slice(span.from, span.to))
      at = span.to
    }
    return marked + part.slice(at)
  })
}

/**
 * What a note to Claude calls each stretch of `parts` drawn as a link, by key: its short form, and for
 * one with no words of its own its lead-in words and the punctuation glued after it too, as drawn with
 * every stretch closed, so lone periods after different sentences get different names. `shortsNamed`
 * in bench/opened.ts reads these names back to short forms, so a change to how they are written
 * changes it too.
 */
export function namesOf(parts: Segment[]): Map<string, string> {
  const names = new Map<string, string>()
  const walk = (segments: Segment[], isParagraphEnd: boolean) => {
    const { leadIns, tails } = leadInsOf(segments, () => true, isParagraphEnd)
    segments.forEach((part, i) => {
      if (typeof part === 'string') return
      if (drawnAs(part) === 'open') walk(part.long ?? [], false)
      if (drawnAs(part) !== 'link') return
      const before = segments[i - 1]
      const after = segments[i + 1]
      const leadIn = leadIns.get(i - 1)
      const tail = tails.get(i + 1)
      // The lead-in words and the spaces after them, as drawn up to the link.
      const leadInText = leadIn !== undefined && typeof before === 'string' ? before.slice(leadIn.from) : ''
      const glued = tail !== undefined && typeof after === 'string' ? after.slice(0, tail.to) : ''
      names.set(part.key, `${leadInText}${part.short}${glued}`.trim())
      for (const nested of stretches(part.long ?? [])) if (isLinkable(nested)) names.set(nested.key, nested.short.trim())
    })
  }
  walk(parts, true)
  return names
}

/**
 * A stretch the reader opened, for the note to Claude: as written (`sourceOf`) and by its name
 * (`namesOf`). Two stretches written alike after the same words are the same to the reader too.
 */
export type OpenedStretch = { source: string; name: string }

/** `stretch` as a note to Claude names it, `names` being `namesOf` the parts it was parsed from. */
export function openedOf(stretch: Stretch, names: ReadonlyMap<string, string>): OpenedStretch {
  return { source: sourceOf(stretch), name: names.get(stretch.key) ?? stretch.short.trim() }
}

/**
 * A stretch as written, braces and all, the same wherever it is parsed from, a paragraph (in the
 * terminal) or the whole reply (in the desktop app), where its key, named among its siblings, can
 * differ. It is here, not in parse.ts, which the bench hashes as part of the code that asks its tasks.
 */
function sourceOf(stretch: Stretch): string {
  if (stretch.long === undefined) return `{{${stretch.short}}}`
  return `{{${stretch.short}|${stretch.long.map(part => (typeof part === 'string' ? part : sourceOf(part))).join('')}}}`
}

/** Where some text in composed parts is marked: from and to, in that text, and the stretch it opens. */
type Marked = { from: number; to: number; key: string }

/**
 * Where `withLeadIns` marks words in `parts`, by index of the text that holds them: the lead-in words
 * before a wordless closed link, and the punctuation an empty short form is glued to (its tail), with
 * the key each opens. Lead-in words the tail of the stretch before them overlaps are left out.
 */
function leadInsOf(
  parts: Segment[],
  isShut: (stretch: Stretch) => boolean,
  isParagraphEnd: boolean,
): { leadIns: Map<number, Marked>; tails: Map<number, Marked> } {
  const leadIns = new Map<number, Marked>()
  const tails = new Map<number, Marked>()
  // What `parts` draw before index `i` on the same line: the words are found on the whole line, so a
  // list mark, a code span or a `[` drawn by an earlier stretch is seen too.
  const drawnBefore = (i: number): string => {
    let line = ''
    for (let j = i - 1; j >= 0; j--) {
      const part = parts[j]
      const drawn = part === undefined ? '' : typeof part === 'string' ? part : drawnText(part, isShut)
      line = drawn + line
      if (drawn.includes('\n')) break
    }
    return line.slice(line.lastIndexOf('\n') + 1)
  }
  parts.forEach((part, i) => {
    const next = parts[i + 1]
    if (typeof part !== 'string' || next === undefined || typeof next === 'string' || drawnAs(next) !== 'link' || !WORDLESS.test(next.short) || !isShut(next)) return
    const before = part.includes('\n') ? '' : drawnBefore(i)
    const found = leadInOf(before + part)
    if (found === undefined || found.to <= before.length) return
    const leadIn = { from: found.from - before.length, to: found.to - before.length }
    // A sentence that starts before this text, in or before another stretch, lends only the words
    // after that stretch, apart from it by a space, so the two links never draw as one.
    if (leadIn.from < 0) {
      leadIn.from = /^ */.exec(part)?.[0].length ?? 0
      if (leadIn.from === 0 || !HAS_WORDS.test(part.slice(leadIn.from, leadIn.to))) return
    }
    // Words that start the text right after a stretch drawn without a run of its own (one that is only
    // text, or an empty short form) are joined to that stretch's text: marking them would add a break.
    const previous = parts[i - 1]
    if (leadIn.from === 0 && previous !== undefined && (typeof previous === 'string' || drawnAs(previous) !== 'link' || previous.short === '')) return
    const after = parts[i + 2]
    if (leadIn.to === part.length && next.short === '' && (after !== undefined || !isParagraphEnd) && !(typeof after === 'string' && /^[ \n]/.test(after))) {
      const glued = typeof after === 'string' ? (/^[^ \n]+/.exec(after)?.[0] ?? '') : ''
      if (!/^[\p{P}\p{S}]+$/u.test(glued) || /[`*_~[\]<>|\\]/.test(glued)) return
      // Punctuation that runs on into the next stretch is joined to whatever that stretch draws: marking it would add a break.
      if (typeof after === 'string' && glued.length === after.length && (parts[i + 3] !== undefined || !isParagraphEnd)) return
      tails.set(i + 2, { from: 0, to: glued.length, key: next.key })
    }
    if (leadIn.from >= (tails.get(i)?.to ?? 0)) leadIns.set(i, { ...leadIn, key: next.key })
  })
  return { leadIns, tails }
}

/**
 * The stretches `action` acts on among those drawn, with the stretches in `open` open: to open, those
 * drawn as links with every stretch around them open; to close, those open, whose « is drawn.
 */
export function targetsIn(parts: Segment[], open: readonly string[], action: Action): Stretch[] {
  return parts.flatMap(part => {
    if (typeof part === 'string' || part.long === undefined) return []
    switch (drawnAs(part)) {
      case 'text':
        return []
      // A short form over several lines is drawn open, with no «, so the stretches inside it are drawn.
      case 'open':
        return targetsIn(part.long, open, action)
      case 'link':
        if (!open.includes(part.key)) return action === 'open' ? [part] : []
        return [...(action === 'close' ? [part] : []), ...targetsIn(part.long, open, action)]
    }
  })
}

/** The rows `text` takes in a region `columns` cells wide. */
export function layout(text: string, columns: number): Row[] {
  const width = Math.max(10, columns)
  const rows: Row[] = []
  let fence: string | undefined
  for (const marked of text.split('\n')) {
    const line = lineOf(marked)
    if (fence !== undefined) {
      if (closesFence(line.text, fence)) fence = undefined
      else rows.push(...cutRows([{ text: `  ${line.text}`, code: true }], width))
      continue
    }
    const marker = openingFence(line.text)
    if (marker !== undefined) {
      fence = marker
      continue
    }
    rows.push(...rowsOf(line, width))
  }

  return rows
}

/**
 * The phrase drawn at cell `x` of row `y`, if any. A one-cell `«` is hard to land on, so a press
 * a cell beside a closer counts as on it.
 */
export function linkAt(rows: Row[], x: number, y: number): Run['link'] {
  const spans: { from: number; to: number; link: Run['link'] }[] = []
  let at = 0
  for (const run of rows[y] ?? []) {
    const w = widthOf(run.text)
    spans.push({ from: at, to: at + w, link: run.link })
    at += w
  }
  const exact = spans.find(span => x >= span.from && x < span.to)?.link
  if (exact !== undefined) return exact

  return spans.find(span => span.link?.action === 'close' && x >= span.from - 1 && x < span.to + 1)?.link
}

/**
 * Whether a ctrl- or alt-click opens a hyperlink to `href`: a web page does, and a `file:` link,
 * which could name a program behind its words, is left to the terminal's own click.
 */
export function isWebLink(href: string): boolean {
  return /^https?:/.test(href)
}

/** Where the hyperlink drawn at cell `x` of row `y` goes, if one is drawn there. */
export function hrefAt(rows: Row[], x: number, y: number): string | undefined {
  let at = 0
  for (const run of rows[y] ?? []) {
    const w = widthOf(run.text)
    if (x >= at && x < at + w) return run.href
    at += w
  }

  return undefined
}

/**
 * Cells a string takes: none for a mark drawn on the letter before it (a Thai vowel written above or
 * below a letter, a tone mark, an accent) or a character no terminal draws, such as a joiner; two for
 * wide East Asian characters and most emoji; else one.
 */
export function widthOf(text: string): number {
  let cells = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    // Every character below U+0300 takes one cell, so most English text skips the tests below. That
    // includes the soft hyphen (U+00AD), which ZERO_WIDTH would count as none.
    if (c < 0x300) {
      cells += 1
      continue
    }
    const isWide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) ||
      (c >= 0x231a && EMOJI.test(ch))
    cells += ZERO_WIDTH.test(ch) ? 0 : isWide ? 2 : 1
  }

  return cells
}

/**
 * One part of a line split at spaces, cut into the pieces a row may break between and growth adds
 * one at a time; a run of spaces stays whole.
 */
export function breakables(text: string): string[] {
  // Nothing below Thai breaks, so a Latin word or a run of spaces comes back whole without a look at
  // each character.
  if (!/[^\0-\u0dff]/.test(text)) return [text]
  const wordStarts = new Set<number>()
  if (SEGMENTED.test(text)) for (const word of SEGMENTER.segment(text)) wordStarts.add(word.index)
  const pieces: string[] = []
  let piece = ''
  let last = ''
  let isAfterUnspaced = false
  let at = 0
  for (const ch of text) {
    const isUnspaced = UNSPACED.test(ch)
    const isWordStart = wordStarts.has(at) && SEGMENTED.test(last + ch)
    if (piece !== '' && (isUnspaced || isAfterUnspaced || isWordStart) && !NO_START.test(ch) && !NO_END.test(last) && !ZERO_WIDTH.test(ch)) {
      pieces.push(piece)
      piece = ''
    }
    piece += ch
    last = ch
    isAfterUnspaced = isUnspaced || (isAfterUnspaced && NO_START.test(ch))
    at += ch.length
  }
  if (piece !== '') pieces.push(piece)

  return pieces
}

/**
 * A line without its tint and arriving marks, so its markdown is read from the text alone: a stretch
 * tints the words it adds one at a time, so a code span or a link label can hold several. A space
 * takes the tint before it, so a tinted phrase stays one run.
 */
function lineOf(marked: string): Line {
  let text = ''
  const tints: Line['tints'] = []
  const arriving: Line['arriving'] = []
  let tinted: string | undefined
  let isArriving = false
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i] ?? ''
    const sep = ch === TINT ? marked.indexOf(SEP, i + 1) : -1
    if (sep !== -1) {
      tinted = marked.slice(i + 1, sep)
      i = sep
    } else if (ch === TINT_END) {
      tinted = undefined
    } else if (ch === ARRIVING || ch === ARRIVING_END) {
      isArriving = ch === ARRIVING
    } else {
      tints.push(ch === ' ' && tinted === undefined ? tints.at(-1) : tinted)
      arriving.push(isArriving)
      text += ch
    }
  }

  return { text, tints, arriving }
}

function rowsOf({ text: line, tints, arriving }: Line, width: number): Row[] {
  // The runs of the line's end from `rest` on.
  const inlineOf = (rest: string, isBold = false) => {
    const from = line.length - rest.length
    return inline({ text: rest, tints: tints.slice(from), arriving: arriving.slice(from) }, isBold)
  }
  if (line.trim() === '') return [[]]
  if (isRule(line)) return [[{ text: '─'.repeat(Math.min(width, 60)), dim: true }]]
  // A table row keeps its columns: written as is, cut where the region ends.
  if (TABLE_ROW.test(line)) return cutRows(inlineOf(line), width)
  const heading = HEADING.exec(line)
  if (heading) return wrap(inlineOf(heading[1] ?? '', true), width, '', '')
  const quote = QUOTE.exec(line)
  if (quote) return wrap(inlineOf(quote[1] ?? ''), width, '▎ ', '▎ ', true)
  const item = LIST_ITEM.exec(line)
  if (item) {
    const lead = `${item[1] ?? ''}${item[2] ?? ''} `
    return wrap(inlineOf(item[3] ?? ''), width, lead, ' '.repeat(widthOf(lead)))
  }
  const indent = /^\s*/.exec(line)?.[0] ?? ''

  return wrap(inlineOf(line.slice(indent.length)), width, indent, indent)
}

/**
 * The characters drawn just before and just after the one at `at`: a pressable phrase's frame is
 * passed over, and a character that takes two code units is given whole. A space where the line
 * starts or ends.
 */
function beside(text: string, at: number): [before: string, after: string] {
  // A frame stands between the character and its neighbour only when it touches the character, and
  // each of its ends is a phrase mark; otherwise two code units a side hold the neighbour whole.
  const isFramed = PHRASE_MARK.test(text.slice(Math.max(0, at - 1), at + 2))
  const [from, to] = isFramed ? [0, text.length] : [Math.max(0, at - 2), at + 3]
  const drawn = (part: string) => part.replace(PHRASE_FRAME, '')
  return [/.$/su.exec(drawn(text.slice(from, at)))?.[0] ?? ' ', /^./su.exec(drawn(text.slice(at + 1, to)))?.[0] ?? ' ']
}

/**
 * Whether the `*` or `_` at `at` can open italics, and whether it can close them: the character after
 * an opening mark, or before a closing one, is not white space. A `_` also has no letter or digit on
 * its other side and no `_` beside it, so `snake_case` and `__init__` stay as written.
 */
function italicsAt(text: string, at: number): { canOpen: boolean; canClose: boolean } {
  const [before, after] = beside(text, at)
  const isAlone = before !== '_' && after !== '_'
  const marks = (inner: string, outer: string) => /\S/.test(inner) && (text[at] === '*' || (isAlone && !HAS_WORDS.test(outer)))
  return { canOpen: marks(after, before), canClose: marks(before, after) }
}

/**
 * A line's inline markdown as runs: bold, italic, code spans, links, pressable phrases, each character
 * in its tint. Italics run from a `*` or `_` to the nearest closing mark of its kind. An opening mark
 * that meets no closing mark on the line is text, unless it is arriving. Bold toggles at every `**`,
 * closed or not.
 */
function inline({ text, tints, arriving }: Line, isBold: boolean): Run[] {
  const runs: Run[] = []
  // The opening marks that have met no closing mark yet, outermost first: each the run it is drawn as,
  // since it is text until its closing mark is met. And those of them that are arriving.
  const openMarks: Run[] = []
  const arrivingMarks = new Set<Run>()
  let bold = isBold
  let pressable: Run['link']
  // `chunk`, which starts at character `at`, in its tint and the styles in force.
  const runOf = (chunk: string, at: number, extra: Omit<Run, 'text'> = {}): Run => {
    const tint = tints[at]
    return {
      text: chunk,
      ...(bold && { bold: true }),
      ...(tint && { tint }),
      ...(pressable && { link: pressable }),
      ...extra,
    }
  }
  const emit = (chunk: string, at: number, extra: Omit<Run, 'text'> = {}) => {
    if (chunk === '') return
    const run = runOf(chunk, at, extra)
    const last = runs.at(-1)
    // An open mark stays a run of its own, to be taken out if its closing mark is met.
    if (last !== undefined && !openMarks.includes(last) && isSameStyle(last, run)) last.text += chunk
    else runs.push(run)
  }
  // `mark` met its closing mark: what follows it is italic, and it is not drawn.
  const italicise = (mark: Run) => {
    const at = runs.indexOf(mark)
    for (const run of runs.slice(at + 1)) run.italic = true
    runs.splice(at, 1)
  }
  // Arriving text ends: a mark of its own still open is taken to have met its closing mark, which may
  // be in a word not shown at this frame.
  const closeArriving = () => {
    for (const mark of openMarks.filter(mark => arrivingMarks.has(mark))) {
      italicise(mark)
      openMarks.splice(openMarks.indexOf(mark), 1)
    }
  }

  for (let i = 0; i < text.length; ) {
    if (arriving[i - 1] && !arriving[i]) closeArriving()
    const ch = text[i] ?? ''
    const first = ch === START ? text.indexOf(SEP, i + 1) : -1
    const second = first === -1 ? -1 : text.indexOf(SEP, first + 1)
    if (second !== -1) {
      const action = text.slice(i + 1, first)
      pressable = { action: action === 'close' ? 'close' : 'open', key: text.slice(first + 1, second), ...(action === 'leadIn' && { isLeadIn: true }) }
      i = second + 1
      continue
    }
    if (ch === END) {
      pressable = undefined
      i += 1
      continue
    }
    if (ch === '`') {
      const fence = /^`+/.exec(text.slice(i))?.[0] ?? '`'
      const end = text.indexOf(fence, i + fence.length)
      // A code span never runs over a pressable phrase's marks: half of one, as a growing long form
      // draws it, would pair with a backtick after them and draw the marks as text.
      if (end !== -1 && !PHRASE_MARK.test(text.slice(i, end))) {
        emit(text.slice(i + fence.length, end), i + fence.length, { code: true })
        i = end + fence.length
        continue
      }
    }
    if (text.startsWith('**', i)) {
      bold = !bold
      i += 2
      continue
    }
    if (ch === '*' || ch === '_') {
      const { canOpen, canClose } = italicsAt(text, i)
      const nearest = openMarks.findLastIndex(mark => mark.text === ch)
      const isClosing = nearest !== -1 && canClose
      if (isClosing || canOpen) {
        // A mark that can close the nearest open mark of its kind does. Any other mark that can open
        // takes that one's place. Either way that mark is open no longer, nor is any opened after it:
        // unless this one closed it, it met no closing mark and stays text.
        const [opening] = nearest === -1 ? [] : openMarks.splice(nearest)
        if (isClosing && opening !== undefined) italicise(opening)
        else {
          const mark = runOf(ch, i)
          runs.push(mark)
          openMarks.push(mark)
          if (arriving[i]) arrivingMarks.add(mark)
        }
        i += 1
        continue
      }
    }
    const markdownLink = /^\[([^\]\n\ufdd0-\ufdd2]+)\]\(([^)\s]+)\)/.exec(text.slice(i))
    if (markdownLink) {
      const label = markdownLink[1] ?? ''
      const href = markdownLink[2] ?? ''
      // A target that opens the same from any folder is drawn as a link; any other keeps its target
      // beside it. Claude Code 2.1.302's own markdown links a relative path too.
      const isFollowed = /^(https?|file):/.test(href)
      for (let k = 0; k < label.length; k++) emit(label[k] ?? '', i + 1 + k, isFollowed ? { href } : { underline: true })
      if (!isFollowed) emit(` (${href})`, i + markdownLink[0].length - 1, { dim: true })
      i += markdownLink[0].length
      continue
    }
    const url = ch === 'h' && !/[^\W_]/.test(text[i - 1] ?? ' ') ? bareUrlAt(text, i) : undefined
    if (url !== undefined) {
      for (let k = 0; k < url.length; k++) emit(url[k] ?? '', i + k, { href: url })
      i += url.length
      continue
    }
    emit(ch, i)
    i += 1
  }
  closeArriving()
  // A mark that stayed text joins the text around it.
  const joined: Run[] = []
  for (const run of runs) {
    const last = joined.at(-1)
    if (last !== undefined && isSameStyle(last, run)) last.text += run.text
    else joined.push(run)
  }

  return joined
}

/**
 * The `http:` or `https:` URL written at `at`, without punctuation that ends the sentence after it
 * or a closing bracket it did not open.
 */
function bareUrlAt(text: string, at: number): string | undefined {
  let url = /^https?:\/\/[^\s<>`\ufdd0-\ufdd2]+/.exec(text.slice(at))?.[0]
  if (url === undefined) return undefined
  for (;;) {
    const opened = url.split('(').length - 1
    const closed = url.split(')').length - 1
    if (/[.,;:!?'"*_]$/.test(url) || (url.endsWith(')') && closed > opened)) url = url.slice(0, -1)
    else break
  }

  return /^https?:\/\/[^/]/.test(url) ? url : undefined
}

/**
 * Wraps runs into rows of `width` cells, breaking at spaces and, in text without them, where
 * `breakables` allows; the first row starts with `first`, later rows with `rest`.
 */
function wrap(runs: Run[], width: number, first: string, rest: string, isDimLead = false): Row[] {
  const rows: Row[] = []
  let row: Row = []
  let used = 0
  let isBare = true
  const begin = (lead: string) => {
    row = lead === '' ? [] : [{ text: lead, ...(isDimLead && { dim: true }) }]
    used = widthOf(lead)
    isBare = true
  }
  const put = (piece: Run) => {
    const last = row.at(-1)
    if (last !== undefined && isSameStyle(last, piece)) last.text += piece.text
    else row.push({ ...piece })
    used += widthOf(piece.text)
    isBare = false
  }
  const breakRow = (isAtSpace = false) => {
    const last = row.at(-1)
    let join = isAtSpace ? ' ' : ''
    if (last !== undefined && !isBare) {
      const trimmed = last.text.trimEnd()
      if (trimmed !== last.text) join = ' '
      last.text = trimmed
      if (last.text === '') row.pop()
    }
    rows.push(row)
    begin(rest)
    continuations.set(row, { join, lead: used })
  }

  begin(first)
  for (const run of runs) {
    for (const text of run.text.split(/( +)/).flatMap(breakables)) {
      if (text === '') continue
      if (text.trim() === '') {
        if (isBare) continue
        if (used + widthOf(text) <= width) put({ ...run, text })
        else breakRow(true)
        continue
      }
      let word = text
      while (word !== '') {
        if (used + widthOf(word) <= width) {
          put({ ...run, text: word })
          break
        }
        if (!isBare) {
          breakRow()
          continue
        }
        // A word wider than a whole row is cut where the row ends.
        const [head, tail] = cut(word, width - used)
        put({ ...run, text: head })
        breakRow()
        word = tail
      }
    }
  }
  rows.push(row)

  return rows
}

/** Rows of text kept as written, cut every `width` cells. */
function cutRows(runs: Run[], width: number): Row[] {
  const rows: Row[] = []
  let row: Row = []
  let used = 0
  for (const run of runs) {
    let rest = run.text
    while (rest !== '') {
      if (used >= width) {
        rows.push(row)
        row = []
        used = 0
        continuations.set(row, { join: '', lead: 0 })
      }
      const [head, tail] = cut(rest, width - used)
      row.push({ ...run, text: head })
      used += widthOf(head)
      rest = tail
    }
  }
  rows.push(row)

  return rows
}

/** `text` split where it would pass `room` cells, keeping at least one character. */
function cut(text: string, room: number): [string, string] {
  const chars = [...text]
  let used = 0
  let count = 0
  for (const ch of chars) {
    if (count > 0 && used + widthOf(ch) > room) break
    used += widthOf(ch)
    count += 1
  }

  return [chars.slice(0, count).join(''), chars.slice(count).join('')]
}

function isSameStyle(a: Run, b: Run): boolean {
  return (
    a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.underline === b.underline && a.dim === b.dim && a.tint === b.tint &&
    a.link?.action === b.link?.action && a.link?.key === b.link?.key && a.link?.isLeadIn === b.link?.isLeadIn && a.href === b.href
  )
}

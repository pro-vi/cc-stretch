import { breakables } from './layout'
import type { Segment, Stretch } from './parse'

// A long form grows around its short form. A word here is a piece a row may
// break between (breakables in layout.ts), so Chinese grows a character at a
// time, with the punctuation that sticks to it. The short form's words, found in
// the long form in order, are anchors and never move; the words between them
// arrive from the anchors outward, so the sentence widens at every seam at
// once, to the left of an anchor as much as to its right. Words arrive whole:
// a terminal has no room to fade one in, and half a word reads as a typo. A
// markdown link arrives whole too, since part of one is drawn as its markup.

type Token = { kind: 'word' | 'space'; text: string } | { kind: 'link'; text: string; label: string } | { kind: 'nested'; stretch: Stretch }

/** A markdown link or image as hooks/layout.ts reads one: a label, then a target with no space in it. */
const LINK = /!?\[([^\]\n]+)\]\([^)\s]+\)/g

/** A word or a run of spaces of the long form, or a nested stretch. */
type Atom = string | Stretch

/** Where a run of new words sits relative to the anchors around it. */
type Side = 'before' | 'between' | 'after'

/**
 * The long form at `progress`: 0 shows only the anchors, 1 shows all of it.
 * `draw` writes a nested stretch, which is never shown in part; `paint` marks each word the long
 * form adds, so the reader can tell it from the words they already read.
 */
export function grow(
  short: string,
  long: Segment[],
  progress: number,
  draw: (nested: Stretch) => string,
  paint: (word: string) => string = word => word,
): string {
  const tokens = tokenize(long)
  const { anchors } = anchorsOf(short, tokens)
  const shown = (atoms: Atom[]) => atoms.map(atom => (typeof atom !== 'string' ? draw(atom) : /\S/.test(atom) ? paint(atom) : atom)).join('')

  let out = ''
  let run: Atom[] = []
  let hasAnchorBefore = false
  const flush = (hasAnchorAfter: boolean) => {
    if (run.length === 0) return
    const side: Side = !hasAnchorBefore ? (hasAnchorAfter ? 'before' : 'after') : hasAnchorAfter ? 'between' : 'after'
    out += shown(reveal(run, side, progress))
    run = []
  }

  tokens.forEach((token, i) => {
    if (anchors.has(i) && token.kind !== 'space') {
      flush(true)
      out += token.kind === 'nested' ? draw(token.stretch) : token.text
      hasAnchorBefore = true
      return
    }
    run.push(token.kind === 'nested' ? token.stretch : token.text)
  })
  flush(false)

  return out
}

/**
 * Where a long form's added words and nested stretches land around the short form's words: before
 * the first, between two, or after the last (all of them, when the short form has none in it). And
 * how many of the short form's words no word of the long form holds, in order.
 */
export function growthOf(short: string, long: Segment[]): Record<Side, number> & { missing: number } {
  const tokens = tokenize(long)
  const { anchors, missing } = anchorsOf(short, tokens)
  const counts = { before: 0, between: 0, after: 0, missing }
  let run = 0
  let hasAnchorBefore = false
  tokens.forEach((token, i) => {
    if (anchors.has(i) && token.kind !== 'space') {
      counts[hasAnchorBefore ? 'between' : 'before'] += run
      run = 0
      hasAnchorBefore = true
    } else if (token.kind !== 'space') run += 1
  })
  counts.after += run

  return counts
}

/** How many words and nested stretches a growth adds, to pace it. */
export function lengthOf(long: Segment[]): number {
  return tokenize(long).filter(token => token.kind !== 'space').length
}

function reveal(run: Atom[], side: Side, progress: number): Atom[] {
  // Two anchors stay a space apart from the start, as they stood in the short form.
  const isSpace = (atom: Atom | undefined) => typeof atom === 'string' && /^\s+$/.test(atom)
  if (side === 'between' && run.length > 1 && isSpace(run[0]) && isSpace(run.at(-1))) {
    const middle = reveal(run.slice(1, -1), side, progress)
    return middle.length === 0 ? [run[0] ?? ' '] : [run[0] ?? ' ', ...middle, run.at(-1) ?? ' ']
  }
  if (side === 'between' && isSpace(run[0])) return [run[0] ?? ' ', ...reveal(run.slice(1), side, progress)]
  const count = Math.round(run.length * Math.min(1, Math.max(0, progress)))
  if (side === 'after') return run.slice(0, count)
  if (side === 'before') return run.slice(run.length - count)
  const left = run.slice(0, Math.ceil(count / 2))
  const right = run.slice(run.length - Math.floor(count / 2))
  if (left.length + right.length === run.length) return [...left, ...right]
  // The two halves meet where words are still missing: exactly one space between them. The space
  // is added only where the long form has one beside the gap; a gap between Chinese characters
  // joins without one, as the finished text reads.
  const isGapSpaced = isSpace(run[left.length]) || isSpace(run[run.length - right.length - 1])
  if (isSpace(left.at(-1)) && isSpace(right[0])) return [...left, ...right.slice(1)]
  if (!isSpace(left.at(-1)) && !isSpace(right[0]) && left.length > 0 && right.length > 0 && isGapSpaced) return [...left, ' ', ...right]

  return [...left, ...right]
}

function tokenize(long: Segment[]): Token[] {
  const plain = (text: string): Token[] =>
    text
      .split(/(\s+)/)
      .filter(piece => piece !== '')
      .flatMap((piece): Token[] => (/^\s+$/.test(piece) ? [{ kind: 'space', text: piece }] : breakables(piece).map(word => ({ kind: 'word', text: word }))))
  return long.flatMap((part): Token[] => {
    if (typeof part !== 'string') return [{ kind: 'nested', stretch: part }]
    const tokens: Token[] = []
    let at = 0
    for (const link of part.matchAll(LINK)) {
      tokens.push(...plain(part.slice(at, link.index)), { kind: 'link', text: link[0], label: link[1] ?? '' })
      at = link.index + link[0].length
    }
    return [...tokens, ...plain(part.slice(at))]
  })
}

/**
 * The token indexes of the long form whose words hold the short form's words (`holds`), as many as
 * can be kept in order (a longest common subsequence), and how many of the short form's words no
 * word of the long form holds. A nested stretch shows its own short form, and a link its label, so
 * their words count where they stand.
 */
function anchorsOf(short: string, tokens: Token[]): { anchors: Set<number>; missing: number } {
  const wordsIn = (text: string) => text.split(/\s+/).flatMap(breakables)
  // A link in the short form is read as its label, as the reader reads it.
  const want = wordsIn(short.replace(LINK, '$1')).map(bare).filter(word => word !== '')
  const have: { token: number; word: string }[] = []
  tokens.forEach((token, i) => {
    const words = token.kind === 'word' ? [token.text] : token.kind === 'link' ? wordsIn(token.label) : token.kind === 'nested' ? wordsIn(token.stretch.short) : []
    for (const word of words.map(bare).filter(w => w !== '')) have.push({ token: i, word })
  })

  // hooks/guide.ts asks the long form to keep every word of the short form, in order. When it does,
  // the earliest word that holds each one is already a longest common subsequence, so the table below,
  // one cell per pair of words, is skipped: a Chinese long form has a word per character. When it
  // does not, the table finds the most words that can be kept.
  const anchors = new Set<number>()
  let matched = 0
  for (const { token, word } of have) {
    if (matched === want.length) break
    if (!holds(word, want[matched])) continue
    anchors.add(token)
    matched++
  }
  if (matched < want.length) {
    anchors.clear()
    matched = 0
    // lengths[i][j]: the longest common run of want[i..] and have[j..].
    const lengths = Array.from({ length: want.length + 1 }, () => new Array<number>(have.length + 1).fill(0))
    for (let i = want.length - 1; i >= 0; i--) {
      for (let j = have.length - 1; j >= 0; j--) {
        const row = lengths[i] ?? [], below = lengths[i + 1] ?? []
        row[j] = holds(have[j]?.word, want[i]) ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
      }
    }
    for (let i = 0, j = 0; i < want.length && j < have.length; ) {
      if (holds(have[j]?.word, want[i])) {
        anchors.add(have[j]?.token ?? -1)
        matched++
        i++
        j++
      } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i++
      else j++
    }
  }
  // Punctuation standing on its own right after an anchor (`{{...}}.`) belongs to that anchor.
  let last = -1
  tokens.forEach((token, i) => {
    if (token.kind === 'space') return
    if (token.kind === 'word' && bare(token.text) === '' && anchors.has(last)) anchors.add(i)
    last = i
  })

  return { anchors, missing: want.length - matched }
}

/** A word without its surrounding punctuation or markdown marks, lowercased, so `cache.` meets `**cache**`. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}

/**
 * Whether a word of the long form holds a word of the short form: it is that word, or a path that
 * ends in it, as when a file's name grows into where the file is. A URL is not such a path: its last
 * part is not what the reader read.
 */
function holds(have = '', want = ''): boolean {
  // Asked once per cell of the table in anchorsOf, so it builds no string.
  return have === want || (have.endsWith(want) && have[have.length - want.length - 1] === '/' && !have.includes('://'))
}

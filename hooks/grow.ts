import { asArriving, breakables } from './layout'
import type { Segment, Stretch } from './parse'

// A long form grows around its short form. A word here is a piece a row may
// break between (breakables in layout.ts), so Chinese grows a character at a
// time, with the punctuation that sticks to it. The words both forms share, in
// order, stand throughout; the words the long form adds arrive from them
// outward, so the sentence widens at every seam at once, to the left of a
// shared word as much as to its right. Words arrive whole: a terminal has no
// room to fade one in, and half a word reads as a typo. A markdown link arrives
// whole too, since part of one is drawn as its markup. Around each shared word,
// the short form's own text stands until the first word the long form adds
// there arrives, so a growth starts as the closed short form is drawn and ends
// as the open long form is, and nothing moves when it turns into either.

/**
 * A word, a run of spaces, a markdown link or a nested stretch. A word `glued` to the one before it
 * was cut from the same word, as the comma is from `fails,`, and arrives with it.
 */
type Token = { kind: 'word'; text: string; glued?: true } | { kind: 'space'; text: string } | { kind: 'link'; text: string; label: string } | { kind: 'nested'; stretch: Stretch }

/** A markdown link or image as hooks/layout.ts reads one: a label, then a target with no space in it. */
const LINK = /!?\[([^\]\n]+)\]\([^)\s]+\)/g

/** Where a run of new words sits relative to the shared words around it. */
type Side = 'before' | 'between' | 'after'

// Punctuation a word carries on either side, cut off it so that `fails` in a short form meets
// `fails,` in its long form and the comma arrives as the long form's own. Only marks that mean
// nothing to markdown are cut.
const LOOSE = '.,;:!?…"\'“”‘’，。、；：？！'

// A mark that pairs with another in markdown, or changes the character after it. The short form's
// text between two shared words stands among the long form's words while it grows, so where that
// text holds one, the two forms share no word and the short form leaves whole: half of its markup
// could otherwise meet half of the long form's.
const PAIRING = /[`*_~[\]\\<]/

/**
 * Between two shared words, or before the first or after the last: the short form's text there, and
 * the long form's tokens there, from `from` up to the shared one at `to`.
 */
type Gap = { left: string; from: number; to: number }

/**
 * The long form at `progress`: 0 shows the short form as written, 1 the long form as written.
 * `draw` writes a nested stretch, which is never shown in part; `paint` marks each word the long
 * form adds, with any punctuation cut off it, so the reader can tell it from the words they already
 * read. A frame that shows some of the words the long form adds and not all of them is marked as
 * arriving (`asArriving`), so an opening mark whose closing one has not arrived is not drawn; one
 * that shows none or all is not, so it draws as the short form does closed or the long form open.
 */
export function grow(
  short: string,
  long: Segment[],
  progress: number,
  draw: (nested: Stretch) => string,
  paint: (word: string) => string = word => word,
): string {
  const tokens = cut(tokenize(long))
  const { shared, gaps } = sharedOf(short, tokens)
  const arrival = arrivalsOf(tokens, shared)
  const at = Math.min(1, Math.max(0, progress))
  const added = tokens.flatMap((token, i) => (token.kind === 'space' || shared.has(i) ? [] : [arrival.get(i) ?? 0]))
  const isPart = added.some(time => time <= at) && added.some(time => time > at)

  let out = ''
  for (const { left, from, to } of gaps) {
    const gap = tokens.slice(from, to)
    const times = gap.map((token, k) => (token.kind === 'space' ? undefined : arrival.get(from + k)))
    // The earliest point among the words before each token of the gap, and among those after it.
    const before: number[] = []
    const after: number[] = []
    let least = Infinity
    for (const time of times) {
      before.push(least)
      least = Math.min(least, time ?? Infinity)
    }
    // A gap the long form adds nothing to, its short form's text there dropped, closes halfway.
    const opens = Number.isFinite(least) ? least : 0.5
    least = Infinity
    for (let k = times.length - 1; k >= 0; k--) {
      after[k] = least
      least = Math.min(least, times[k] ?? Infinity)
    }
    // Where both forms have only a space, the long form's stands throughout.
    const isSpaced = left !== '' && left.trim() === '' && gap.length > 0 && gap.every(token => token.kind === 'space')
    if (isSpaced) out += gap.map(token => (token.kind === 'space' ? token.text : '')).join('')
    else if (at < opens) out += left
    else {
      // A space between two words added here shows once a word on each side of it has and one right
      // beside it has, so none trails a word with nothing yet after it, and none stands between two
      // words the long form writes together; one beside a shared word shows with the first word
      // added. Spaces that words still to come leave side by side are drawn as one, the one that
      // breaks the most lines, as the long form will.
      let space: string | undefined
      // A word and the punctuation cut off it arrive together and are painted as one.
      let word = ''
      const endWord = () => {
        if (word !== '') out += paint(word)
        word = ''
      }
      gap.forEach((token, k) => {
        if (token.kind === 'space') {
          endWord()
          const wordBefore = before[k] ?? Infinity
          const wordAfter = after[k] ?? Infinity
          const beside = Math.min(times[k - 1] ?? Infinity, times[k + 1] ?? Infinity)
          const point = Number.isFinite(wordBefore) && Number.isFinite(wordAfter) ? Math.max(wordBefore, wordAfter, beside) : opens
          if (point <= at && (space === undefined || breaks(token.text) > breaks(space))) space = token.text
          return
        }
        if ((times[k] ?? Infinity) > at) return
        if (!(token.kind === 'word' && token.glued)) endWord()
        out += space ?? ''
        space = undefined
        if (token.kind === 'nested') out += draw(token.stretch)
        else word += token.text
      })
      endWord()
      out += space ?? ''
    }
    const word = tokens[to]
    if (word !== undefined && word.kind !== 'nested') out += word.text
  }
  return isPart ? asArriving(out) : out
}

const breaks = (space: string) => space.split('\n').length

/**
 * The words `short` shares with the long form's `tokens`, as the indexes of the long form's tokens
 * that hold the same word or link, in order, as many as can be kept, and the gaps around them. A
 * nested stretch is shared with none: the short form's words it reads as stand until it arrives.
 */
function sharedOf(short: string, tokens: Token[]): { shared: Set<number>; gaps: Gap[] } {
  const words = cut(tokenize([short]))
  const gapsAround = (pairs: readonly (readonly [number, number])[]): Gap[] => {
    let shortAt = 0
    let longAt = 0
    return [...pairs, [words.length, tokens.length] as const].map(([shortIndex, longIndex]) => {
      const gap = { left: words.slice(shortAt, shortIndex).map(word => (word.kind === 'nested' ? word.stretch.short : word.text)).join(''), from: longAt, to: longIndex }
      shortAt = shortIndex + 1
      longAt = longIndex + 1
      return gap
    })
  }
  const textAt = (list: Token[]) => list.flatMap((token, index) => (token.kind === 'word' || token.kind === 'link' ? [{ index, text: token.text }] : []))
  const want = textAt(words)
  const have = textAt(tokens)
  // hooks/guide.ts asks the long form to keep every word of the short form, in order. When it does,
  // each word's earliest match is already the longest run that can be kept, so the table below, one
  // cell per pair of words, is skipped. When it does not, the table finds that run.
  const pairs: [number, number][] = []
  let j = 0
  for (const word of want) {
    while (j < have.length && have[j]?.text !== word.text) j++
    const found = have[j++]
    if (found === undefined) break
    pairs.push([word.index, found.index])
  }
  if (pairs.length < want.length) {
    pairs.length = 0
    // lengths[i][j]: the longest common run of want[i..] and have[j..].
    const lengths = Array.from({ length: want.length + 1 }, () => new Array<number>(have.length + 1).fill(0))
    for (let i = want.length - 1; i >= 0; i--) {
      for (let k = have.length - 1; k >= 0; k--) {
        const row = lengths[i] ?? [], below = lengths[i + 1] ?? []
        row[k] = want[i]?.text === have[k]?.text ? (below[k + 1] ?? 0) + 1 : Math.max(below[k] ?? 0, row[k + 1] ?? 0)
      }
    }
    for (let i = 0, k = 0; i < want.length && k < have.length; ) {
      if (want[i]?.text === have[k]?.text) {
        pairs.push([want[i]?.index ?? -1, have[k]?.index ?? -1])
        i++
        k++
      } else if ((lengths[i + 1]?.[k] ?? 0) >= (lengths[i]?.[k + 1] ?? 0)) i++
      else k++
    }
  }
  const gaps = gapsAround(pairs)
  if (gaps.some(gap => PAIRING.test(gap.left))) return { shared: new Set(), gaps: gapsAround([]) }
  return { shared: new Set(pairs.map(([, index]) => index)), gaps }
}

/**
 * The point of a growth, 0 to 1, from which each word, link and stretch a long form adds shows:
 * outward from the shared words, at every seam at once, one at a time over the whole growth. A word
 * arrives with the punctuation cut off it. A space takes its time from the words beside it, in `grow`.
 */
function arrivalsOf(tokens: Token[], shared: ReadonlySet<number>): Map<number, number> {
  const at = new Map<number, number>()
  // What arrives at once: a space, a stretch, a link, or a word with the punctuation cut off it.
  type Atom = number[]
  const isSpace = (atom: Atom | undefined) => atom !== undefined && tokens[atom[0] ?? -1]?.kind === 'space'
  const time = (run: readonly Atom[], side: Side): void => {
    // Two shared words stay a space apart from the start, as they stood in the short form.
    if (side === 'between' && run.length > 1 && isSpace(run[0]) && isSpace(run.at(-1))) return time(run.slice(1, -1), side)
    if (side === 'between' && isSpace(run[0])) return time(run.slice(1), side)
    const order = side === 'after' ? run : side === 'before' ? [...run].reverse() : run.map((_, k) => run[k % 2 === 0 ? k / 2 : run.length - 1 - (k - 1) / 2] ?? [])
    // Math.round(length × progress) of a run's atoms show, so the one shown k-th shows at (k + ½) / length.
    order.forEach((atom, k) => {
      if (!isSpace(atom)) for (const token of atom) at.set(token, (k + 0.5) / run.length)
    })
  }
  let run: Atom[] = []
  let isSharedBefore = false
  const flush = (isSharedAfter: boolean) => {
    if (run.length > 0) time(run, isSharedAfter ? (isSharedBefore ? 'between' : 'before') : 'after')
    run = []
  }
  tokens.forEach((token, i) => {
    if (shared.has(i)) {
      flush(true)
      isSharedBefore = true
      return
    }
    const atom = run.at(-1)
    if (token.kind === 'word' && token.glued && atom?.at(-1) === i - 1) atom.push(i)
    else run.push([i])
  })
  flush(false)
  return at
}

/** `tokens` with the loose punctuation on either side of each word cut off, as words glued to it. */
function cut(tokens: Token[]): Token[] {
  return tokens.flatMap((token): Token[] => {
    if (token.kind !== 'word') return [token]
    const { text } = token
    let start = 0
    let end = text.length
    while (start < end && LOOSE.includes(text.charAt(start))) start++
    while (end > start && LOOSE.includes(text.charAt(end - 1))) end--
    return [text.slice(0, start), text.slice(start, end), text.slice(end)]
      .filter(piece => piece !== '')
      .map((piece, i): Token => (i === 0 ? { kind: 'word', text: piece } : { kind: 'word', text: piece, glued: true }))
  })
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
 * their words count where they stand. This is the bench's reading of whether a long form keeps its
 * short form's words, by meaning: case, punctuation and a path before a file's name aside. A growth
 * keeps only what is written the same (`sharedOf`), so that it starts as the short form is drawn.
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

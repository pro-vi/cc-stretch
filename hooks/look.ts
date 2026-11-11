// How a phrase the reader can press is marked: text marks that turn on or off one by one, and a
// highlight. Shared by the hooks module, which also draws the toolbar, and the reply.

import { contrastOn, isHex } from './contrast'
import type { Hex } from './contrast'

/** Every text mark a phrase can carry, in the order the toolbar shows them. */
export const MARK_NAMES = ['bold', 'italic', 'underline', 'strikethrough', 'dim'] as const
export type Mark = (typeof MARK_NAMES)[number]

/** The highlight that puts each closed stretch on the colour its words take once open, blended 75% into the background. */
export const TINTED = 'tinted'

/** A highlight: one hex colour for every stretch, TINTED, or '' for none. */
export type Highlight = Hex | typeof TINTED | ''

/** The marks a pressable phrase carries and its highlight. */
export type Look = { marks: Mark[]; highlight: Highlight }

/** A look as a reply draws it: the hooks module has already replaced TINTED with '', and gives each stretch's own colour in ReplyProps.highlights. */
export type DrawnLook = { marks: Mark[]; highlight: Hex | '' }

/** The default: underlined, in the text's own colour. */
export const DEFAULT_LOOK: DrawnLook = { marks: ['underline'], highlight: '' }

export const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * A highlight as one spelling: TINTED, or a hex colour in lower case, so `#264F78` and `#264f78` are
 * one colour; anything else is none, as its luminance is unknown here and no text colour can be chosen
 * to read on it.
 */
const highlightOf = (value: unknown): Highlight => {
  const text = textOf(value).toLowerCase()
  return text === TINTED ? TINTED : isHex(text) ? text : ''
}

/** Whether a highlight is one colour, for every stretch alike. */
export const isColour = (highlight: Highlight): highlight is Hex => highlight !== '' && highlight !== TINTED

/** The marks named in a list (commas or spaces, any case), in toolbar order, unknown names dropped. */
export function marksOf(value: unknown): Mark[] {
  const names = textOf(value).toLowerCase().split(/[\s,;]+/)
  return MARK_NAMES.filter(mark => names.includes(mark))
}

/**
 * The look the options set. `marks` left empty keeps the default underline, so a highlight alone
 * adds to it; `none` takes every mark away. A value that names no mark (a typo) keeps the default
 * too, so stretches never lose their mark by accident. A hex highlight and `tinted` are read in
 * any case, and any other highlight is none.
 */
export function lookOf(options: Record<string, unknown>): Look {
  const named = textOf(options.marks)
  const parsed = marksOf(named)
  const marks = named.toLowerCase() === 'none' ? [] : parsed.length > 0 ? parsed : DEFAULT_LOOK.marks
  return { marks, highlight: highlightOf(options.highlight) }
}

/** The `marks` setting that reads back as `marks`: `none` for none, as an empty one means the default. */
export function marksSetting(marks: readonly Mark[]): string {
  return marks.length === 0 ? 'none' : marks.join(',')
}

/** A look held in state, checked: what the toolbar stored, or null when there is none. */
export function storedLook(value: unknown): Look | null {
  if (typeof value !== 'object' || value === null || !('marks' in value) || !Array.isArray(value.marks)) return null
  if (!('highlight' in value) || typeof value.highlight !== 'string') return null
  return { marks: marksOf(value.marks.join(',')), highlight: highlightOf(value.highlight) }
}

/** Whether two looks draw a phrase the same. */
export function isSameLook(a: Look, b: Look): boolean {
  return a.highlight === b.highlight && a.marks.length === b.marks.length && a.marks.every(mark => b.marks.includes(mark))
}

/** Whether a look draws its highlight on a run: only on plain text, leaving a coloured closer, code and a hyperlink alone. */
export const drawsHighlight = (look: DrawnLook, isPlainText: boolean) => look.highlight !== '' && isPlainText

/**
 * The text props a look gives a pressable phrase, whose run may be dim of its own (a link target).
 * The look's dim and highlight leave a coloured closer, code and a hyperlink inside the phrase alone.
 * On a highlight the text turns dark or light so it reads, and dim moves that colour toward the
 * highlight.
 */
export function lookProps(look: DrawnLook, isPlainText: boolean, isDim = false) {
  const has = (mark: Mark) => look.marks.includes(mark)
  const isHighlighted = drawsHighlight(look, isPlainText)
  const isDimmed = isDim || (has('dim') && isPlainText)
  return {
    ...(has('bold') && { bold: true }),
    ...(has('italic') && { italic: true }),
    ...(has('underline') && { underline: true }),
    ...(has('strikethrough') && { strikethrough: true }),
    ...(isHighlighted && { backgroundColor: look.highlight, ...contrastOn(look.highlight, isDimmed) }),
    // As of Claude Code 2.1.302 dimColor draws the theme's grey whatever the colour, so on a highlight
    // contrastOn dims the colour chosen to read on it instead.
    ...(isDimmed && !isHighlighted && { dimColor: true }),
  }
}

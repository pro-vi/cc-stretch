// How a phrase the reader can press is marked: text marks that turn on or off one by one, and a
// highlight. Shared by the hooks module, which also draws the toolbar, and the reply.

import { contrastOn, luminanceOf } from './contrast'

/** Every text mark a phrase can carry, in the order the toolbar shows them. */
export const MARK_NAMES = ['bold', 'italic', 'underline', 'strikethrough', 'dim'] as const
export type Mark = (typeof MARK_NAMES)[number]

/** The marks a pressable phrase carries and its highlight; '' for none. */
export type Look = { marks: Mark[]; highlight: string }

/** The default: underlined, in the text's own colour. */
export const DEFAULT_LOOK: Look = { marks: ['underline'], highlight: '' }

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A highlight as one spelling: a hex colour in lower case, so `#264F78` and `#264f78` are one colour. */
const highlightOf = (value: unknown): string => {
  const text = textOf(value)
  return luminanceOf(text) === undefined ? text : text.toLowerCase()
}

/** The marks named in a list (commas or spaces, any case), in toolbar order, unknown names dropped. */
export function marksOf(value: unknown): Mark[] {
  const names = textOf(value).toLowerCase().split(/[\s,;]+/)
  return MARK_NAMES.filter(mark => names.includes(mark))
}

/**
 * The look the options set. `marks` left empty keeps the default underline, so a highlight alone
 * adds to it; `none` takes every mark away. A value that names no mark (a typo) keeps the default
 * too, so stretches never lose their mark by accident. A hex highlight is read in lower case.
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

/**
 * The text props a look gives a pressable phrase. Dim and the highlight leave a tinted closer, code
 * and a hyperlink inside the phrase alone. On a highlight the text turns dark or light so it reads,
 * and dim is not drawn there.
 */
export function lookProps(look: Look, isPlainText: boolean) {
  const has = (mark: Mark) => look.marks.includes(mark)
  const isHighlighted = look.highlight !== ''
  return {
    ...(has('bold') && { bold: true }),
    ...(has('italic') && { italic: true }),
    ...(has('underline') && { underline: true }),
    ...(has('strikethrough') && { strikethrough: true }),
    // A highlight wins over dim: as of Claude Code 2.1.302 dim draws the text in the theme's grey in
    // place of the colour chosen to read on the highlight.
    ...(has('dim') && isPlainText && !isHighlighted && { dimColor: true }),
    ...(isHighlighted && isPlainText && { backgroundColor: look.highlight, ...contrastOn(look.highlight) }),
  }
}

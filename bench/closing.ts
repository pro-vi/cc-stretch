// What became of a reply's closing block: whether a stretch holds it, and what that stretch does with
// its short form, the gist of the block. Kept apart from rules.ts: it is no rule of the plugin's
// guide, which asks only that the stretch keep its gist's words, and no part of what live.ts counts
// (counts.ts tells a closing block's stretch its own way, from the stretch's long form alone).
import { drawnAs, parse, stretches } from '../hooks/parse.ts'
import type { Segment, Stretch } from '../hooks/parse.ts'
import { draw } from './measure.ts'
import { dropsWords, hiddenIn, isFramed } from './rules.ts'

/**
 * A stretch holds the block, and its long form begins with the gist's own line (`gist-first`), keeps
 * the gist's words another way (`kept`) or drops one (`dropped`); or the block is in view and no
 * stretch holds it (`bare`); or the reply has no block (`none`).
 */
export type Closing = 'gist-first' | 'kept' | 'dropped' | 'bare' | 'none'

/** Each outcome's letter and the words a report prints for it, in the order reports list them. */
export const CLOSING: Readonly<Record<Closing, { code: string; label: string }>> = {
  'gist-first': { code: 'G', label: "closing stretch begins with its gist's line" },
  kept: { code: 'K', label: "closing stretch keeps the gist's words another way" },
  dropped: { code: 'D', label: 'closing stretch drops a word of its gist' },
  bare: { code: 'b', label: 'closing block in view, in no stretch' },
  none: { code: '.', label: 'no closing block' },
}

/** Whether a stretch holds the block. */
export const isInStretch = (closing: Closing) => closing !== 'bare' && closing !== 'none'

/**
 * The stretch that holds a reply's closing block: its last link whose opened long form `hiddenIn`
 * reads as a status block, or its last link where the block's two rules frame it from outside, as
 * `closing-block-last` allows.
 */
function closingStretchOf(parts: Segment[]): Stretch | undefined {
  const holding = stretches(parts).filter(s => drawnAs(s) === 'link' && hiddenIn(draw(s.long ?? [], 'all')) === 'status block').at(-1)
  if (holding !== undefined) return holding
  const at = parts.findLastIndex(part => typeof part !== 'string')
  const last = parts[at]
  if (last === undefined || typeof last === 'string' || drawnAs(last) !== 'link') return undefined
  const tail = parts.slice(at + 1).flatMap(part => (typeof part === 'string' ? part.split('\n') : []))
  return isFramed(parts[at - 1], tail) ? last : undefined
}

export function closingOf(reply: string): Closing {
  const parts = parse(reply)
  const stretch = closingStretchOf(parts)
  if (stretch === undefined) return hiddenIn(draw(parts, new Set())) === 'status block' ? 'bare' : 'none'
  if (dropsWords(stretch)) return 'dropped'
  return draw(stretch.long ?? [], 'all').trimStart().startsWith(stretch.short.trim()) ? 'gist-first' : 'kept'
}

// What live replies show, in counts: the layout rules a reply breaks, what its links hide, how many
// a judge called labels and what the reader opened, then how often each happens under a guide and
// how two guides differ. Nothing here calls a model or keeps a reply's text. live.ts reads
// transcripts into these counts, and asks the judge.
import { isOpenable, parse, stretches } from '../hooks/parse.ts'
import type { Stretch } from '../hooks/parse.ts'
import type { Label } from './grading.ts'
import { draw, measure } from './measure.ts'
import type { Measure } from './measure.ts'
import { hiddenIn, RULES, verdictsOf } from './rules.ts'
import type { Hidden, RuleId } from './rules.ts'

/** The words from which a reply counts as long: the bar depth.ts sets, taken here on the words with every stretch open. */
const LONG_WORDS = 150
/**
 * The words under which a reply needs no stretch by the guide's last bullet: the bar replay.ts sets.
 * No task says a live reply is short, so this stands in for it under `no-stretch-in-short-reply`.
 */
const SHORT_WORDS = 40

/** One reply, counted: its words closed and open, and those the reader had read where a reading note followed. */
export type Counted = Measure & {
  session: string
  /** Its stretches that can be opened, at any depth. */
  stretches: number
  /** The layout rules it breaks: those that need no task, and `no-stretch-in-short-reply` for a reply under SHORT_WORDS. */
  broken: RuleId[]
  /** Its links in view, how many of them hide several sections or a list, and how many the label count takes. */
  inView: number
  onSections: number
  labelLinks: number
  /** Where a judge's verdicts on its links in view were given: how many of those the label count takes it called labels. */
  labels?: number
  /** Where a reading note followed the reply: how many links in view the reader opened. */
  opened?: number
}

/** Whether the label count takes a link that hides `hidden`: a closing block's is left out, as another bullet of the guide asks for its short form. */
export const takesLabel = (hidden: Hidden | undefined) => hidden !== 'status block'

/**
 * One reply's counts. `verdicts`, where the label judge was asked, are its verdicts on the reply's
 * links in view, in the order `marked` in measure.ts numbers them, which is the order met here.
 */
export function counted(session: string, reply: string, opened?: ReadonlySet<string>, verdicts?: readonly Label[]): Counted {
  const parts = parse(reply)
  const inView: Stretch[] = []
  draw(parts, new Set(), (link, drawn) => {
    inView.push(link)
    return drawn
  })
  const hides = inView.map(link => hiddenIn(draw(link.long ?? [], 'all')))
  const sizes = measure(reply, opened)
  return {
    session,
    ...sizes,
    stretches: stretches(parts).filter(isOpenable).length,
    broken: verdictsOf(reply, sizes.full < SHORT_WORDS ? { needsNoStretch: true } : {}).filter(verdict => !verdict.holds).map(verdict => verdict.rule),
    inView: inView.length,
    onSections: hides.filter(hidden => hidden === 'sections').length,
    labelLinks: hides.filter(takesLabel).length,
    ...(verdicts?.length === inView.length && { labels: verdicts.filter((verdict, i) => verdict === 'label' && takesLabel(hides[i])).length }),
    ...(opened !== undefined && { opened: inView.filter(link => opened.has(link.short.trim())).length }),
  }
}

/** How many places something can go wrong in, and in how many of them it does. */
export type Tally = { hits: number; of: number }

/** Something that can go wrong, and its tally in one reply. Its rate is the hits over the places, added up over replies. */
export type Failure = { name: string; tally: (reply: Counted) => Tally }

/** A failure a reply as a whole shows or not: one place in each reply it can happen in. */
const perReply = (name: string, applies: (reply: Counted) => boolean, hits: (reply: Counted) => boolean): Failure => ({
  name,
  tally: reply => (applies(reply) ? { hits: hits(reply) ? 1 : 0, of: 1 } : { hits: 0, of: 0 }),
})

const isLong = (reply: Counted) => reply.full >= LONG_WORDS
const isStretched = (reply: Counted) => isLong(reply) && reply.stretches > 0
const breaks = (rule: RuleId) => (reply: Counted) => reply.broken.includes(rule)

export const FAILURES: readonly Failure[] = [
  perReply('a long reply holds no stretch', isLong, reply => reply.stretches === 0),
  // Every layout rule that needs no task, so a rule added to rules.ts is counted here too.
  ...RULES.filter(rule => rule.appliesTo({})).map(({ id }) => perReply(id, isStretched, breaks(id))),
  perReply('a link hides several sections or a list', isStretched, reply => reply.onSections > 0),
  perReply(`a reply under ${SHORT_WORDS} words holds a stretch`, reply => reply.full < SHORT_WORDS, breaks('no-stretch-in-short-reply')),
]

/**
 * A short form that only names or announces its long form, by the judge's word (`LABELS` in
 * grading.ts). Counted per link, in the replies whose verdicts were given, so it is no part of
 * FAILURES, which need no judge.
 */
export const LABEL: Failure = {
  name: 'a link in view is a label, by the judge',
  tally: reply => (reply.labels === undefined ? { hits: 0, of: 0 } : { hits: reply.labels, of: reply.labelLinks }),
}

/** Each session's tally of `failure`, leaving out sessions with no place it can happen in. */
export function talliesOf(replies: readonly Counted[], failure: Failure): Tally[] {
  const bySession = new Map<string, Tally>()
  for (const reply of replies) {
    const { hits, of } = failure.tally(reply)
    if (of === 0) continue
    const tally = bySession.get(reply.session) ?? { hits: 0, of: 0 }
    bySession.set(reply.session, { hits: tally.hits + hits, of: tally.of + of })
  }
  return [...bySession.values()]
}

export const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0)

/** Every session's tally, added up. */
export const totalOf = (tallies: readonly Tally[]): Tally => ({ hits: sum(tallies.map(t => t.hits)), of: sum(tallies.map(t => t.of)) })

/** A failure's rate over every session's tally; NaN for none. */
export function rateOf(tallies: readonly Tally[]): number {
  const { hits, of } = totalOf(tallies)
  return hits / of
}

/** Numbers from 0 up to 1, the same ones on every run (mulberry32), so an interval can be worked out again. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/**
 * `candidate`'s rate minus `base`'s, with the interval that holds 95% of the differences found when
 * each guide's sessions are drawn again with replacement. Sessions are drawn, not replies: a
 * session's replies follow one another's wording, so they are not separate observations. Undefined
 * when either guide has no place the failure can happen in.
 */
export function differenceOf(base: readonly Tally[], candidate: readonly Tally[], draws = 10_000): { difference: number; low: number; high: number } | undefined {
  if (base.length === 0 || candidate.length === 0) return undefined
  const random = seeded(1)
  /** A guide's rate with its sessions drawn again: as many as it has, each draw any one of them. */
  const again = (tallies: readonly Tally[]) => {
    let hits = 0
    let of = 0
    for (let i = 0; i < tallies.length; i++) {
      const drawn = tallies[Math.floor(random() * tallies.length)]
      if (drawn === undefined) continue
      hits += drawn.hits
      of += drawn.of
    }
    return hits / of
  }
  const found = Array.from({ length: draws }, () => again(candidate) - again(base)).sort((a, b) => a - b)
  const at = (share: number) => found[Math.min(found.length - 1, Math.floor(share * found.length))] ?? NaN

  return { difference: rateOf(candidate) - rateOf(base), low: at(0.025), high: at(0.975) }
}

/**
 * The guide a system prompt holds, by name: of the guides in `named` (name to text) whose text it
 * holds, the longest, so a guide that only adds to another is not taken for it; `unnamed` for other
 * text under `heading`; undefined for no guide.
 */
export function guideIn(system: string, named: ReadonlyMap<string, string>, heading: string): string | undefined {
  let best: { name: string; length: number } | undefined
  for (const [name, text] of named) {
    if (text.length > (best?.length ?? 0) && system.includes(text)) best = { name, length: text.length }
  }
  return best?.name ?? (system.includes(heading) ? 'unnamed' : undefined)
}

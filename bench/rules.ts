// The guide's rules that a reply's text alone can decide, checked with the plugin's own parser and
// drawing rule. Each rule names the guide bullet it checks. A rule never calls a model, and its
// verdicts are not stored: a report computes them from the saved answers, so a corrected rule
// rescores every earlier run. Whether the skim tells the reader what they need is a model's
// judgment instead, in grading.ts.
// It also holds `hiddenIn`, which is no rule: the corpus report uses it to tell what a link hides.
import { growthOf } from '../hooks/grow.ts'
import { HEADING, LIST_ITEM, QUOTE, TABLE_ROW } from '../hooks/layout.ts'
import { drawnAs, isOpenable, isRule, parse, stretches } from '../hooks/parse.ts'
import type { Segment, Stretch } from '../hooks/parse.ts'
import { draw, words } from './measure.ts'
import type { Layout } from './tasks.ts'

export type RuleId =
  | 'keeps-short-words'
  | 'short-form-inline'
  | 'short-form-has-words'
  | 'adds-words'
  | 'not-in-heading-or-table'
  | 'no-stretch-in-short-reply'
  | 'items-stay-visible'
  | 'series-in-view'
  | 'closing-block-last'

/** One rule's verdict on one answer, with what broke it. */
export type RuleVerdict = { rule: RuleId; holds: boolean; evidence: string }

/** A reply as the rules read it: every stretch in it, and its text with each link marked where it stands. */
type Read = { parts: Segment[]; all: Stretch[]; links: Stretch[]; skim: string[]; full: string[] }

type Rule = {
  id: RuleId
  /** The guide bullet the rule checks. */
  bullet: string
  appliesTo: (task: Layout) => boolean
  /** What breaks the rule in this reply, or undefined when it holds. */
  breach: (reply: Read, task: Layout) => string | undefined
}

const quoted = (text: string) => `"${text.trim()}"`
const added = (stretch: Stretch) => {
  const g = growthOf(stretch.short, stretch.long ?? [])
  return g.before + g.between + g.after
}

/** Whether drawn text holds a block between two rules, the shape a closing block takes. */
const holdsRuledBlock = (drawn: string) => drawn.split('\n').filter(isRule).length >= 2

export const RULES: readonly Rule[] = [
  {
    id: 'keeps-short-words',
    bullet: 'The long form keeps every word of the short form, in the same order, and grows around them.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const broken = all.find(s => drawnAs(s) === 'link' && growthOf(s.short, s.long ?? []).missing > 0)
      return broken && `the long form of ${quoted(broken.short)} drops or reorders its words`
    },
  },
  {
    id: 'short-form-inline',
    bullet: 'The short form is plain inline text on one line.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const broken = all.find(s => isOpenable(s) && (s.short.includes('\n') || [HEADING, QUOTE, LIST_ITEM].some(mark => mark.test(s.short.trimStart()))))
      return broken && `the short form ${quoted(broken.short)} is not one plain line`
    },
  },
  // As written by Opus 5.5 under Claude Code 2.1.302: words added after a finished sentence, linked
  // by its period alone. A guide line that showed the sentence's last words as the link instead
  // stopped most of these, and label sentences appeared where they had been.
  {
    id: 'short-form-has-words',
    bullet: "The reader's screen draws each stretch as its short form, a link.",
    appliesTo: () => true,
    breach: ({ all }) => {
      const bare = all.find(s => drawnAs(s) === 'link' && words(s.short) === 0)
      return bare && `the link ${quoted(bare.short)} has no words to click`
    },
  },
  {
    id: 'adds-words',
    bullet: 'A stretch puts depth where it stands: its long form says more than its short form.',
    appliesTo: () => true,
    breach: ({ all }) => {
      const empty = all.find(s => drawnAs(s) === 'link' && added(s) === 0)
      return empty && `${quoted(empty.short)} opens to nothing new`
    },
  },
  {
    id: 'not-in-heading-or-table',
    bullet: 'Never put a stretch inside a code span, a code block, a table or a heading.',
    appliesTo: () => true,
    breach: ({ full }) => {
      const line = full.find(row => (TABLE_ROW.test(row) || HEADING.test(row)) && MARK.test(row))
      return line && `a stretch sits in the heading or table row ${quoted(unmarked(line))}`
    },
  },
  {
    id: 'no-stretch-in-short-reply',
    bullet: 'A reply that is already short needs no stretches.',
    appliesTo: task => task.needsNoStretch === true,
    breach: ({ all }) => {
      const stretch = all.find(isOpenable)
      return stretch && `a short answer still stretches ${quoted(stretch.short)}`
    },
  },
  {
    id: 'items-stay-visible',
    bullet: 'Stretch list items, not whole lists.',
    appliesTo: task => (task.items?.length ?? 0) > 0,
    breach: (reply, task) => missingItems(reply, task.items ?? []),
  },
  // As written by Opus 5.5 and Fable 5.2 under Claude Code 2.1.322: a plan or a series the reader
  // asked for, hidden whole behind a sentence that only announces it ("I would shape it like this.").
  {
    id: 'series-in-view',
    bullet: 'At its shortest, the reply answers on its own.',
    appliesTo: task => (task.series?.length ?? 0) > 0,
    breach: ({ skim }, task) => notInSkim(skim, task.series ?? []),
  },
  {
    id: 'closing-block-last',
    bullet: "If other instructions require a closing block, make it the reply's last stretch.",
    appliesTo: task => task.closing !== undefined,
    breach: ({ parts }) => {
      const at = parts.findLastIndex(part => typeof part !== 'string')
      const last = parts[at]
      if (last === undefined || typeof last === 'string') return 'the reply does not end in a stretch'
      const tail = parts.slice(at + 1).flatMap(part => (typeof part === 'string' ? part.split('\n') : []))
      if (!tail.every(line => line.trim() === '' || isRule(line))) return 'text follows the closing stretch'
      if (drawnAs(last) !== 'link') return `the reply ends in ${quoted(last.short)}, which is not a link`
      if (holdsRuledBlock(draw(last.long ?? [], 'all'))) return undefined
      // The block's separators can frame the final stretch without becoming part of its content.
      const before = parts[at - 1]
      const framed = typeof before === 'string' && isRule(before.trimEnd().split('\n').at(-1) ?? '') && tail.some(isRule)
      return framed ? undefined : `the last stretch, ${quoted(last.short)}, holds no block between two rules`
    },
  },
]

/** The verdict of every rule that applies to `task` on the answer `text`. */
export function verdictsOf(text: string, task: Layout): RuleVerdict[] {
  const reply = read(text)
  return RULES.filter(rule => rule.appliesTo(task)).map(rule => {
    const breach = rule.breach(reply, task)
    return { rule: rule.id, holds: breach === undefined, evidence: breach ?? '' }
  })
}

// Each link a line shows is marked by its index in `links` around its text.
const MARK = /⟪(\d+)⟫/
const unmarked = (line: string) => line.replace(/⟪\/?\d+⟫/g, '')

function read(text: string): Read {
  const parts = parse(text)
  const links: Stretch[] = []
  const mark = (link: Stretch, drawn: string) => {
    links.push(link)
    return `⟪${links.length - 1}⟫${drawn}⟪/${links.length - 1}⟫`
  }
  // The skim marks the links in view; the full text opens every link and marks where each stood.
  const skim = draw(parts, new Set(), mark).split('\n')
  const full = draw(parts, 'all', mark).split('\n')

  return { parts, all: stretches(parts), links, skim, full }
}

/** Whether a line names `item`: it holds one of the item's words, in any case. */
const names = (item: string[], line: string) => item.some(word => unmarked(line).toLowerCase().includes(word.toLowerCase()))
/** Says which items no line of the skim names, or undefined when it names them all. */
function notInSkim(skim: string[], items: string[][]): string | undefined {
  const hidden = items.filter(item => !skim.some(line => names(item, line)))
  return hidden.length === 0 ? undefined : `not in the skim: ${hidden.map(item => item[0] ?? '').join(', ')}`
}

/**
 * Which items are hidden or share a stretch: every item must be named in the skim, and the items
 * must pair one to one with distinct links that add words, each on a skim line naming its item.
 * Where links on such a line name the item in their short form, the item pairs only with those, so
 * a stretch about something else is not taken for the item's own.
 */
function missingItems({ skim, links }: Read, items: string[][]): string | undefined {
  const hidden = notInSkim(skim, items)
  if (hidden !== undefined) return hidden

  const candidates = items.map(item =>
    skim
      .filter(line => names(item, line))
      .flatMap(line => {
        const onLine = [...line.matchAll(/⟪(\d+)⟫/g)].map(m => Number(m[1]))
        const naming = onLine.filter(i => names(item, links[i]?.short ?? ''))
        return naming.length > 0 ? naming : onLine
      })
      .filter(i => {
        const link = links[i]
        return link !== undefined && added(link) > 0
      }),
  )
  // A one-to-one pairing by augmenting paths, so an item is not refused a link another could spare.
  const holder = new Map<number, number>()
  const place = (item: number, seen: Set<number>): boolean =>
    (candidates[item] ?? []).some(link => {
      if (seen.has(link)) return false
      seen.add(link)
      const other = holder.get(link)
      if (other === undefined || place(other, seen)) {
        holder.set(link, item)
        return true
      }
      return false
    })
  const alone = items.filter((_, i) => !place(i, new Set()))

  return alone.length === 0 ? undefined : `without a stretch of their own: ${alone.map(item => item[0] ?? '').join(', ')}`
}

/** A person's verdict on one rule for one answer, with their reason, tied to that answer's text by its SHA-256. */
export type Override = { rule: RuleId; holds: boolean; reason: string; answerSha256: string }

/**
 * `verdict` as adjudicated: an override counts only for the answer text it was made on, the latest
 * of several wins, and one made on other text is returned as stale, never applied.
 */
export function adjudicate(verdict: RuleVerdict, overrides: readonly Override[], answerSha256: string): { holds: boolean; by?: Override; stale: Override[] } {
  const mine = overrides.filter(o => o.rule === verdict.rule)
  const by = mine.filter(o => o.answerSha256 === answerSha256).at(-1)
  return { holds: by?.holds ?? verdict.holds, ...(by !== undefined && { by }), stale: mine.filter(o => o.answerSha256 !== answerSha256) }
}

/** Whether `id` names a rule. */
export const isRuleId = (id: string): id is RuleId => RULES.some(rule => rule.id === id)

/** What a link can hide besides plain text: a status block, or several sections or a list. */
export type Hidden = 'status block' | 'sections'

/**
 * What a link hides, read from its opened long form: a status block (a line that starts
 * `**MISSION**`, or a block between two rules, which wins over sections; unlike
 * `closing-block-last`, it cannot see rules that frame the link from outside), sections or a list
 * (two or more lines led by bold text, or three or more list items), or neither. In live
 * replies Opus 5.5 wrote under Claude Code 2.1.302, most links that hid sections had a label for a
 * short form, and links that hid the status block, whose short form the guide asks to be a one-line
 * gist, did not.
 */
export function hiddenIn(long: string): Hidden | undefined {
  if (/^[ \t]*\*\*MISSION\*\*/m.test(long) || holdsRuledBlock(long)) return 'status block'
  const lines = long.split('\n')
  const led = lines.filter(line => /^\*\*[^*]+\*\*/.test(LIST_ITEM.exec(line)?.[3] ?? line.trimStart())).length
  const items = lines.filter(line => LIST_ITEM.test(line)).length
  return led >= 2 || items >= 3 ? 'sections' : undefined
}

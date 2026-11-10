// Counts how often a long reply holds a stretch, by how much context its request read: whether
// Claude stops writing stretches deep in a long session. Only replies whose request carried the
// guide are counted by depth, so a session run headless, or without the plugin, does not read as
// one where Claude stopped; Claude Code 2.1.300 to 2.1.322 record each request's system prompt in
// the transcript. Prints counts, and no text of any reply.
//   node bench/depth.ts ~/.claude/projects/*/*.jsonl
import { parse, stretches } from '../hooks/parse.ts'
import { words } from './measure.ts'
import { turnsOf } from './transcripts.ts'
import type { Turn } from './transcripts.ts'

/** The words from which a reply counts as long: well past the "one to three short sentences" the guide leaves unstretched. */
const LONG_WORDS = 150
/** Each depth's name and the context tokens it ends before. */
const DEPTHS = [
  ['under 100k', 100_000],
  ['100k to 200k', 200_000],
  ['200k to 400k', 400_000],
  ['400k and over', Infinity],
] as const

type Count = { replies: number; stretched: number }
const counts = <Name extends string>(names: readonly Name[]) => Object.fromEntries(names.map(name => [name, { replies: 0, stretched: 0 }])) as Record<Name, Count>
const add = (count: Count, isStretched: boolean) => {
  count.replies += 1
  if (isStretched) count.stretched += 1
}
const share = ({ replies, stretched }: Count) => (replies === 0 ? 'none' : `${stretched} of ${replies} (${Math.round((100 * stretched) / replies)}%)`)

const byGuide = counts(['carried the guide', 'carried no guide', 'was not recorded'])
const byDepth = counts(DEPTHS.map(([name]) => name))
const byLast = counts(['after a stretched one', 'after a plain one'])
const paths = process.argv.slice(2)
let unread = 0

for (const path of paths) {
  let turns: Turn[]
  try {
    turns = turnsOf(path)
  } catch {
    unread += 1
    continue
  }
  // The guided long reply before this one in the session; undefined before the first, and after one that was not guided.
  let wasStretched: boolean | undefined
  for (const turn of turns) {
    if (words(turn.reply) < LONG_WORDS) continue
    const isStretched = stretches(parse(turn.reply)).length > 0
    const { guided, context } = turn
    add(byGuide[guided === undefined ? 'was not recorded' : guided ? 'carried the guide' : 'carried no guide'], isStretched)
    if (guided !== true) {
      wasStretched = undefined
      continue
    }
    // A request with no usage row reads as no tokens, and has no depth.
    const depth = context === undefined || context === 0 ? undefined : DEPTHS.find(([, end]) => context < end)
    if (depth !== undefined) add(byDepth[depth[0]], isStretched)
    if (wasStretched !== undefined) add(byLast[wasStretched ? 'after a stretched one' : 'after a plain one'], isStretched)
    wasStretched = isStretched
  }
}

const table = (title: string, rows: Record<string, Count>) => [title, ...Object.entries(rows).map(([name, count]) => `  ${name}: ${share(count)}`)].join('\n')
console.log(
  [
    `Replies of ${LONG_WORDS} words or more that hold a stretch, in ${paths.length - unread} transcripts${unread > 0 ? ` (${unread} more could not be read)` : ''}.`,
    table('By whether the request that wrote the reply:', byGuide),
    table('With the guide, by the context tokens the request read:', byDepth),
    table('With the guide, by the long reply before it in the session:', byLast),
  ].join('\n\n'),
)

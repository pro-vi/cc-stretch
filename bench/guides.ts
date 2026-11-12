// The guide variants the guide bench compares, by name: the plugin's own guide (g0) and versions of
// it with additions or replacements that isolate different writing instructions. A guide
// tried once stays here under its name, so a later run can compare against it.
import { GUIDE } from '../hooks/guide.ts'

const AFTER_LONG = '- The long form must read correctly in the short form'
const AFTER_KEEPS = '- The long form keeps every word of the short form'
const AFTER_SHORTEST = '- At its shortest, the reply is one to three short sentences'
const AFTER_CLOSING = '- If other instructions require a closing block'

const GROW = `- Grow inside the sentence where you can. The best stretch adds a qualifier before a word, a clause between two words and a detail after them, so the short form reads as the same sentence with less in it. A stretch that only adds text after its short form reads like a heading and its body, and the reader has to open it to learn anything. Example: "{{The fix keys the cache on the lockfile.|The fix, in \`ci/cache.ts\`, keys the CI cache on the lockfile as well as \`package.json\`, so a dependency bump no longer reuses a stale cache.}}"`
const FILLER = `- Keep the shortest reading to what the reader needs: the answer, what they must decide or do, and the results. Hedges, reasons, background, caveats, restatements and courtesy go inside long forms, where a reader who wants them finds them.`
const LABEL = `- Each short form says something itself, the gist of its long form. A label for the long form, such as "Details." or "What changed.", is not a short form.`
const TRUE = `- Every short form stays true without a click. A condition, doubt, limit or warning that changes what it claims, or what the reader should do next, stays in the short form itself: "the import probably finishes tonight" never shortens to "the import finishes tonight", nor "safe to rerun once the lock is released" to "safe to rerun".`
const CLAIM = `- To find a short form, write the full sentence, then delete words until what is left is a grammatical claim with the same subject and outcome. A short form makes that claim ("The retry duplicates writes."); it never only announces its topic ("Retry details." or "There is a retry issue.").`
const SECTIONS_FINDING = '- A stretch that holds several sections or a list gets a short form that states the main finding they support, with its source and any doubt.'

/** Whether `text` holds `line`, one row or a block of rows, as whole rows. */
const holds = (text: string, line: string) => `\n${text}\n`.includes(`\n${line}\n`)

/**
 * `base` with `line`, one row or a block of rows, inserted after the bullet that starts with
 * `anchor`, or `base` itself when it already holds `line`: a line the plugin's guide took up keeps
 * every variant that adds it the same.
 */
function withLine(base: string, anchor: string, line: string): string {
  const rows = base.split('\n')
  if (holds(base, line)) return base
  const at = rows.findIndex(row => row.startsWith(anchor))
  if (at === -1) throw new Error(`no bullet starts with ${anchor}`)
  return [...rows.slice(0, at + 1), line, ...rows.slice(at + 1)].join('\n')
}

/** `base` with the bullet that starts with `anchor` replaced by `line`. */
function withReplaced(base: string, anchor: string, line: string): string {
  const rows = base.split('\n')
  const at = rows.findIndex(row => row.startsWith(anchor))
  if (at === -1) throw new Error(`no bullet starts with ${anchor}`)
  return rows.with(at, line).join('\n')
}

const LIST = '- Stretch list items, not whole lists.'
const COPY = '- To write a long form, copy its short form and add words to the copy; do not write the detail as a new sentence. If the detail needs different words, change the short form until the long form holds every word of it.'
const SERIES = '- A short form says what its long form says, in fewer words, however many that takes. When the long form is a plan or a series, its short form is that series with each part cut to a few words, never a sentence that only announces it. Example: "{{Next: key the cache on the lockfile; drop the retry; ship on Friday.|Next: key the CI cache on the lockfile as well as `package.json`; drop the retry, which only hides the stale read; and ship on Friday, once CI has passed twice.}}"'

/** Each variant as the lines it adds and the bullet each goes after, in reading order. */
const AFTER_COPY = '- To write a long form, copy its short form'
const SERIES_NAMED = '- A short form says what its long form says, in fewer words, however many that takes. When the long form is a plan or a series, its short form is that series with each part named in a few words. A count of the parts ("three fixes"), a word for what remains ("the rest", "a few follow-ups") and a sentence that only announces them are not short forms: name each part. Example: "{{Next: key the cache on the lockfile; drop the retry; ship on Friday.|Next: key the CI cache on the lockfile as well as `package.json`; drop the retry, which only hides the stale read; and ship on Friday, once CI has passed twice.}}"'
const RECIPES: Readonly<Record<string, readonly (readonly [anchor: string, line: string])[]>> = {
  g0: [],
  /** Grow inside the sentence. */
  g1: [[AFTER_LONG, GROW]],
  /** Keep the shortest reading to what the reader needs. */
  g2: [[AFTER_SHORTEST, FILLER]],
  /** g1 and g2 together. */
  g3: [[AFTER_SHORTEST, FILLER], [AFTER_LONG, GROW]],
  /** A short form is a gist, never a label. */
  g4: [[AFTER_SHORTEST, LABEL]],
  /** Every short form stays true without a click. */
  g5: [[AFTER_SHORTEST, TRUE]],
  /** g5, and a short form makes a claim rather than naming a topic. */
  g6: [[AFTER_SHORTEST, TRUE], [AFTER_LONG, CLAIM]],
  /** Each list item is a stretch of its own, so the list stays in view. The plugin's guide has since taken this line up, so g7 now equals g0. */
  g7: [[AFTER_SHORTEST, LIST]],
  /** Keep lists visible, and have each short form state its point. */
  g8: [[AFTER_SHORTEST, LIST], [LIST, '- Short forms state the point, not the topic.']],
  /** The shorter wording of the same content instruction, with the list rule. */
  g9: [[AFTER_SHORTEST, LIST], [LIST, '- State points, not topics.']],
  /** Define the jobs of the two forms positively. */
  'answer-explain': [[AFTER_SHORTEST, LIST], [LIST, '- Short forms answer; long forms explain.']],
  /** Explicitly exclude links that provide no information. */
  'no-labels': [[AFTER_SHORTEST, LIST], [LIST, '- A short form must state useful information, never a heading, topic label, teaser, or punctuation alone.']],
  /** Reuse the existing instruction for deriving a claim. */
  claim: [[AFTER_SHORTEST, LIST], [LIST, CLAIM]],
  /** Show the difference between naming a subject and stating its result. */
  example: [[AFTER_SHORTEST, LIST], [LIST, '- A short form says what is true: "{{The cache survives restarts.|The local cache survives process restarts because SQLite persists it on disk.}}". "Storage details." only names the subject and is not a useful short form.']],
  /** Put headings outside stretches and stretch the statements they introduce. */
  'headings-outside': [[AFTER_SHORTEST, LIST], [LIST, '- Keep topic headings as ordinary text. Make the statement beneath each heading a stretch.']],
  /** Draft the reply in thinking first, and choose each short form's words there. */
  'draft-in-thinking': [[AFTER_LONG, '- Draft the reply in your thinking first, as plain sentences with all their detail, and choose there the words each detail grows around. Then write the reply from the draft, opening each stretch before those words: a stretch opens before its short form, so a sentence already written can no longer become one.']],
  /** How to write a long form so that it keeps its short form's words: copy them, then add. In live replies the long form was often the detail written as a new sentence. */
  'copy-then-add': [[AFTER_KEEPS, COPY]],
  /** A long form that is a plan or a series gets that series, cut down, as its short form. In live replies such a short form was often the sentence that announces the series. */
  'series-gist': [[LIST, SERIES]],
  /** series-gist with copy-then-add: a series for a short form drops or reorders its words more often, which the copy line is for. */
  'series-copy': [[LIST, SERIES], [AFTER_KEEPS, COPY]],
  /** series-copy, naming the short forms that stand in for a series without saying it: writing the series tasks from scratch under series-copy, Opus 5.5 still wrote "two bugs fixed" and "the rest". */
  'series-named': [[LIST, SERIES_NAMED], [AFTER_KEEPS, COPY]],
  /** series-named, with a line against dropping a detail: under series-copy the opened answers left out more of a task's lesser points. */
  'series-kept': [[LIST, SERIES_NAMED], [AFTER_KEEPS, COPY], [AFTER_COPY, '- Leave no detail out to keep a long form close to its short form: a detail with no short form of its own goes into the long form nearest to it.']],
  /** A sentence that only introduces what follows stays in view as plain text, and what it introduces is stretched. */
  'lead-in-outside': [[LIST, '- A sentence that only introduces what follows it, such as "Here is the plan:", "Two things changed." or "I would shape it like this.", is never a short form. Leave it as plain text outside the stretch, and stretch what it introduces, each part under a short form that states it.']],
  /** A stretch that hides several sections or a list gets a one-line gist for its short form, as the closing block does. */
  'sections-gist': [[AFTER_CLOSING, '- A stretch that hides several sections or a list needs a short form of the same kind: a one-line gist of what they say, never a line that only names them.']],
  /** Keep sections in view, as list items are, so no one stretch hides several. */
  'sections-within': [[LIST, '- Stretch within each section, never around several sections at once.']],
  /** A stretch over several sections states their finding, and its long form opens with that same sentence. */
  'sections-open': [[AFTER_LONG, `${SECTIONS_FINDING} Begin its long form with that same sentence unchanged, then give the sections. Example:\n  {{The note traces duplicate work to separate caches.|The note traces duplicate work to separate caches.\n\n  **Finding.** Both workers compute the same result.\n\n  **Cause.** Each worker keeps its own cache.}}`]],
  /** sections-open, but the finding's words run through the sections in order, with words added before, between and after them, instead of opening the long form. */
  'sections-woven': [[AFTER_LONG, `${SECTIONS_FINDING} Its words then run through the sections in order, with the rest added before, between and after them. Example:\n  {{The note traces the duplicate work to separate caches.|**Finding.** The review note traces the duplicate work both workers do: each computes the same result.\n\n  **Cause.** It comes down to separate caches, one per worker.}}`]],
}

const additions = Object.fromEntries(
  Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.reduce((guide, [anchor, line]) => withLine(guide, anchor, line), GUIDE)]),
)
const listGuide = withLine(GUIDE, AFTER_SHORTEST, LIST)
const withoutLengthRule = withReplaced(listGuide, AFTER_SHORTEST, '- Anything the reader must decide or do stays outside every stretch.')

const SHORT_LONG = "- The long form keeps every short-form word in order, adding words before, between and after them. It must read correctly in the short form's place."
const SHORT_INLINE = '- Short forms are plain inline text on one line. Keep stretches out of code, tables and headings.'
/** The plugin's guide with its explanatory prose cut, keeping its rules and example. */
const SHORTENED = `# Stretchtext replies

Write \`{{short|long}}\`: the reader sees short; a click replaces it with long in place.

- Make the shortest reading a complete answer in one to three short sentences. Keep required decisions and actions outside stretches.
- Stretch list items, not whole lists.
${SHORT_LONG}
${SHORT_INLINE}
- Long forms may contain nested stretches.
- A required closing block is the last stretch, with a one-line gist as its short form.
- Already short replies need no stretches.

Example: "{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by \`package.json\`.}}"

Reading notes identify opened stretches. Do not assume unopened detail was read; repeat it when relevant.`
/** The same rule with what the shortening cut from it: the units a stretch grows by, and why the words already seen stay put. */
const SHORT_LONG_GROWTH = "- The long form keeps every short-form word in order, adding words before, between and after them, so the words the reader already saw stay where they are. It must read correctly in the short form's place: a phrase grows into a clause, a sentence into a paragraph, a paragraph into several."
/** The same rule, refusing a link that is only punctuation, which the shortened guides wrote and the plugin's guide almost never did. */
const SHORT_INLINE_WORDS = '- Short forms are words on one plain inline line, never punctuation alone. Keep stretches out of code, tables and headings.'
/** The same rule, showing what the link holds when words are added after a finished sentence, where the shortened guides often linked only its period. */
const SHORT_INLINE_LAST_WORDS = '- Short forms are words the reader clicks, on one plain inline line. To add after a finished sentence, make its last words the link: "The deploy {{finished.|finished, and the smoke checks passed.}}" Keep stretches out of code, tables and headings.'
const GROWTH = withReplaced(SHORTENED, SHORT_LONG, SHORT_LONG_GROWTH)

export const VARIANTS: Readonly<Record<string, string>> = {
  ...additions,
  shortened: SHORTENED,
  'shortened-growth': GROWTH,
  'shortened-growth-words': withReplaced(GROWTH, SHORT_INLINE, SHORT_INLINE_WORDS),
  'shortened-growth-last-words': withReplaced(GROWTH, SHORT_INLINE, SHORT_INLINE_LAST_WORDS),
  /** No sentence count for the shortest reading. */
  uncapped: withReplaced(listGuide, AFTER_SHORTEST, '- At its shortest, the reply answers on its own, using as many short sentences or list items as needed. Anything the reader must decide or do stays outside every stretch.'),
  /** No length rule for the shortest reading, only that decisions and actions stay outside stretches. */
  'no-length-rule': withoutLengthRule,
  /** no-length-rule, with headings kept outside stretches. */
  'no-length-heading': withLine(withoutLengthRule, LIST, '- Keep headings outside stretches.'),
  /** no-length-rule, with each short form derived by deleting words from its long form. */
  'no-length-derived': withLine(withoutLengthRule, AFTER_LONG, '- Derive each short form by deleting words from its long form.'),
  /** A guide written from scratch around deriving the short form from the long. */
  'compact-derived': `# Stretchtext replies

Use \`{{short|long}}\` for detail revealed in place. Write long first, then derive short by deleting words. Short states the point in its sentence.

Keep the answer, results, actions, limits and uncertainty visible. Keep headings and list structure visible; stretch each list item separately. If the answer needs no explanation, leave it plain. Each expansion adds useful detail.

Short forms are plain inline text on one line. Keep code, tables and headings outside stretch syntax. Expansions may nest. A required closing block is the last stretch; its short form states the actual status.

Reading notes identify opened stretches; restate hidden information when needed.`,
  /** A short guide written from scratch, in bullets. */
  compact: `# Stretchtext replies

The screen shows short in \`{{short|long}}\`; a click replaces it with long in place.

- Answer in the visible text. Keep results, decisions, actions, warnings and uncertainty visible.
- Stretch list items separately. Keep headings as ordinary text.
- A short form states the point in its sentence. The long form keeps its words in order and adds detail. Example: "{{The cache survives restarts.|The local cache survives process restarts because SQLite persists it on disk.}}"
- Short forms are plain text on one line. Keep stretch syntax out of code, tables and headings. Expansions may nest.
- Already short answers need no stretches. Put a required closing status block in the last stretch, summarized by its short form.

Reading notes say which stretches were opened. Restate hidden information when a later question needs it.`,
}

/** The lines each variant in RECIPES adds to g0, in reading order, for a test to hold it to them. */
export const ADDED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.map(([, line]) => line).filter(line => !holds(GUIDE, line))]),
)

// The section cc-stretch adds to Claude's system prompt, and the rule that picks which sessions
// carry a guide on trial in its place. The benchmark rewrites replies under this same text and the
// trial's live check uses the rule, so the file lives on its own.
export const GUIDE = `# Stretchtext replies

The reader's screen draws each stretch \`{{short|long}}\` in your reply as its short form, a link. A click puts the long form in its place and the text reads on; nothing moves to a separate section. So write every reply to read complete at its shortest, with depth where each stretch stands:

- At its shortest, the reply is one to three short sentences that answer on their own. Anything the reader must decide or do stays outside every stretch.
- Stretch list items, not whole lists.
- The long form keeps every word of the short form, in the same order, and grows around them: words added before, between and after the ones the reader already saw. On screen those words stay where they are while the new ones open up around them, so the reader never loses their place. Example: "{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by \`package.json\`.}}"
- The long form must read correctly in the short form's place: a phrase stretches into a clause, a sentence into a paragraph, a paragraph into several.
- Stretches nest: a long form may hold further stretches, each a further level of depth.
- The short form is plain inline text on one line. Never put a stretch inside a code span, a code block, a table or a heading.
- If other instructions require a closing block, such as a status block, make it the reply's last stretch, its short form a one-line gist of the block.
- A reply that is already short needs no stretches.

With each of the reader's messages you are told which stretches they opened. Do not assume they read a long form they did not open; if it matters to what they asked, say it again.`

/**
 * Whether the session `id` is one of the half that carry a guide on trial in place of GUIDE, under
 * the `trialGuide` setting. The id alone decides (one bit of a hash of its characters), so a
 * session keeps one guide from its first request to its last, and the choice can be worked out again
 * from a transcript.
 */
export function takesTrialGuide(id: string): boolean {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193)
  // Mixed once more (MurmurHash3's last step), so that ids differing only in their last character still fall on both sides.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) & 1) === 1
}

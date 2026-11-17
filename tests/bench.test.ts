import { describe, expect, test } from 'claude-code/testing'

import { counted, countedIn, differenceOf, FAILURES, guideIn, LABEL, rateOf, talliesOf } from '../bench/counts.ts'
import { measure, openedFrom, render, words } from '../bench/measure.ts'
import { shortsNamed } from '../bench/opened.ts'
import { growthOf } from '../hooks/grow.ts'
import { parse } from '../hooks/parse.ts'
import { adjudicate, hiddenIn, verdictsOf } from '../bench/rules.ts'
import type { RuleId } from '../bench/rules.ts'
import { readChecks, readKey, readLabels, readPoints, resultOf } from '../bench/grading.ts'
import { differences, readManifest, rowsOf } from '../bench/manifest.ts'
import { canonical, recordingOf, requestBehind } from '../bench/requests.ts'
import { closingOf } from '../bench/closing.ts'
import type { Manifest } from '../bench/manifest.ts'
import { readTask, TASKS } from '../bench/tasks.ts'
import { ADDED, VARIANTS } from '../bench/guides.ts'
import { GUIDE } from '../hooks/guide.ts'
import type { Layout } from '../bench/tasks.ts'

const REPLY = 'The build {{fails|fails on {{a stale cache|a cache keyed only by the lockfile}}}}. Fix `{{x|y}}` first.'

describe('benchmark measures', () => {
  test('skim closes every stretch, full opens every one, read opens only what the reader opened', async () => {
    expect(render(REPLY, new Set())).toBe('The build fails. Fix `{{x|y}}` first.')
    expect(render(REPLY, 'all')).toBe('The build fails on a cache keyed only by the lockfile. Fix `{{x|y}}` first.')
    expect(render(REPLY, new Set(['fails']))).toBe('The build fails on a stale cache. Fix `{{x|y}}` first.')
    expect(measure(REPLY, new Set(['fails']))).toEqual({ skim: 6, full: 14, read: 10 })
  })

  test('draws a short form over two lines open, and an unclosed stretch as its short form', async () => {
    expect(render('A {{b\nc|d e}} f', new Set())).toBe('A d e f')
    expect(render('A {{b\nc|}} f', new Set())).toBe('A b\nc f')
    expect(render('A {{b|c', new Set())).toBe('A b')
    expect(render('A {{b|c', 'all')).toBe('A b')
  })

  test('a stretch closing on a code block\'s closing fence leaves the text after it in both measures', async () => {
    const text = ['{{Count first.|Count first, then push:', '```bash', 'git push', '```}}', '', '{{Risks.|Risks, long.}}', '', 'Bottom line: done.'].join('\n')
    expect(render(text, new Set())).toBe('Count first.\n\nRisks.\n\nBottom line: done.')
    expect(render(text, 'all')).toBe('Count first, then push:\n```bash\ngit push\n```\n\nRisks, long.\n\nBottom line: done.')
    expect(measure(text)).toEqual({ skim: 6, full: 12 })
  })

  test('counts where the added words land around the short form', async () => {
    expect(growthOf('The build fails on a stale cache.', parse('The CI build fails, about one run in five, on a stale dependency cache keyed only by package.json.'))).toEqual({ before: 0, between: 7, after: 4, missing: 0 })
    expect(growthOf('Two options exist.', parse('Two options exist. One is a command, the other a hover.'))).toEqual({ before: 0, between: 0, after: 8, missing: 0 })
    expect(growthOf('Three options exist.', parse('Two options exist.')).missing).toBe(1)
  })

  test('a short form\'s words inside a markdown link or at the end of a path are kept', async () => {
    expect(growthOf('Sources: the forum thread, the wiki.', parse('Sources: [the forum thread](https://x.invalid/t), [the wiki](https://x.invalid/wiki).')).missing).toBe(0)
    expect(growthOf('result.md', parse('/srv/logs/r69/result.md')).missing).toBe(0)
    expect(growthOf('`compact.lua`', parse('`configs/term/compact.lua`, the idle code,')).missing).toBe(0)
    expect(growthOf('thread', parse('[the forum](https://x.invalid/thread)')).missing).toBe(1)
    expect(growthOf('result.md', parse('/srv/logs/r69/other.md')).missing).toBe(1)
  })

  test('counts words that hold a letter or a digit, not markup or punctuation', async () => {
    expect(words('A *b* -- `c` 42 ---')).toBe(4)
  })

  test('reads the opened stretches back from a reading note', async () => {
    expect([...openedFrom('Stretchtext: since your last reply the reader opened "a b", "c". They did not open "d".')]).toEqual(['a b', 'c'])
    expect(openedFrom('Stretchtext: the reader opened no stretch of your last reply.').size).toBe(0)
  })

  test('tells a long form that holds sections or the status block from one that holds neither', async () => {
    const status = 'Status: built, not pushed.\n\n---\n\n**MISSION** · x — y\n\n- [x] Built the thing\n- [ ] Push it\n- [ ] Tag it'
    expect(hiddenIn(status)).toBe('status block')
    expect(hiddenIn('---\n\n- [x] Fixed it\n- [x] Pushed it\n\n**Later** · Rebuild\n\n---')).toBe('status block')
    expect(hiddenIn('Two parts:\n\n**One.** A.\n\n---\n\n**Two.** B.')).toBe('sections')
    expect(hiddenIn('---\n\n**One.** A.\n\n**Two.** B.\n\n---')).toBe('status block')
    expect(hiddenIn('Why it turned it down:\n\n- **One.** A.\n- **Two.** B.')).toBe('sections')
    expect(hiddenIn('\n\n**What the lens found.** A gap.\n\n**What I did.** Closed it.')).toBe('sections')
    expect(hiddenIn('Three steps:\n1. a\n2. b\n3. c')).toBe('sections')
    expect(hiddenIn('Three steps:\n+ a\n+ b\n1) c')).toBe('sections')
    expect(hiddenIn('Two steps:\n1. a\n2. b')).toBe(undefined)
    expect(hiddenIn('The cache is keyed by **the lockfile** and **the platform**.')).toBe(undefined)
  })

  test('reads a lone period or an empty short form back from the words the note names it by', async () => {
    const reply = 'It merged{{.|, and passed.}} It is **approved**{{.|, but blocked.}} The check exited 0{{|, so no errors}}. {{Done.|Done in `ci.ts`.}}'
    expect([...shortsNamed(reply, openedFrom('Stretchtext: since your last reply the reader opened "It is **approved**.", "The check exited 0.". They did not open "It merged.", "Done.".'))]).toEqual(['It is **approved**.', 'The check exited 0.', '.', ''])
    expect([...shortsNamed(reply, new Set(['Done.']))]).toEqual(['Done.'])
    // A note from before 0.5.2 names a stretch by its short form, which is never read as lead-in words.
    expect([...shortsNamed('The check {{exited 0|exited with code 0}}{{|, so no errors}}.', new Set(['exited 0']))]).toEqual(['exited 0'])
    expect([...shortsNamed('It merged {{.|, and passed.}}', new Set(['It merged .']))]).toEqual(['It merged .', '.'])
  })
})

describe('live counts', () => {
  const LONG = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ')
  const KEPT = '{{The build fails.|The build fails on a stale cache.}}'
  const REWORDED = '{{The build fails.|CI is broken by a stale cache.}}'
  const SECTIONS = '{{Two findings.|Two findings.\n\n**One.** A.\n\n**Two.** B.}}'
  const failureNamed = (name: string) => {
    const found = FAILURES.find(failure => failure.name === name)
    if (found === undefined) throw new Error(`no failure named ${name}`)
    return found
  }

  test('a reply is counted by its words, its stretches, the rules it breaks, what its links hide and what the reader opened', async () => {
    expect(counted('s', `${LONG} ${REWORDED}\n\n${SECTIONS}`, new Set(['Two findings.']))).toEqual({
      session: 's', skim: 155, full: 163, stretches: 2, broken: ['keeps-short-words'], dropsWordsOutsideBlock: true, inView: 2, onSections: 1, labelLinks: 2, opened: 1, read: 159,
    })
    expect(counted('s', 'git log --oneline -5')).toEqual({ session: 's', skim: 4, full: 4, stretches: 0, broken: [], dropsWordsOutsideBlock: false, inView: 0, onSections: 0, labelLinks: 0 })
    // A link inside a stretch drawn open, its short form being two lines, is in view too.
    expect(counted('s', `{{Two\nlines|It {{merged|merged today}}.}}`).inView).toBe(1)
  })

  test('every layout rule that needs no task is counted, and a short reply by the rule for short replies', async () => {
    expect(FAILURES.map(failure => failure.name)).toEqual([
      'a long reply holds no stretch', 'keeps-short-words', 'short-form-inline', 'short-form-has-words', 'adds-words', 'not-in-heading-or-table',
      'keeps-short-words, a closing block\'s stretch left out', 'a link hides several sections or a list', 'a reply under 40 words holds a stretch',
    ])
    expect(counted('s', `Done. ${KEPT}`).broken).toEqual(['no-stretch-in-short-reply'])
  })

  test('keeps-short-words is counted again with a closing block\'s stretch left out', async () => {
    // A gist written as a new sentence: no line of the block holds its words.
    const CLOSING_REWORDED = '{{Status: built.|---\n\n**Next** · ship\n\n---}}'
    const gistOnly = counted('a', `${LONG} ${KEPT}\n\n${CLOSING_REWORDED}`)
    expect([gistOnly.broken, gistOnly.dropsWordsOutsideBlock]).toEqual([['keeps-short-words'], false])
    const elsewhere = counted('a', `${LONG} ${REWORDED}\n\n${CLOSING_REWORDED}`)
    expect([elsewhere.broken, elsewhere.dropsWordsOutsideBlock]).toEqual([['keeps-short-words'], true])
    expect(talliesOf([gistOnly, elsewhere, counted('a', 'Short.')], failureNamed('keeps-short-words, a closing block\'s stretch left out'))).toEqual([{ hits: 1, of: 2 }])
  })

  test('a failure is counted only where it can happen, each session on its own', async () => {
    const replies = [counted('a', `${LONG} ${REWORDED}`), counted('a', `${LONG} ${KEPT}`), counted('a', 'Short.'), counted('b', `${LONG} ${KEPT}`), counted('b', LONG), counted('c', `Done. ${KEPT}`)]
    expect(talliesOf(replies, failureNamed('keeps-short-words'))).toEqual([{ hits: 1, of: 2 }, { hits: 0, of: 1 }])
    expect(talliesOf(replies, failureNamed('a long reply holds no stretch'))).toEqual([{ hits: 0, of: 2 }, { hits: 1, of: 2 }])
    expect(talliesOf(replies, failureNamed('a reply under 40 words holds a stretch'))).toEqual([{ hits: 0, of: 1 }, { hits: 1, of: 1 }])
    expect(rateOf(talliesOf(replies, failureNamed('keeps-short-words')))).toBe(1 / 3)
  })

  test('a judge\'s verdicts are counted per link in view, a closing block\'s link left out, where they are the reply\'s', async () => {
    const CLOSING = '{{Status: built.|Status: built.\n\n---\n\n**Next** · ship\n\n---}}'
    const reply = `${LONG} ${KEPT} ${SECTIONS}\n\n${CLOSING}`
    const judged = counted('s', reply, undefined, ['gist', 'label', 'label'])
    expect([judged.inView, judged.labelLinks, judged.labels]).toEqual([3, 2, 1])
    expect(LABEL.tally(judged)).toEqual({ hits: 1, of: 2 })
    // Verdicts on another number of links are not this reply's, and a reply with none is in no tally.
    expect(counted('s', reply, undefined, ['label']).labels).toBe(undefined)
    expect(LABEL.tally(counted('s', reply))).toEqual({ hits: 0, of: 0 })
    expect(talliesOf([judged, counted('s', `${LONG} ${KEPT}`, undefined, ['label']), counted('t', reply)], LABEL)).toEqual([{ hits: 2, of: 3 }])
  })

  test('a counted reply read back from another machine\'s file is the same counts, and a row that is not one is refused', async () => {
    const CLOSING = '{{Status: built.|Status: built.\n\n---\n\n**Next** · ship\n\n---}}'
    const row = { model: 'm', guide: 'shipped', begun: '2026-11-12', counted: counted('a', `${LONG} ${REWORDED} ${SECTIONS}\n\n${CLOSING}`, new Set(['Two findings.']), ['label', 'gist', 'gist']), judges: ['a-judge'] }
    const rows = [row, { model: 'm', guide: 'candidate', begun: '', counted: counted('b', 'Short.') }]
    const read = countedIn(JSON.parse(JSON.stringify(rows)))
    expect(read).toEqual(rows)
    expect(talliesOf(read.map(row => row.counted), LABEL)).toEqual([{ hits: 1, of: 2 }])
    expect(talliesOf(read.map(row => row.counted), failureNamed('keeps-short-words'))).toEqual([{ hits: 1, of: 1 }])
    expect(() => countedIn([{ ...row, guide: undefined }])).toThrow('row 1 is no counted reply')
    expect(() => countedIn([row, { ...row, counted: { ...row.counted, full: '170' } }])).toThrow('row 2 is no counted reply')
    expect(() => countedIn([{ ...row, counted: { ...row.counted, labels: -1 } }])).toThrow('row 1 is no counted reply')
    expect(() => countedIn([{ ...row, counted: { ...row.counted, dropsWordsOutsideBlock: undefined } }])).toThrow('row 1 is no counted reply')
    expect(() => countedIn([{ ...row, judges: 'a-judge' }])).toThrow('row 1 is no counted reply')
    expect(() => countedIn(['a reply'])).toThrow('row 1 is no counted reply')
    expect(() => countedIn([{ ...row, begun: 'yesterday' }])).toThrow('row 1 is no counted reply')
    expect(() => countedIn([{ ...row, counted: { ...row.counted, broken: ['a-rule-this-bench-lacks'] } }])).toThrow('row 1 is no counted reply')
  })

  test('two guides differ by their rates, with an interval drawn over sessions that is the same on every run', async () => {
    const half = Array.from({ length: 6 }, () => ({ hits: 5, of: 10 }))
    const none = Array.from({ length: 6 }, () => ({ hits: 0, of: 10 }))
    expect(differenceOf(half, none)).toEqual({ difference: -0.5, low: -0.5, high: -0.5 })
    // Where sessions differ, the interval is as wide as they make it: one bad session is no finding.
    const uneven = [{ hits: 9, of: 10 }, { hits: 0, of: 10 }, { hits: 0, of: 10 }, { hits: 0, of: 10 }]
    const spread = differenceOf(none, uneven, 2000)
    if (spread === undefined) throw new Error('no difference')
    expect([spread.difference, spread.low, spread.high > 0.4]).toEqual([0.225, 0, true])
    expect(differenceOf(none, uneven, 2000)).toEqual(spread)
    expect(differenceOf([], none)).toBe(undefined)
  })

  test('a recorded system prompt is named by the longest guide it holds, and one under the heading alone is unnamed', async () => {
    const named = new Map([['shipped', '# Guide\n\nWrite stretches.'], ['candidate', '# Guide\n\nWrite stretches.\n\nKeep the words.']])
    const around = (guide: string) => `You are Claude Code.\n\n${guide}\n\nOther instructions.`
    expect(guideIn(around('# Guide\n\nWrite stretches.'), named, '# Guide')).toBe('shipped')
    expect(guideIn(around('# Guide\n\nWrite stretches.\n\nKeep the words.'), named, '# Guide')).toBe('candidate')
    expect(guideIn(around('# Guide\n\nAn older text.'), named, '# Guide')).toBe('unnamed')
    expect(guideIn('You are Claude Code.', named, '# Guide')).toBe(undefined)
  })
})

describe('layout rules', () => {
  const ITEMS = [['memory'], ['sqlite'], ['redis']]
  /** Whether `rule` holds for `text` under `task`; a rule that does not apply is a test error. */
  const holds = (rule: RuleId, text: string, task: Layout = {}) => {
    const verdict = verdictsOf(text, task).find(v => v.rule === rule)
    if (verdict === undefined) throw new Error(`${rule} does not apply`)
    return verdict.holds
  }
  const cases = (rule: RuleId, task: Layout, fail: string[], pass: string[]) => {
    for (const text of fail) expect([text, holds(rule, text, task)]).toEqual([text, false])
    for (const text of pass) expect([text, holds(rule, text, task)]).toEqual([text, true])
  }

  test('keeps-short-words: the long form keeps the short form’s words in order', async () => {
    cases('keeps-short-words', {}, ['{{The build fails.|CI is broken by a stale cache.}}', '{{fails on a cache|on a cache it fails}}'], [
      '{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by `package.json`.}}',
      '{{The fix is one line.|The fix is one line: add the lockfile to the key.}}',
    ])
  })

  test('short-form-inline: the short form is one plain line', async () => {
    cases('short-form-inline', {}, ['A {{first line\nsecond line|both lines, opened}} b.', '{{- Memory is temporary.|- Memory is temporary and resets on restart.}}', '{{## Setup|## Setup, step by step}}'], [
      'Run {{`npm test` first|`npm test` first, then the build}}.',
    ])
  })

  test('short-form-has-words: a link is words, never punctuation alone', async () => {
    cases('short-form-has-words', {}, ['It merged 3 days ago{{.|, and its e2e run passed.}}', 'Three approaches{{:|, each with its tradeoffs:}}'], [
      'It {{merged|merged 3 days ago}}.',
      '{{已合并。|三天前已合并。}}',
      'Run {{`npm test` first|`npm test` first, then the build}}.',
    ])
  })

  test('adds-words: a stretch opens to something new', async () => {
    cases('adds-words', {}, ['- {{Memory is temporary.|Memory is temporary.}}', 'A {{b|}} c.'], ['- {{Memory is temporary.|Memory is temporary, and resets on restart.}}'])
  })

  test('not-in-heading-or-table: no stretch in a heading or a table row', async () => {
    cases('not-in-heading-or-table', {}, ['## {{Setup|Setting up the repo}}\n\nText.', '| tool | note |\n|---|---|\n| bun | {{runs it|runs the bench}} |'], [
      'Use a {{pipe|pipe, the `|` character,}} between columns.',
      'Write `{{a|b}}` to make a stretch.',
      '{{Setup takes a minute.|## Setup\n\nSetup takes a minute.}}',
    ])
  })

  test('no-stretch-in-short-reply: a short answer has no stretch', async () => {
    cases('no-stretch-in-short-reply', { needsNoStretch: true }, ['{{Use git log.|Use git log --oneline -5.}}'], ['git log --oneline -5', 'CSV, JSON, Parquet'])
  })

  test('series-in-view: each part of a series asked for is named before any click', async () => {
    const SERIES = [['lockfile'], ['retry'], ['friday']]
    cases('series-in-view', { series: SERIES }, [
      '{{From that I would shape it like this.|From that I would shape it like this: key the cache on the lockfile; drop the retry; ship on Friday.}}',
      '{{Three steps come next.|Three steps come next: key the cache on the lockfile, drop the retry, ship on Friday.}}',
      'First, key the cache on the lockfile. {{Two more steps follow.|Two more steps follow: drop the retry, then ship on Friday.}}',
    ], [
      '{{Next: key the cache on the lockfile; drop the retry; ship on Friday.|Next: key the CI cache on the lockfile as well; drop the retry, which hides the stale read; and ship on Friday, once CI passes.}}',
      '- {{Key the cache on the lockfile.|Key the CI cache on the lockfile as well.}}\n- Drop the retry.\n- Ship on FRIDAY.',
      'Key the cache on the lockfile, drop the retry and ship on Friday.',
    ])
  })

  test('items-stay-visible: each list item stays in view with a stretch of its own', async () => {
    const own = (name: string) => `{{${name} is one option.|${name} is one option, with its tradeoff.}}`
    cases('items-stay-visible', { items: ITEMS }, [
      '{{Three options.|- Memory is temporary.\n- SQLite persists.\n- Redis is shared.}}',
      `- ${own('Memory')}\n- ${own('SQLite')}\n{{One more.|- Redis is shared.}}`,
      '- Memory is temporary.\n- SQLite persists.\n- Redis is shared.',
      '- {{Memory is temporary.|Memory is temporary.}}\n- {{SQLite persists.|SQLite persists.}}\n- {{Redis is shared.|Redis is shared.}}',
      '{{Memory, SQLite and Redis all work.|Memory is fast, SQLite persists, Redis is shared.}}',
      '{{Memory and SQLite both keep little.|Memory and SQLite both keep little across restarts.}} {{Redis is shared.|Redis is shared across replicas.}} {{Restarts lose data.|Restarts lose data in memory.}}',
    ], [
      `- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `${own('Memory')} It is the one to pick.\n\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `1. ${own('Memory')}\n2. ${own('SQLite')}\n* ${own('Redis')}`,
      `Three options, memory, SQLite and Redis:\n\n- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
    ])
  })

  test('closing-block-last: a required closing block is the last stretch', async () => {
    const block = '---\nDone: the parser.\nNext: the export.\n---'
    cases('closing-block-last', { closing: 'End with a status block.' }, [
      `The parser is merged.\n\n${block}`,
      `The parser is merged.\n\n{{Status: parser done.|\n${block}}}\n\nThat is all.`,
      'The parser is merged.\n\n---\n{{Status: parser done.|Done: the parser.\nNext: the export.}}',
      'The parser is merged.\n\n{{Status: parser done.|Done: the parser.\nNext: the export.}}\n---',
      'The parser is merged.\n\n---\n{{Status: parser done.|Done: the parser.\nNext: the export.}}\n---\nThat is all.',
    ], [
      `The parser is merged.\n\n{{Status: parser done, export next.|\n${block}}}`,
      'The parser is merged.\n\n---\n{{Status: parser done.|Done: the parser.\nNext: the export.}}\n---',
    ])
  })

  test('a rule a task does not ask for is not checked', async () => {
    expect(verdictsOf('git log', {}).map(v => v.rule)).toEqual(['keeps-short-words', 'short-form-inline', 'short-form-has-words', 'adds-words', 'not-in-heading-or-table'])
  })
})

describe('run manifests and judge answers', () => {
  const MANIFEST: Manifest = {
    command: 'tasks', repeats: 1, writer: 'opus', judge: 'haiku', effort: 'default',
    arms: { a: 'aaa', b: 'bbb' }, tasks: TASKS.slice(0, 2), claude: '2.1.301 (Claude Code)', code: 'c-1', revision: { commit: 'c1', isDirty: false },
  }

  test('a manifest differs from another only where an input changed, never by its revision', async () => {
    expect(differences(MANIFEST, { ...MANIFEST, revision: { commit: 'c2', isDirty: true } })).toEqual([])
    expect(differences(MANIFEST, { ...MANIFEST, arms: { a: 'aaa', b: 'changed' }, judge: 'sonnet', claude: '2.1.302 (Claude Code)', code: 'c-2' })).toEqual(['arms.b', 'claude', 'code', 'judge'])
    const [first, second] = TASKS
    if (first === undefined || second === undefined) throw new Error('needs two tasks')
    expect(differences(MANIFEST, { ...MANIFEST, tasks: [{ ...first, key: { ...first.key, never: ['a new claim'] } }, second] })).toEqual([`tasks.${first.id}`])
    expect(differences(MANIFEST, { ...MANIFEST, repeats: 2 })).toEqual(['repeats'])
    // A task read back from disk may hold its fields in another order, which is no difference.
    expect(differences(MANIFEST, readManifest(JSON.stringify(MANIFEST, (_, v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))))).toEqual([])
  })

  test('a manifest and its tasks read back whole, and a malformed one is refused', async () => {
    expect(readManifest(JSON.stringify(MANIFEST))).toEqual(MANIFEST)
    for (const task of TASKS) expect(readTask(JSON.parse(JSON.stringify(task)))).toEqual(task)
    expect(() => readManifest('{"command":"tasks"}')).toThrow('not a guide bench manifest')
    expect(() => readManifest(JSON.stringify({ ...MANIFEST, tasks: undefined }))).toThrow('holds no tasks')
    expect(() => readTask({ id: 'x', question: 'q', evidence: 'e', key: { know: [], defer: [], never: [1] } })).toThrow()
  })

  test('a judge answer is read strictly: wrong words or counts throw', async () => {
    expect(readKey('```json\n{"know":["yes","partly"],"never":["no"]}\n```', 2, 1)).toEqual({ know: ['yes', 'partly'], never: ['no'] })
    expect(() => readKey('{"know":["yes","maybe"],"never":["no"]}', 2, 1)).toThrow('"maybe"')
    expect(() => readKey('{"know":["yes"],"never":["no"]}', 2, 1)).toThrow('not 2')
    expect(() => readKey('{"know":["yes","no","no"],"never":["no"]}', 2, 1)).toThrow('not 2')
    expect(() => readKey('{"know":["yes","no"],"never":["partly"]}', 2, 1)).toThrow('"partly"')
    expect(readLabels('{"verdicts":{"1":"gist","2":"label"}}', 2)).toEqual(['gist', 'label'])
    expect(() => readLabels('{"verdicts":{"1":"gist"}}', 2)).toThrow('exactly 2')
    expect(() => readLabels('{"verdicts":{"1":"gist","3":"label"}}', 2)).toThrow('phrase 2')
    expect(() => readPoints('{"points":[]}')).toThrow()
    expect(() => readChecks('no json here', 1)).toThrow('no JSON object')
  })

  test("Claude Code's answer is read with the models that wrote it", async () => {
    const events = (result: object) => JSON.stringify([{ type: 'system', model: 'claude-opus-5-5' }, { type: 'result', ...result }])
    expect(resultOf(events({ is_error: false, result: ' hi ', modelUsage: { 'claude-opus-5-5': {}, 'claude-haiku-5-5': {} } }))).toEqual({ text: 'hi', models: ['claude-haiku-5-5', 'claude-opus-5-5'] })
    expect(() => resultOf(events({ is_error: true, result: 'API Error: overloaded\nmore' }))).toThrow('API Error: overloaded')
    expect(() => resultOf(JSON.stringify([{ type: 'result', is_error: false, result: 'hi' }]))).toThrow('named no model')
  })

  test('a run file skips a last line cut short, and refuses a malformed one elsewhere', async () => {
    expect(rowsOf('{"a":1}\n{"a":2}\n{"a":')).toEqual({ rows: [{ a: 1 }, { a: 2 }], isCut: true })
    expect(rowsOf('{"a":1}\n')).toEqual({ rows: [{ a: 1 }], isCut: false })
    expect(() => rowsOf('{"a":1}\n{"a":\n{"a":3}\n')).toThrow('line 2')
  })
})

describe('tasks and guide variants', () => {
  test('every task is well formed: unique ids, items and series named by words, short tasks without items, closing instructions that ask for two rules', async () => {
    expect(new Set(TASKS.map(t => t.id)).size).toBe(TASKS.length)
    for (const task of TASKS) {
      expect([task.id, task.needsNoStretch === true && (task.items?.length ?? 0) > 0]).toEqual([task.id, false])
      for (const item of [...(task.items ?? []), ...(task.series ?? [])]) expect([task.id, item.length > 0 && item.every(word => word.trim() !== '')]).toEqual([task.id, true])
      // A series is named in a task's own evidence by the words its rule looks for, or the rule could never hold.
      if (task.kind !== 'rewrite') for (const part of task.series ?? []) expect([task.id, part[0], part.some(word => `${task.question}\n${task.evidence}`.toLowerCase().includes(word.toLowerCase()))]).toEqual([task.id, part[0], true])
      expect([task.id, task.key.know.length > 0]).toEqual([task.id, true])
    }
    expect(TASKS.filter(t => t.heldOut === true).map(t => t.id)).toEqual(['rollout-evidence', 'search-options-zh', 'auth-options', 'parser-status', 'review-fixes', 'cleanup-left', 'estimate-sources', 'incident-plan-zh', 'framework-upgrade', 'outage-review'])
    // A closing instruction asks for the two rules `closing-block-last` looks for.
    for (const task of TASKS) if (task.closing !== undefined) expect([task.id, /horizontal rule/.test(task.closing)]).toEqual([task.id, true])
  })

  test('g0 is the plugin guide, and additive variants only add their declared lines', async () => {
    expect(VARIANTS.g0).toBe(GUIDE)
    for (const [name, added] of Object.entries(ADDED)) {
      const text = VARIANTS[name]
      if (text === undefined) throw new Error(`missing guide ${name}`)
      // A declared line can be a block of rows, such as a bullet with a worked example: each sits whole
      // in the variant, in reading order, and taking them out leaves the plugin guide.
      const at = added.map(line => `\n${text}\n`.indexOf(`\n${line}\n`))
      expect([name, at.every((i, k) => i !== -1 && i > (at[k - 1] ?? -1))]).toEqual([name, true])
      expect([name, added.reduce((rest, line) => rest.replace(`\n${line}\n`, '\n'), `\n${text}\n`)]).toEqual([name, `\n${GUIDE}\n`])
    }
  })

  test('variants that replace the closing-block bullet differ from their base in that row alone', async () => {
    for (const [name, base] of [['closing-gist-first', 'g0'], ['series-named-closing', 'series-named'], ['series-short-closing', 'series-short']] as const) {
      const rows = (VARIANTS[name] ?? '').split('\n')
      const baseRows = (VARIANTS[base] ?? '').split('\n')
      const at = baseRows.findIndex(row => row.startsWith('- If other instructions require a closing block'))
      expect([name, rows[at]?.startsWith('- Make a required closing block')]).toEqual([name, true])
      expect([name, rows.with(at, baseRows[at] ?? '')]).toEqual([name, baseRows])
    }
  })
})

describe('closing blocks', () => {
  const BLOCK = '---\n\n**Goal** · ship the parser\n\n- [x] parser merged\n- [ ] renderer tested\n\n---'

  test('a stretch that holds the block begins with its gist\'s line, keeps the gist\'s words another way, or drops one', async () => {
    expect(closingOf(`Done. {{Status: parser merged; renderer next.|Status: parser merged; renderer next.\n\n${BLOCK}}}`)).toBe('gist-first')
    expect(closingOf(`Done. {{Goal: ship the parser; renderer tested next.|${BLOCK.replace('**Goal** ·', 'Goal:').replace('- [ ] renderer tested', '- [ ] renderer tested next.')}}}`)).toBe('kept')
    expect(closingOf(`Done. {{Status: parser merged; renderer next.|${BLOCK}}}`)).toBe('dropped')
  })

  test('the stretch is the last that holds the block, or the reply\'s last where the block\'s rules frame it; a block in view is in none', async () => {
    // The first stretch drops no word; the block's, after it, does.
    expect(closingOf(`{{The build fails.|The build fails on a stale cache.}}\n\n{{Status: merged.|${BLOCK}}}`)).toBe('dropped')
    expect(closingOf('Done.\n\n---\n\n{{Goal: ship the parser.|**Goal:** ship the parser, with its tests.\n\n- [x] parser merged}}\n\n---')).toBe('kept')
    expect(closingOf(`{{The build fails.|The build fails on a stale cache.}}\n\n${BLOCK}`)).toBe('bare')
    expect(closingOf('{{The build fails.|The build fails on a stale cache.}}')).toBe('none')
  })
})

describe('recorded requests', () => {
  // A transcript as Claude Code 2.1.325 records two requests of one session: the second lists its messages as the first's and a tail.
  const shape = { system: [{ type: 'text', text: 'You are Claude Code.' }], tools: [] }
  const params = { model: 'claude-opus-5-5', max_tokens: 100 }
  const first = { role: 'user', content: [{ type: 'text', text: 'What broke?' }] }
  const answer = { role: 'assistant', content: [{ type: 'text', text: 'The cache.' }] }
  const second = { role: 'user', content: [{ type: 'text', text: 'Since when?' }] }
  // Any hash serves here: a recording is only ever held to the function it is read with. Claude Code's is SHA-256.
  const digestOf = (text: string) => {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
    return (hash >>> 0).toString(16)
  }
  const hashOf = (value: unknown) => digestOf(canonical(value, true))
  const read = (lines: string[], through?: number) => recordingOf(lines, digestOf, through)
  const marked = { ...second, content: [{ ...second.content[0], cache_control: { type: 'ephemeral' } }] }
  const rows = (blob: unknown = second) => [
    { type: 'api-request-shape', shapeHash: hashOf(shape), shape },
    { type: 'user', message: { role: 'user', content: 'What broke?' } },
    { type: 'api-request', id: 'r1', shapeHash: hashOf(shape), params, keep: 0, tail: [hashOf(first)], cacheControl: [], requestDigest: digestOf(canonical({ ...params, ...shape, messages: [first] })) },
    { type: 'assistant', requestRef: 'r1', version: '2.1.325', message: { id: 'm1', role: 'assistant', content: answer.content } },
    // The second prompt is in no row of its own: the transcript holds it only as a request's message.
    { type: 'api-request-blob', hash: hashOf(second), message: blob },
    { type: 'api-request', id: 'r2', base: 'r1', keep: 1, shapeHash: hashOf(shape), params, tail: [hashOf(answer), hashOf(second)], cacheControl: [{ path: ['messages', 2, 'content', 0], value: { type: 'ephemeral' } }], requestDigest: digestOf(canonical({ ...params, ...shape, messages: [first, answer, marked] })) },
    { type: 'assistant', requestRef: 'r2', version: '2.1.325', message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Since Monday.' }] } },
  ].map(row => JSON.stringify(row))

  test('the text that is hashed sorts every object\'s keys, and leaves cache marks out only where asked', async () => {
    const value = { b: 1, a: { z: [2, { y: null, x: 'q' }], cache_control: { type: 'ephemeral' } } }
    expect(canonical(value, true)).toBe('{"a":{"z":[2,{"x":"q","y":null}]},"b":1}')
    expect(canonical(value)).toBe('{"a":{"cache_control":{"type":"ephemeral"},"z":[2,{"x":"q","y":null}]},"b":1}')
  })

  test('a request is rebuilt from its shape, its messages and its cache marks, equal to its recorded digest', async () => {
    const recording = read(rows())
    expect([...recording.replies].map(([line, reply]) => [line, reply.text, reply.version])).toEqual([[4, 'The cache.', '2.1.325'], [7, 'Since Monday.', '2.1.325']])
    expect(requestBehind(recording, 4).body.messages).toEqual([first])
    const { body, digest } = requestBehind(recording, 7)
    expect(body.messages).toEqual([first, answer, marked])
    expect([body.model, body.system, digest]).toEqual(['claude-opus-5-5', shape.system, digestOf(canonical(body))])
    // The recording's own message keeps no cache mark from the request rebuilt out of it.
    expect(requestBehind(recording, 4).body.messages).toEqual([first])
  })

  test('what the transcript does not hold whole is refused, never sent', async () => {
    expect(() => read(rows({ role: 'user', content: [{ type: 'text', text: 'Since then?' }] }))).toThrow('line 5 does not match its hash')
    expect(() => requestBehind(read(rows()), 2)).toThrow('no reply at that line')
    const noBlob = rows().filter((_, i) => i !== 4)
    expect(() => requestBehind(read(noBlob), 6)).toThrow('a message is not recorded')
    const otherDigest = rows().map((row, i) => (i === 2 ? row.replace(/"requestDigest":"[0-9a-f]+"/, '"requestDigest":"0"') : row))
    expect(() => requestBehind(read(otherDigest), 4)).toThrow('does not match its digest')
    // Lines after `through` are not read, and a last line cut short is the one a running session is writing.
    expect([...read(rows(), 4).replies.keys()]).toEqual([4])
    expect([...read([...rows(), '{"type":"assis']).replies.keys()]).toEqual([4, 7])
    expect(() => read(['{"type":"assis', ...rows()])).toThrow('line 1 is not JSON')
  })
})

describe('overrides', () => {
  const broken = { rule: 'items-stay-visible', holds: false, evidence: 'not in the skim: memory' } as const
  const override = (holds: boolean, answerSha256: string, reason = 'the toolbar paragraph is its own item') => ({ rule: 'items-stay-visible', holds, reason, answerSha256 }) as const

  test('an override applies only to the answer it was made on, and the latest wins', async () => {
    expect(adjudicate(broken, [], 'hash-1')).toEqual({ holds: false, stale: [] })
    expect(adjudicate(broken, [override(true, 'hash-1')], 'hash-1')).toEqual({ holds: true, by: override(true, 'hash-1'), stale: [] })
    expect(adjudicate(broken, [override(true, 'hash-1'), override(false, 'hash-1', 'on a second read, hidden')], 'hash-1').holds).toBe(false)
    expect(adjudicate(broken, [override(true, 'hash-0')], 'hash-1')).toEqual({ holds: false, stale: [override(true, 'hash-0')] })
    expect(adjudicate({ ...broken, rule: 'adds-words' }, [override(true, 'hash-1')], 'hash-1')).toEqual({ holds: false, stale: [] })
  })
})

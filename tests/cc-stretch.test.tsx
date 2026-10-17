import type { On, PromptChangeInput, PromptEditInput, RenderSurface, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { grow } from '../hooks/grow'
import { contrastOn } from '../hooks/contrast'
import { DEFAULT_LOOK, lookOf, marksSetting } from '../hooks/look'
import { layout, link, linkAt, tint, widthOf } from '../hooks/layout'
import { closeAfter, hideLongForms, newStreamState, paragraphsOf, parse, stretches } from '../hooks/parse'
import Reply from '../hooks/reply'

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key:',
  '```yaml',
  'key: {{hash}}',
  '```',
  '}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }
const HREF = 'https://cc-stretch.invalid/'
const FIRST = 'paragraph-0'
const COMPOSE = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  tools: [],
  outputStyle: null,
  traits: [],
} as const

const mountReply = ($: Engine, viewport: typeof FULLSCREEN, text = REPLY, surface: 'terminal' | 'desktop' = 'terminal', requestId = 'reply-1') =>
  $.ui.mount({
    plugin: 'cc-stretch',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    viewport,
  })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const shown = async (ui: Mounted) => (await ui.find({ type: 'Markdown' }))?.text ?? ''

/** Whether the reply carries the note saying why its stretches are open. */
const hasNote = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).some(piece => piece.text?.includes('NO_FLICKER') === true)

/** The text a node shows, its children's strings joined. */
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}

/** The rows a paragraph's Client draws, as plain text. */
const rowsOf = async (ui: Mounted, key = FIRST): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf)
}
/** The text a Client draws, each row's trailing spaces trimmed: a styled last row ends in one plain cell. */
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).map(row => row.trimEnd()).join('\n')

/** Presses `phrase` where the Client drew it, as a mouse does: down, then up. The last one when `last`. */
const pressOn = async (ui: Mounted, phrase: string, { key = FIRST, last = false } = {}) => {
  const rows = await rowsOf(ui, key)
  const y = last ? rows.findLastIndex(row => row.includes(phrase)) : rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  const x = widthOf(row.slice(0, last ? row.lastIndexOf(phrase) : row.indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}

describe('grow', () => {
  const NELSON = 'Stretchtext, a kind of hypertext, is basically a form of writing closely related to other prose.'
  const plain = (text: string, progress: number, short = 'Stretchtext is a form of writing.') =>
    grow(short, parse(text), progress, () => '')

  test('starts from the short form and ends at the long form', async () => {
    expect(plain(NELSON, 0)).toBe('Stretchtext, is a form of writing')
    expect(plain(NELSON, 1)).toBe(NELSON)
  })

  test('opens every seam at once, keeping the anchors in order', async () => {
    const half = plain(NELSON, 0.5)
    expect(half).toMatch(/^Stretchtext, a .*is .*a form of writing closely/)
    expect(half.split(/\s+/).every(word => NELSON.includes(word))).toBe(true)
    expect(half.length).toBeGreaterThan(plain(NELSON, 0).length)
    expect(half.length).toBeLessThan(NELSON.length)
  })

  test('grows to the left of an anchor and to the right of the last', async () => {
    expect(grow('cache', parse('the stale cache'), 0.5, () => '')).toBe('stale cache')
    expect(grow('cache', parse('cache of old modules'), 0.5, () => '')).toBe('cache of ')
  })

  test('a nested stretch holding the short words anchors them, and a later repeat does not', async () => {
    const long = parse('wraps values, plus {{a way to chain|two operations, a way to chain}} functions. You have to try it.')
    const shown = grow('wraps values, plus a way to chain functions.', long, 0, nested => `[${nested.short}]`)
    expect(shown).toBe('wraps values, plus [a way to chain] functions.')
  })

  test('punctuation standing after an anchor stays with it', async () => {
    const long = parse('In short, it returns {{a value|a value, wrapped}} .')
    expect(grow('it returns a value.', long, 0, nested => `[${nested.short}]`)).toBe('it returns [a value] .')
  })

  test('a long form without the short words arrives in reading order', async () => {
    expect(grow('x', parse('one two three four'), 0.5, () => '')).toBe('one two ')
  })
})

describe('streaming', () => {
  test('shows each stretch as its short form, across flushes, and drops lines of hidden depth', async () => {
    const state = newStreamState()
    expect(hideLongForms('The build fails {{on a stale cache|because the cache key', state)).toBe('The build fails on a stale cache')
    expect(hideLongForms('hashes only `package.json`.\nStill hidden.\n}}, written {{x|y}} there.\n\nNext `{{a|b}}` line.', state)).toBe(', written x there.\n\nNext `{{a|b}}` line.')
    expect(hideLongForms('}} done.', { open: [{ isLong: true }], fence: undefined, span: undefined })).toBe(' done.')
  })

  test('a code span over several lines is copied as written, and a stretch after it shows short', async () => {
    const state = newStreamState()
    expect(hideLongForms('Use `the', state)).toBe('Use `the')
    expect(hideLongForms('value` then {{tip|a tip}}.', state)).toBe('value` then tip.')
    expect(hideLongForms('Use `the\n{{a|b}} value` ok.', newStreamState())).toBe('Use `the\n{{a|b}} value` ok.')
  })

  test('a line starting with a fence marker and more text does not close the block, so braces after it stay as written', async () => {
    const state = newStreamState()
    expect(hideLongForms(['```', '```python', '{{a|b}}', '```', '{{c|d}}'].join('\n'), state)).toBe(['```', '```python', '{{a|b}}', '```', 'c'].join('\n'))
  })

  for (const surfaces of [['terminal'], ['terminal', 'mobile'], ['terminal', 'vscode']] satisfies RenderSurface[][]) {
    test(`the display of a streaming reply never shows the markup with ${surfaces.join(' and ')} attached`, async ($, on) => {
      on('classic.MessageDisplay', () => ({}))
      on('session.surfaces', () => ({ value: surfaces }))
      const flush = (index: number, delta: string, final = false) =>
        $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final, delta })
      expect((await flush(0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBe('A monad is a wrapper')
      expect((await flush(1, 'Maybe or List,}} with two operations.', true)).displayContent).toBe(' with two operations.')
    })
  }

  test('a message keeps the filter it started with when the desktop attaches or leaves midway', async ($, on) => {
    let surfaces: RenderSurface[] = ['terminal']
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: surfaces }))
    const flush = (message: string, index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: message, index, final, delta })
    expect((await flush('m1', 0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBe('A monad is a wrapper')
    surfaces = ['terminal', 'desktop']
    expect((await flush('m1', 1, 'Maybe or List,}} with two operations.', true)).displayContent).toBe(' with two operations.')

    expect((await flush('m2', 0, 'A monad is {{a wrapper|a wrapper, like')).displayContent).toBeUndefined()
    surfaces = ['terminal']
    expect((await flush('m2', 1, 'Maybe or List,}} with two operations.', true)).displayContent).toBeUndefined()
  })

  // As of Claude Code 2.1.302 a reload, such as the one each saved setting causes, loads the hooks module
  // afresh; plugin state outlives it, so a reply streaming across it keeps its filter.
  test('a message\'s filter state is held in plugin state between its flushes, until its last or another message begins', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    const written: unknown[] = []
    on('state.set', { plugin: 'cc-stretch', key: 'streams' }, (_, e, next) => {
      written.push(e.value)
      return next(e)
    })
    const flush = (message: string, index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: message, index, final, delta })
    await flush('m1', 0, 'A monad is {{a wrapper|a wrapper, like\n')
    expect(written.at(-1)).toEqual({ m1: { open: [{ isLong: true }] } })
    await flush('m2', 0, 'A monad is {{a wrapper|a wrapper, like\n')
    expect(written.at(-1)).toEqual({ m2: { open: [{ isLong: true }] } })
    await flush('m2', 1, 'Maybe or List,}} with two operations.', true)
    expect(written.at(-1)).toEqual({})
  })

  test('flushes of one message that run at once are filtered in order', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    const flush = (index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final, delta })
    const shown = await Promise.all([flush(0, 'Intro.\n'), flush(1, 'A monad is {{a wrapper|a wrapper, like\n'), flush(2, 'Maybe or List,}} with two operations.', true)])
    expect(shown.map(flush => flush.displayContent)).toEqual(['Intro.\n', 'A monad is a wrapper\n', ' with two operations.'])
  })

  test('a message that begins leaves a finished one the state its last flush, still on its way, needs', async ($, on) => {
    let release = () => {}
    const held = new Promise<void>(resolve => (release = resolve))
    on('classic.MessageDisplay', async (_, e) => {
      if (e.message_id === 'a' && e.final) await held
      return {}
    })
    on('session.surfaces', () => ({ value: ['terminal'] }))
    const flush = (message: string, index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: message, index, final, delta })
    await flush('a', 0, 'A monad is {{a wrapper|a wrapper, like\n')
    const last = flush('a', 1, 'Maybe or List,}} with two operations.', true)
    await flush('b', 0, 'Next.\n')
    release()
    expect((await last).displayContent).toBe(' with two operations.')
  })

  // As of Claude Code 2.1.302 the test kit cannot reload a plugin, so the reload is stood in for by the
  // state the last flush before it left, answered to the plugin's own read.
  test('a message first seen midway continues from the state its last flush left, and is found once finished', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const raw = 'A monad is {{a wrapper|a wrapper, like\nMaybe or List,}} with two operations.\n'
    let hasLanded = false
    let searches = 0
    on('session.messages', () => {
      searches++
      return { value: hasLanded ? [{ role: 'assistant' as const, text: raw, toolUses: [] }] : [] }
    })
    let isLeft = true
    on('state.get', (_, e, next) => (isLeft && e.plugin === 'cc-stretch' && e.key === 'streams' ? { value: { value: { m: { open: [{ isLong: true }] } }, version: 0 } } : next(e)))
    on('state.set', { plugin: 'cc-stretch', key: 'streams' }, (_, e, next) => {
      isLeft = false
      return next(e)
    })
    const earlier = await mountReply($, FULLSCREEN, 'A plain reply drawn before.', 'terminal', 'reply-0')
    await earlier.unmount()
    const middle = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 1, final: false, delta: 'Maybe or List,}} with two operations.\n' })
    expect(middle.displayContent).toBe(' with two operations.\n')
    hasLanded = true
    await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 2, final: true, delta: '' })
    const ui = await mountReply($, FULLSCREEN, 'A monad is a wrapper\n with two operations.\n')
    expect((await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === 'a wrapper')?.props).toMatchObject({ underline: true })
    await ui.unmount()
    expect(searches).toBe(2)
  })

  // As of Claude Code 2.1.302 a flush that fails beneath shows its delta as written.
  test('a reply whose final flush failed is found among the session\'s messages when drawn', async ($, on) => {
    on('classic.MessageDisplay', (_, e) => {
      if (e.final) throw new Error('a hook beneath failed')
      return {}
    })
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const raw = 'A monad is {{a wrapper|a wrapper, like Maybe or List}}.\nDone.'
    let hasLanded = false
    on('session.messages', () => ({ value: hasLanded ? [{ role: 'assistant' as const, text: raw, toolUses: [] }] : [] }))
    const earlier = await mountReply($, FULLSCREEN, 'A plain reply drawn before.', 'terminal', 'reply-0')
    await earlier.unmount()
    const first = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 0, final: false, delta: 'A monad is {{a wrapper|a wrapper, like Maybe or List}}.\n' })
    expect(first.displayContent).toBe('A monad is a wrapper.\n')
    await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 1, final: true, delta: 'Done.' }).catch(() => undefined)
    hasLanded = true
    const ui = await mountReply($, FULLSCREEN, 'A monad is a wrapper.\nDone.')
    expect((await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === 'a wrapper')?.props).toMatchObject({ underline: true })
    await ui.unmount()
  })

  test('the hooks beneath see each flush at once, and the flushes are still filtered in order', async ($, on) => {
    const called: number[] = []
    const releases = new Map<number, () => void>()
    let allCalled = () => {}
    const reached = new Promise<void>(resolve => (allCalled = resolve))
    on('classic.MessageDisplay', async (_, e) => {
      called.push(e.index)
      if (called.length === 3) allCalled()
      await new Promise<void>(resolve => releases.set(e.index, resolve))
      return {}
    })
    on('session.surfaces', () => ({ value: ['terminal'] }))
    const flush = (index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final, delta })
    const all = Promise.all([flush(0, 'A monad is {{a wrapper|a wrapper, like\n'), flush(1, 'Maybe or List,}} with two.\n'), flush(2, 'End.', true)])
    // Held one at a time, the hooks beneath would see only the first flush, and this would never resolve.
    await reached
    expect(called).toEqual([0, 1, 2])
    for (const index of [2, 1, 0]) releases.get(index)?.()
    expect((await all).map(shown => shown.displayContent)).toEqual(['A monad is a wrapper\n', ' with two.\n', 'End.'])
  })

  // Claude Code 2.1.299 and 2.1.300 hand the AssistantMessage site the display text the filter left.
  test('a reply the filter drew short is drawn from its markup, pressable', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    let shownText = ''
    for (const [index, delta] of ['A monad is {{a wrapper|a wrapper, like\n', 'Maybe or List,}} with two operations.\n', ''].entries()) {
      const flush = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index, final: index === 2, delta })
      shownText += flush.displayContent ?? ''
    }
    expect(shownText).toBe('A monad is a wrapper\n with two operations.\n')

    const ui = await mountReply($, FULLSCREEN, shownText.trim())
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'a wrapper')?.props).toMatchObject({ underline: true })
    await pressOn(ui, 'a wrapper')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('Maybe or List, «')
    await ui.unmount()
  })

  test('a reply filtered before the plugin loaded is found among the session\'s messages', async ($, on) => {
    on('session.messages', () => ({ value: [{ role: 'assistant', text: REPLY, toolUses: [] }] }))
    const ui = await mountReply($, FULLSCREEN, hideLongForms(REPLY, newStreamState()))
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    expect(await textIn(ui, 'paragraph-1')).toBe('The fix is one line.')
    await ui.unmount()
  })

  test('a reply filtered before the plugin loaded is found however far back, and the session is read once', async ($, on) => {
    const replies = Array.from({ length: 52 }, (_, i) => `Reply ${i}: {{short ${i}|long detail ${i}}}.`)
    let searches = 0
    on('session.messages', () => {
      searches++
      return { value: replies.map(text => ({ role: 'assistant' as const, text, toolUses: [] })) }
    })
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    for (const [i, reply] of replies.slice(0, 2).entries()) {
      const ui = await mountReply($, FULLSCREEN, hideLongForms(reply, newStreamState()))
      expect((await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === `short ${i}`)?.props).toMatchObject({ underline: true })
      await ui.unmount()
    }
    const unknown = await mountReply($, FULLSCREEN, 'A reply no message holds.')
    expect(await unknown.find({ text: 'engine' })).toBeDefined()
    await unknown.unmount()
    expect(searches).toBe(1)
  })

  test('a filtered reply that held no stretch is drawn by the engine, without a search', async ($, on) => {
    on('classic.MessageDisplay', () => ({}))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    let searches = 0
    on('session.messages', () => {
      searches++
      return { value: [] }
    })
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 0, final: true, delta: 'Plain answer.' })
    const ui = await mountReply($, FULLSCREEN, 'Plain answer.')
    expect(await ui.find({ text: 'engine' })).toBeDefined()
    expect(searches).toBe(0)
    await ui.unmount()
  })
})

describe('parse', () => {
  test('keys nested stretches by their short forms and leaves braces in code as text', async () => {
    const found = stretches(parse(REPLY))
    expect(found.map(s => [s.key, s.short])).toEqual([
      ['on a stale cache', 'on a stale cache'],
      ['on a stale cache › , set in one file', ', set in one file'],
      ['The fix is one line.', 'The fix is one line.'],
    ])
    expect(JSON.stringify(found[2]?.long)).toContain('key: {{hash}}')
    expect(stretches(parse('{{a|1}} {{a|2}}')).map(s => s.key)).toEqual(['a', 'a~2'])
  })

  test('keys a short form over several lines with ↵ for each line break, so no one-line short form shares its key', async () => {
    expect(stretches(parse('{{a\nb|1}} {{a b|2}} {{a|{{b|3}}}} {{a\n› b|4}}')).map(s => s.key)).toEqual(['a↵b', 'a b', 'a', 'a › b', 'a↵› b'])
  })

  test('a stretch still streaming is not closed, and one with no long form opens nothing', async () => {
    const [, partial] = parse('Lead {{partial|long so far')
    expect(typeof partial !== 'string' && partial).toMatchObject({ short: 'partial', isClosed: false })
    const [, plain] = parse('Lead {{plain}} end')
    expect(typeof plain !== 'string' && plain).toMatchObject({ short: 'plain', long: undefined, isClosed: true })
  })
})

describe('layout', () => {
  test('wraps words to the width and keeps a pressable phrase findable by its cells', async () => {
    const rows = layout(`one two three ${link('open', 'k', 'four five')} six`, 12)
    expect(rows.map(row => row.map(run => run.text).join(''))).toEqual(['one two', 'three four', 'five six'])
    expect(linkAt(rows, 6, 1)).toEqual({ action: 'open', key: 'k' })
    expect(linkAt(rows, 0, 1)).toBeUndefined()
    expect(linkAt(rows, 0, 2)).toEqual({ action: 'open', key: 'k' })
  })

  // Nerd Font icons sit in the Private Use Area, so a reply can hold any of its characters.
  test('draws Private Use Area characters as written and keeps a link after them pressable', async () => {
    const icons = '\ue000\ue001\ue002\ue003\ue004 '
    const rows = layout(`${icons}${link('open', 'k', 'four')} ok`, 30)
    expect(rows.map(row => row.map(run => run.text).join(''))).toEqual([`${icons}four ok`])
    expect(linkAt(rows, widthOf(icons) + 1, 0)).toEqual({ action: 'open', key: 'k' })
  })

  test('lays out a line holding a mark with no separator after it, reading the mark as a character', async () => {
    const start = link('open', 'k', 'x').charAt(0)
    const shade = tint('red', 'x').charAt(0)
    expect(layout(`a ${start} b ${shade} c`, 30).map(row => row.map(run => run.text).join(''))).toEqual([`a ${start} b ${shade} c`])
  })

  test('a press a cell beside a one-cell closer lands on it', async () => {
    const rows = layout(`done ${link('close', 'k', '«')}`, 40)
    expect(linkAt(rows, 5, 0)).toEqual({ action: 'close', key: 'k' })
    expect(linkAt(rows, 6, 0)).toEqual({ action: 'close', key: 'k' })
    expect(linkAt(rows, 4, 0)).toEqual({ action: 'close', key: 'k' })
  })

  test('draws bold, code and list items, and keeps a fenced block as written', async () => {
    const rows = layout(['- **bold** and `code`', '```', 'let x = {{y}}', '```'].join('\n'), 40)
    expect(rows[0]?.map(run => [run.text, run.bold === true, run.code === true])).toEqual([
      ['- ', false, false],
      ['bold', true, false],
      [' and ', false, false],
      ['code', false, true],
    ])
    expect(rows[1]?.map(run => run.text).join('')).toBe('  let x = {{y}}')
  })

  test('a code span or a link label tinted word by word draws whole, and the tint ends where its words do', async () => {
    const added = (word: string) => tint('#d3bdff', word)
    const text = `${added('Run')} ${added('`claude')} ${added('plugin')} install\` and ${added('[the')} ${added('docs')} page](https://x.invalid/a) now`
    const runs = layout(text, 80)[0] ?? []
    expect(runs.map(run => run.text).join('')).toBe('Run claude plugin install and the docs page now')
    expect(runs.filter(run => run.code).map(run => run.text)).toEqual(['claude plugin install'])
    expect(runs.filter(run => run.href).map(run => [run.text, run.tint, run.href])).toEqual([
      ['the docs ', '#d3bdff', 'https://x.invalid/a'],
      ['page', undefined, 'https://x.invalid/a'],
    ])
    expect(runs.find(run => run.text.includes('and'))?.tint).toBeUndefined()
  })

  test('a bare URL is a hyperlink, without the punctuation that ends its sentence or a bracket it did not open', async () => {
    const hrefs = (text: string) => (layout(text, 200)[0] ?? []).filter(run => run.href).map(run => [run.text, run.href])
    expect(hrefs('See https://x.invalid/a/b?c=1. Then go.')).toEqual([['https://x.invalid/a/b?c=1', 'https://x.invalid/a/b?c=1']])
    expect(hrefs('(see https://x.invalid/wiki/A_(b))')).toEqual([['https://x.invalid/wiki/A_(b)', 'https://x.invalid/wiki/A_(b)']])
    expect(hrefs('no https:// host, nor xhttps://x.invalid')).toEqual([])
    expect(hrefs('`https://x.invalid/code`')).toEqual([])
  })

  test('a markdown link to a target other than http:, https: or file: keeps it beside its label', async () => {
    const runs = layout('Open [the file](ci/cache.ts) here', 80)[0] ?? []
    expect(runs.map(run => run.text).join('')).toBe('Open the file (ci/cache.ts) here')
    expect(runs.some(run => run.href)).toBe(false)
  })

  test('counts wide characters as two cells', async () => {
    expect(widthOf('漢字ab')).toBe(6)
    expect(layout('漢字漢字 漢字', 8).map(row => row.map(run => run.text).join(''))).toEqual(['漢字漢字', '漢字'])
  })

  test('a closer after a code fence goes on a line of its own, however far the fence is indented', async () => {
    for (const indent of ['', '   ', '    ', '\t']) {
      const rows = layout(closeAfter(`text\n${indent}\`\`\`\ncode\n${indent}\`\`\``, link('close', 'k', '«'), '\n'), 40)
      expect(linkAt(rows, 0, rows.length - 1)).toEqual({ action: 'close', key: 'k' })
      expect(rows.at(-1)?.some(run => run.code === true)).toBe(false)
    }
  })

  test('counts an emoji as two cells and a flag as two in all, so a press after them lands on the right phrase', async () => {
    expect(widthOf('🚀🚗')).toBe(4)
    expect(widthOf('🇯🇵')).toBe(2)
    const rows = layout(`a 🚀 ${link('open', 'k', 'open')} end`, 60)
    expect(linkAt(rows, 8, 0)).toEqual({ action: 'open', key: 'k' })
    expect(linkAt(rows, 4, 0)).toBeUndefined()
  })

  test('a line starting with a fence marker and more text does not close the block, and the lines after it are drawn as code', async () => {
    const text = ['```', '```python is a content line', 'still code', '```', 'after'].join('\n')
    expect(layout(text, 40).map(row => row.map(run => [run.text, run.code === true]))).toEqual([
      [['  ```python is a content line', true]],
      [['  still code', true]],
      [['after', false]],
    ])
  })
})

describe('paragraphs', () => {
  test('cuts at blank lines outside stretches and fences, and keeps plain neighbours together', async () => {
    const text = ['Plain one.', '', 'Plain two.', '', 'With {{a|a long', '', 'form}}.', '', '```', '', '```', 'After.'].join('\n')
    expect(paragraphsOf(text)).toEqual([
      { text: 'Plain one.\n\nPlain two.', hasStretch: false },
      { text: 'With {{a|a long\n\nform}}.', hasStretch: true },
      { text: '```\n\n```\nAfter.', hasStretch: false },
    ])
  })

  test('a code span over several lines ends at its closing backtick, so a stretch after it keeps its blank line inside', async () => {
    const text = ['Use `foo', 'bar` and {{a|long', '', 'form}}.'].join('\n')
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: true }])
  })

  test('a line starting with a fence marker and more text does not close the block', async () => {
    const text = ['```', '```python', '', '{{a|b}}', '```', 'After.'].join('\n')
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: false }])
  })
})

test('marks dim draws a pressable phrase dim instead of underlined', { options: { marks: 'dim' } }, async $ => {
  const ui = await mountReply($, FULLSCREEN)
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  expect(pieces.find(piece => piece.text === 'on a stale cache')?.props).toMatchObject({ dimColor: true })
  expect(pieces.find(piece => piece.text === 'on a stale cache')?.props).not.toHaveProperty('underline')
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
  await ui.unmount()
})

test('marks none leaves a pressable phrase unmarked but still pressable', { options: { marks: 'none' } }, async $ => {
  const ui = await mountReply($, FULLSCREEN)
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  const phrase = pieces.find(piece => piece.text === 'on a stale cache')?.props
  expect(phrase).not.toHaveProperty('underline')
  expect(phrase).not.toHaveProperty('dimColor')
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
  await ui.unmount()
})

test('a press grows a stretch in place, nested ones too, and « shrinks it back', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
  expect(await textIn(ui, 'paragraph-1')).toBe('The fix is one line.')
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('⏺')
  // A pressable phrase is underlined; code beside it is not.
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  expect(pieces.find(piece => piece.text === 'on a stale cache')?.props).toMatchObject({ underline: true })
  expect(pieces.find(piece => piece.text === '{{a|b}}')?.props).toMatchObject({ color: 'permission' })
  expect(pieces.find(piece => piece.text === '{{a|b}}')?.props).not.toHaveProperty('underline')

  await pressOn(ui, 'on a stale cache')
  // The first frames show the short form's words, not the whole long form.
  expect(await textIn(ui)).not.toContain('hashes only')
  await ui.advance(300)
  expect(await textIn(ui)).not.toContain('because the cache key hashes only package.json')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain('because the cache key hashes only package.json, set in one file «.')

  await pressOn(ui, ', set in one file')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain(', set in ci/cache.ts « «.')

  await pressOn(ui, '«', { last: true })
  await ui.advance(300)
  expect(await textIn(ui)).not.toContain('«')
  expect(await textIn(ui)).not.toContain('on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')

  // Shrinking the outer stretch closed the one inside it too.
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain(', set in one file «.')
  await ui.unmount()
})

describe('selecting text', () => {
  /** Drags the left button from `from` to `to` in the paragraph, as a mouse does: down, a move, up. */
  const drag = async (ui: Mounted, from: { x: number; y: number }, to: { x: number; y: number }, key = FIRST) => {
    await ui.pointer({ type: 'down', ...from, button: 'left', in: key })
    await ui.pointer({ type: 'move', ...to, button: 'left', in: key })
    await ui.pointer({ type: 'up', ...to, button: 'left', in: key })
  }
  /** What reaches the clipboard. */
  const clipboard = (on: On) => {
    const copies: string[] = []
    on('ui.copy', (_, e) => {
      copies.push(e.text)
      return { value: { isCopied: true } }
    })
    return copies
  }

  test('a drag across a paragraph that holds a stretch copies the text it crossed, drawn inverse', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    // "The build fails on a stale cache." then "Braces in code stay: {{a|b}}."
    await drag(ui, { x: 4, y: 0 }, { x: 5, y: 1 })
    expect(copies).toEqual(['build fails on a stale cache.\nBraces'])
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'build fails ')?.props).toMatchObject({ inverse: true })
    expect(pieces.find(piece => piece.text === 'The ')?.props).not.toHaveProperty('inverse')
    // Nothing opened.
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a drag backwards selects from where it came up to where it went down', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 14, y: 0 }, { x: 4, y: 0 })
    expect(copies).toEqual(['build fails'])
    await ui.unmount()
  })

  test('a line wrapped over several rows is copied as one line', async ($, on) => {
    const copies = clipboard(on)
    const text = '- A list item {{long enough|long enough}} that it wraps onto a second row here.'
    const ui = await mountReply($, { columns: 30, rows: 40, isFullscreen: true }, text)
    const rows = (await rowsOf(ui)).map(row => row.trimEnd())
    expect(rows.length).toBeGreaterThan(1)
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: rows.length - 1 })
    expect(copies).toEqual(['- A list item long enough that it wraps onto a second row here.'])
    await ui.unmount()
  })

  test('a URL in a paragraph that holds a stretch is drawn as a hyperlink', async $ => {
    const ui = await mountReply($, FULLSCREEN, 'Docs at https://x.invalid/docs and {{a stretch|a long stretch}}.')
    const link = await ui.find({ type: 'Link', in: FIRST })
    expect(link?.props).toMatchObject({ href: 'https://x.invalid/docs' })
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a stretch.')
    await ui.unmount()
  })

  test('a click copies nothing, takes the highlight down, and on a short form still opens it', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 4, y: 0 }, { x: 9, y: 0 })
    await drag(ui, { x: 1, y: 1 }, { x: 1, y: 1 })
    expect(copies).toEqual(['build'])
    expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.inverse === true)).toBe(false)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    expect(copies).toEqual(['build'])
    await ui.unmount()
  })

  test('a drag released off the paragraph, past any edge, still copies and leaves no highlight behind', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const off of [{ x: 4, y: 30 }, { x: 4, y: -2 }, { x: -3, y: 1 }, { x: 150, y: 1 }]) {
      await drag(ui, { x: 4, y: 0 }, off)
      expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.inverse === true)).toBe(false)
    }
    expect(copies).toEqual([
      'build fails on a stale cache.\nBraces in code stay: {{a|b}}.',
      'The b',
      'build fails on a stale cache.\nB',
      'build fails on a stale cache.\nBraces in code stay: {{a|b}}.',
    ])
    await ui.unmount()
  })
})

test('a paragraph drawn with props from the version before, which had no ask or letters, still draws', () => {
  // What a first draw reads of its surface; Reply is called directly, as no mount hands it chosen props.
  const surface = {
    elements: { Box: 'Box', Text: 'Text' },
    state: undefined as unknown,
    setState(next: unknown) {
      surface.state = next
    },
    onPointer() {},
    every() {},
  }
  const drawn = Reply({ text: 'The build fails {{on a stale cache|because the key is stale}}.', open: [], tints: {} } as never, surface as never)
  expect(JSON.stringify(drawn)).toContain('on a stale cache')
})

test('a click inside a stretch shrinking shut opens nothing', async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: REPLY, toolUses: [] }] }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })
  const ui = await mountReply($, FULLSCREEN)
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  await pressOn(ui, '«')
  await ui.advance(100)
  await pressOn(ui, ', set in one file')
  await ui.advance(2000)
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
  ])
  await ui.unmount()
})

test('a paragraph whose last row ends in a stretch ends in one plain cell, and one ending in text does not', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect((await rowsOf(ui, 'paragraph-1')).at(-1)).toBe('The fix is one line. ')
  const pieces = await ui.findAll({ type: 'Text', in: 'paragraph-1' })
  expect(pieces.at(-1)?.text).toBe(' ')
  expect(pieces.at(-1)?.props).not.toHaveProperty('underline')
  expect((await rowsOf(ui)).at(-1)).toBe('Braces in code stay: {{a|b}}.')
  await ui.unmount()
})

test('what the reader opened survives the reply being drawn again', async $ => {
  const first = await mountReply($, FULLSCREEN)
  await pressOn(first, 'The fix is one line.', { key: 'paragraph-1' })
  await first.advance(2000)
  await first.unmount()

  const again = await mountReply($, FULLSCREEN)
  expect(await textIn(again, 'paragraph-1')).toContain('Add the lockfile to the key:')
  expect(await textIn(again, 'paragraph-1')).toContain('  key: {{hash}}')
  expect(await textIn(again)).toContain('on a stale cache.')
  await again.unmount()
})

test('in the terminal, a « after a rule or a code fence goes on its own line and stays pressable', async $ => {
  const text = ['{{Status.|---', '', '- [x] Done', '', '---}}', '', 'Then {{the fix|the fix:', '```', 'key: 1', '```', '}}'].join('\n')
  const ui = await mountReply($, FULLSCREEN, text)
  await pressOn(ui, 'Status.')
  await pressOn(ui, 'the fix', { key: 'paragraph-1' })
  await ui.advance(2000)
  const rows = await rowsOf(ui)
  expect(rows.at(-2)).toMatch(/^─+$/)
  expect(rows.at(-1)?.trimEnd()).toBe('«')
  expect((await rowsOf(ui, 'paragraph-1')).slice(-2).map(row => row.trimEnd())).toEqual(['  key: 1', '«'])
  await pressOn(ui, '«', { last: true })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('Status.')
  await ui.unmount()
})

test('the words a stretch adds take its colour, faded once another opens or the reader writes again', async ($, on) => {
  const text = 'One {{cat|cat, black,}} and {{dog|dog, brown,}} here.'
  on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const ui = await mountReply($, FULLSCREEN, text)
  const colourOf = async (text: string) => (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text?.trim() === text)?.props.color
  await pressOn(ui, 'cat')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('One cat, black, « and dog here.')
  expect(await colourOf('black,')).toBe('#ffdd77')
  expect(await colourOf('cat,')).toBeUndefined()

  await pressOn(ui, 'dog')
  await ui.advance(2000)
  expect(await colourOf('brown,')).toBe('#d3bdff')
  expect(await colourOf('black,')).toBe('#a6904d')
  // A closer keeps its stretch's unfaded colour, as a faded one reads as disabled.
  const closers = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.text === '«')
  expect(closers.map(piece => piece.props.color)).toEqual(['#ffdd77', '#d3bdff'])

  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(await colourOf('brown,')).toBe('#897ba6')
  await ui.unmount()
})

test('a short form written over several lines is drawn open in the terminal too', async $ => {
  const ui = await mountReply($, FULLSCREEN, ['Two steps: {{- one', '- two|- one, first', '- two, second}}'].join('\n'))
  expect(await textIn(ui)).toBe('Two steps: - one, first\n- two, second')
  await ui.unmount()
})

test('on the main screen, every stretch is drawn open, and the first such reply says why', async $ => {
  const ui = await mountReply($, MAIN_SCREEN)
  expect(await shown(ui)).toContain(', set in `ci/cache.ts`')
  expect(await shown(ui)).toContain('key: {{hash}}')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await hasNote(ui)).toBe(true)
  await ui.unmount()

  const later = await mountReply($, MAIN_SCREEN, REPLY, 'terminal', 'reply-2')
  expect(await hasNote(later)).toBe(false)
  await later.unmount()
  // Drawn again, the first reply keeps it.
  const again = await mountReply($, MAIN_SCREEN)
  expect(await hasNote(again)).toBe(true)
  await again.unmount()
})

test('in fullscreen or the phone app, no reply says why stretches are open', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect(await hasNote(ui)).toBe(false)
  await ui.unmount()
  // The phone app also reports it is not fullscreen, and has no /tui to run.
  const phone = await $.ui.mount({
    plugin: 'cc-stretch',
    surface: 'mobile',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    requestId: 'reply-1',
    viewport: MAIN_SCREEN,
  })
  expect((await phone.findAll({ type: 'Text' })).some(piece => piece.text?.includes('NO_FLICKER') === true)).toBe(false)
  await phone.unmount()
})

describe('desktop app', () => {
  // A link names its stretch by its place among the reply's stretches.
  const linkTo = (action: 'open' | 'close', key: string, text = REPLY) =>
    `${HREF}${action}/${stretches(parse(text)).findIndex(stretch => stretch.key === key)}`
  const OUTER = 'on a stale cache'
  const INNER = `${OUTER} › , set in one file`

  test('a stretch is a link that grows in place, and « shrinks it with what it holds', async $ => {
    const ui = await mountReply($, FULLSCREEN, REPLY, 'desktop')
    const press = (action: 'open' | 'close', key: string) => ui.press({ key: 'stretch', link: { href: linkTo(action, key) } })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await shown(ui)).toContain(`The build fails [on a stale cache](${linkTo('open', OUTER)}).`)
    expect(await shown(ui)).not.toContain('`package.json`')

    await press('open', OUTER)
    expect(await shown(ui)).toContain(
      `The build fails because the cache key hashes only \`package.json\`[, set in one file](${linkTo('open', INNER)}) [«](${linkTo('close', OUTER)}).`,
    )
    await press('open', INNER)
    expect(await shown(ui)).toContain(', set in `ci/cache.ts`')

    await press('close', OUTER)
    expect(await shown(ui)).toContain(`The build fails [on a stale cache](${linkTo('open', OUTER)}).`)
    await press('open', OUTER)
    expect(await shown(ui)).not.toContain('ci/cache.ts')
    // Code keeps its braces, and a stretch holding a fence opens to it whole.
    expect(await shown(ui)).toContain('Braces in code stay: `{{a|b}}`.')
    await press('open', 'The fix is one line.')
    expect(await shown(ui)).toContain('key: {{hash}}')
    await ui.unmount()
  })

  test('a short form written over several lines is drawn open, as a link cannot span them', async $ => {
    const list = ['{{- Admin: https://admin.example.com', '- `example.com` is a test address.|}}'].join('\n')
    const listed = ['{{- one', '- two|- one, first', '- two, second}}'].join('\n')
    const ui = await mountReply($, FULLSCREEN, `${list}\n\n${listed}`, 'desktop')
    expect(await shown(ui)).toBe(['- Admin: https://admin.example.com', '- `example.com` is a test address.', '', '- one, first', '- two, second'].join('\n'))
    await ui.unmount()
  })

  test('a short form with brackets, a link, code or hundreds of characters still opens', async $ => {
    const long = '缓存'.repeat(150)
    const text = [
      'Steps: {{1) install|1) install the plugin}}.',
      'Cause: {{`arr[0]` is empty|`arr[0]` is empty when the list is}}.',
      'Read {{the [guide](https://example.com/g)|the [guide](https://example.com/g), part two}}.',
      `Note: {{${long}|${long}, and more}}.`,
    ].join('\n\n')
    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    const drawn = await shown(ui)
    expect(drawn).toContain(`[1) install](${linkTo('open', '1) install', text)})`)
    expect(drawn).toContain(`[\`arr[0]\` is empty](${linkTo('open', '`arr[0]` is empty', text)})`)
    expect(drawn).toContain(`[the guide (https://example.com/g)](${linkTo('open', 'the [guide](https://example.com/g)', text)})`)
    for (const key of ['1) install', '`arr[0]` is empty', long]) {
      await ui.press({ key: 'stretch', link: { href: linkTo('open', key, text) } })
    }
    expect(await shown(ui)).toContain('1) install the plugin [«]')
    expect(await shown(ui)).toContain('`arr[0]` is empty when the list is [«]')
    expect(await shown(ui)).toContain(`${long}, and more [«]`)
    await ui.unmount()
  })

  test('a « after a rule or a code fence goes on its own line', async $ => {
    const text = ['{{Status.|---', '', '- [x] Done', '', '---}}', '', 'Then {{the fix|the fix:', '```', 'key: {{hash}}', '```', '}}'].join('\n')
    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'Status.', text) } })
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'the fix', text) } })
    expect(await shown(ui)).toContain(`- [x] Done\n\n---\n\n[«](${linkTo('close', 'Status.', text)})`)
    expect(await shown(ui)).toContain(`key: {{hash}}\n\`\`\`\n\n[«](${linkTo('close', 'the fix', text)})`)
    await ui.unmount()
  })

  test('a short form over several lines is neither opened nor unopened in the next note', async ($, on) => {
    const text = ['Two steps: {{- one', '- two|- one, first', '- two, second}}', '', 'Then {{a stretch|a stretch, longer}}.'].join('\n')
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'how?', toolUses: [] },
        { role: 'assistant', text, toolUses: [] },
      ],
    }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })

    const ui = await mountReply($, FULLSCREEN, text, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', 'a stretch', text) } })
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual(['Stretchtext: since your last reply the reader opened "a stretch".'])
    await ui.unmount()
  })

  test('what the reader opened is told to the model with the next prompt', async ($, on) => {
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'why does CI fail?', toolUses: [] },
        { role: 'assistant', text: REPLY, toolUses: [] },
      ],
    }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })

    const ui = await mountReply($, FULLSCREEN, REPLY, 'desktop')
    await ui.press({ key: 'stretch', link: { href: linkTo('open', OUTER) } })
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual([
      'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
    ])
    await ui.unmount()
  })

  for (const surfaces of [['desktop'], ['terminal', 'desktop']] satisfies RenderSurface[][]) {
    test(`a reply streaming with ${surfaces.join(' and ')} attached keeps its markup, which the desktop's links are made from`, async ($, on) => {
      on('classic.MessageDisplay', () => ({}))
      on('session.surfaces', () => ({ value: surfaces }))
      const flush = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'm', index: 0, final: true, delta: 'A monad is {{a wrapper|a wrapper.}}' })
      expect(flush.displayContent).toBeUndefined()
    })
  }
})

test('a reply without a stretch is drawn by the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mountReply($, FULLSCREEN, 'Plain answer.')
  expect(await ui.find({ text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('paragraphs without a stretch stay with Claude Code\'s own markdown', async $ => {
  const ui = await mountReply($, FULLSCREEN, ['Intro with `code`.', '', 'Then {{a stretch|a stretch, longer}}.'].join('\n'))
  expect(await shown(ui)).toBe('Intro with `code`.')
  expect(await textIn(ui, 'paragraph-1')).toBe('Then a stretch.')
  await ui.unmount()
})

test('a stretch still streaming shows its short form and none of its markup', async $ => {
  const ui = await mountReply($, FULLSCREEN, 'Still streaming {{a stretch|its long form so f')
  expect(await textIn(ui)).toBe('Still streaming a stretch')
  await ui.unmount()
})

test('the system prompt carries the guide while something draws', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  const drawn = await $.prompt.compose({ ...COMPOSE, surfaces: ['terminal'] })
  expect(drawn.sections.at(-1)?.id).toBe('cc-stretch:guide')
  const headless = await $.prompt.compose({ ...COMPOSE, surfaces: [] })
  expect(headless.sections.some(s => s.id === 'cc-stretch:guide')).toBe(false)
})

test('the next prompt tells the model which stretches were opened and which not', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'why does CI fail?', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })

  const ui = await mountReply($, FULLSCREEN)
  await pressOn(ui, 'on a stale cache')
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
  ])

  await $.prompt.submit({ text: 'and?', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: no click on a stretch of your last reply was recorded. The reader may have read only the short forms; where clicks do not reach the plugin (the classic renderer, apps other than the terminal and the Claude desktop app), every stretch was drawn open.',
  ])
  await ui.unmount()
})

describe('keyboard', () => {
  /** Presses the Button that alt+down (`down`) or alt+up (`up`) presses, to put up letters that open or close. */
  const down = (ui: Mounted) => ui.press({ key: 'open-letters' })
  const up = (ui: Mounted) => ui.press({ key: 'close-letters' })
  // The test engine raises prompt.edit and prompt.change as the prompt box does, but has no editor
  // beneath them (Claude Code 2.1.301): each test stands one in, and the session's messages, in the
  // order the replies were written.
  const engine = (on: On, replies = [REPLY]) => {
    on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.change', ($, e) => ({ text: e.text }))
    on('session.messages', () => ({ value: replies.map(text => ({ role: 'assistant', text, toolUses: [] }) satisfies SessionMessage) }))
  }
  /** Raises `prompt.<name>` on the test engine's `$.prompt`, whose types leave it out (Claude Code 2.1.301). */
  const raise = async ($: Engine, name: 'edit' | 'change', input: PromptEditInput | PromptChangeInput): Promise<unknown> => {
    const hook: unknown = Reflect.get($.prompt, name)
    if (typeof hook !== 'function') throw new Error(`the test engine has no $.prompt.${name}`)
    return hook.call($.prompt, input)
  }
  /** One key typed at an empty prompt, and the prompt it leaves. */
  const type = async ($: Engine, key: string) => {
    const box = await raise($, 'edit', { origin: { kind: 'composer' }, key: { key }, text: '', cursor: 0, start: 0, end: 0, inputText: key })
    if (typeof box !== 'object' || box === null || !('text' in box) || typeof box.text !== 'string') throw new Error('prompt.edit left no text')
    return box.text
  }
  /** The letters drawn over the stretches of one paragraph. */
  const letters = async (ui: Mounted, key = FIRST) =>
    (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.backgroundColor === 'error').map(piece => piece.text)
  const both = async (ui: Mounted) => [...(await letters(ui)), ...(await letters(ui, 'paragraph-1'))]

  test('the open-letters Button draws a letter over each closed stretch, and typing it opens the stretch in place', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    // The letter covers the short form's first character, so nothing on screen moves.
    expect(await textIn(ui)).toContain('The build fails an a stale cache.')

    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only')
    // Again, the stretch now drawn inside the opened one takes a letter.
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    expect(await textIn(ui)).toContain('a set in one file')
    await ui.unmount()
  })

  test('with no style set, a short form under letters stays underlined', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    const lettered = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => ['error', 'permission'].includes(String(piece.props.backgroundColor)))
    expect(lettered.map(piece => piece.text)).toEqual(['a', 'n a stale cache'])
    for (const piece of lettered) expect(piece.props).toMatchObject({ underline: true })
    await ui.unmount()
  })

  test('the close-letters Button draws a letter over the « of each open stretch, and typing it closes the stretch', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await up(ui)
    // With nothing open there is nothing to close, so no letters show and the key is typed.
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')

    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    expect(await textIn(ui)).not.toContain('«')
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('The build fails on a stale cache.')
    await ui.unmount()
  })

  test('another key, or a letter no stretch has, puts the letters away and is typed as usual', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const key of ['1', 'z', 'A']) {
      await down(ui)
      expect(await type($, key)).toBe(key)
      expect(await both(ui)).toEqual([])
    }
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('each Button names the keybinding action whose chords press it', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    expect((await ui.find({ key: 'open-letters' }))?.props.action).toBe('app:diffFileListDown')
    expect((await ui.find({ key: 'close-letters' }))?.props.action).toBe('app:diffFileListUp')
    await ui.unmount()
  })

  test('the same chord again puts the letters away, and the other one swaps them', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await down(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')

    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    await ui.unmount()
  })

  test('a letter drawn nowhere acts on nothing: the « of a stretch still growing open', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    // The hooks count the stretch open as the press lands, so it takes a letter to close it, which
    // no « shows until it has grown.
    await up(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only')
    await ui.unmount()
  })

  test('a stretch with an empty short form, which draws no link, opens from no letter', async ($, on) => {
    const text = 'Before {{|hidden words}} after {{shown|more}}.'
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toEqual(['s'])
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).not.toContain('hidden words')
    await ui.unmount()
  })

  test('a recalled prompt puts the letters away', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await raise($, 'change', { text: 'an earlier prompt', cursor: 17, origin: { kind: 'history' } })
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('a letter put up before the stretch around it closed opens nothing', async ($, on) => {
    engine(on)
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    // Letter a goes to the stretch inside the open one; a click then closes the open one.
    await down(ui)
    await pressOn(ui, '«')
    await ui.advance(2000)
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual([
      'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
    ])
    await ui.unmount()
  })

  test('past the 26th stretch none takes a letter, one keyed constructor among them', async ($, on) => {
    // The 27th is keyed `constructor`, a name every plain object answers to.
    const text = `${Array.from({ length: 26 }, (_, i) => `{{w${i}|more ${i}}}`).join(' ')} {{constructor|more}}`
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toHaveLength(26)
    expect(await textIn(ui)).toContain('constructor')
    await ui.unmount()
  })

  test('a letter on a stretch inside one shrinking shut opens nothing', async ($, on) => {
    engine(on)
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await up(ui)
    expect(await type($, 'a')).toBe('')
    await ui.advance(100)
    // Until the shrink ends the hooks count the stretch as open, so letter a goes to the one inside it,
    // which the paragraph then refuses.
    await down(ui)
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual([
      'Stretchtext: since your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
    ])
    await ui.unmount()
  })

  test('the three newest replies on screen holding a stretch take letters, newest first, whatever order they were drawn in', async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2), reply(3), reply(4), 'Reply 5 has no stretch.'])
    // Drawn out of order, as scrolling back up draws an older reply for the first time in Claude Code
    // 2.1.301. Reply 5, the newest, holds no stretch, so Claude Code draws it and it takes no letters.
    const mounted = new Map<number, Mounted>()
    for (const n of [4, 2, 1, 3]) mounted.set(n, await mountReply($, FULLSCREEN, reply(n), 'terminal', `reply-${n}`))
    const of = (n: number) => {
      const ui = mounted.get(n)
      if (ui === undefined) throw new Error(`reply ${n} is not mounted`)
      return ui
    }
    await down(of(4))
    expect(await letters(of(4))).toEqual(['a'])
    expect(await letters(of(3))).toEqual(['s'])
    expect(await letters(of(2))).toEqual(['d'])
    expect(await letters(of(1))).toEqual([])
    for (const ui of mounted.values()) await ui.unmount()
  })

  test('a reply scrolled off screen takes no letters', async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2)])
    const older = await mountReply($, FULLSCREEN, reply(1), 'terminal', 'reply-1')
    const newer = await mountReply($, FULLSCREEN, reply(2), 'terminal', 'reply-2')
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: null })
    await down(older)
    expect(await letters(newer)).toEqual([])
    expect(await letters(older)).toEqual(['a'])
    await type($, '1')

    // Scrolled back into view, it is the newest reply on screen again.
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } })
    await down(older)
    expect(await letters(newer)).toEqual(['a'])
    expect(await letters(older)).toEqual(['s'])
    await older.unmount()
    await newer.unmount()
  })
})

describe('tool calls', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const mountGroup = ($: Engine, isExpanded: boolean) =>
    $.ui.mount({
      plugin: 'cc-stretch',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [call], isActive: false, isExpanded },
      requestId: 'group-1',
      viewport: FULLSCREEN,
    })
  const engineDraws = (on: On) =>
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'Ran 1 shell command'}</Text>
    })

  // Claude Code folds a finished group to its one-line summary and opens it on a click on that line.
  // A group the plugin redrew kept its own state, so that click drew the open group's panel behind
  // the folded line and opened nothing.
  test('a group of tool calls is drawn as Claude Code draws it', async ($, on) => {
    engineDraws(on)
    for (const isExpanded of [false, true]) {
      const ui = await mountGroup($, isExpanded)
      expect(await ui.find({ text: isExpanded ? 'every call' : 'Ran 1 shell command' })).toBeDefined()
      expect(await ui.find({ key: 'tools' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

/** The props of the first pressable phrase of the first paragraph. */
const phraseProps = async (ui: Mounted) => (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === 'on a stale cache')?.props

describe('style', () => {
  test('with no options, a pressable phrase is underlined and nothing else', async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ underline: true })
    for (const prop of ['bold', 'italic', 'color', 'backgroundColor', 'dimColor', 'inverse', 'strikethrough']) expect(phrase).not.toHaveProperty(prop)
    await ui.unmount()
  })

  test('a highlight alone keeps the default underline, its text turned light on a deep colour', { options: { highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ underline: true, backgroundColor: '#264f78', color: '#f2f2f2' })
    await ui.unmount()
  })

  test('a light highlight from the settings turns the phrase text dark', { options: { highlight: '#ffd75f' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ backgroundColor: '#ffd75f', color: '#1c1c1c' })
    await ui.unmount()
  })

  test('marks other than dim combine with a highlight', { options: { marks: 'italic,strikethrough', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ italic: true, strikethrough: true, backgroundColor: '#264f78' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
  })

  test('marks none leaves a highlighted phrase only its highlight', { options: { marks: 'none', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ backgroundColor: '#264f78', color: '#f2f2f2' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
  })

  test('a highlight wins over dim, so the text keeps the colour chosen to read on it', { options: { marks: 'dim', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ backgroundColor: '#264f78', color: '#f2f2f2' })
    expect(phrase).not.toHaveProperty('dimColor')
    await ui.unmount()
  })

  test('an opened stretch keeps its tint under a style with dim and a highlight', { options: { marks: 'bold,dim', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    const closer = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === '«')?.props
    expect(closer?.color).toMatch(/^#/)
    expect(closer).not.toHaveProperty('backgroundColor')
    expect(closer).not.toHaveProperty('dimColor')
    expect(closer).toMatchObject({ bold: true })
    await ui.unmount()
  })

  for (const highlight of ['#264f78', '']) {
    const name = highlight === '' ? 'stays dim with no highlight' : 'takes the highlight and its text colour, not dim'
    test(`the target written after a relative link in a short form ${name}`, { options: { highlight } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'Read {{the [guide](docs/guide.md)|the [guide](docs/guide.md) first}} now.')
      const target = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === ' (docs/guide.md)')?.props
      if (highlight === '') {
        expect(target).toMatchObject({ dimColor: true })
      } else {
        expect(target).toMatchObject({ backgroundColor: highlight, color: '#f2f2f2' })
        expect(target).not.toHaveProperty('dimColor')
      }
      await ui.unmount()
    })
  }

  test('lookOf reads marks in any case, with commas or spaces, in toolbar order', () => {
    expect(lookOf({ marks: 'Underline , BOLD' }).marks).toEqual(['bold', 'underline'])
    expect(lookOf({ marks: 'italic bold' }).marks).toEqual(['bold', 'italic'])
    expect(lookOf({ marks: ' NONE ', highlight: '#264f78' })).toEqual({ marks: [], highlight: '#264f78' })
    for (const typo of ['undrline', 'inverse', 42, ' ']) expect(lookOf({ marks: typo })).toEqual(DEFAULT_LOOK)
  })

  test('a style with no marks is saved as none, which reads back as no marks', () => {
    expect(marksSetting([])).toBe('none')
    expect(lookOf({ marks: marksSetting([]) }).marks).toEqual([])
    expect(lookOf({ marks: marksSetting(['bold', 'underline']) }).marks).toEqual(['bold', 'underline'])
  })

  test('under dim, a link inside a short form keeps its colour while the words around it dim', { options: { marks: 'dim' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'See {{the docs at https://x.invalid/d|the docs at https://x.invalid/d, with examples}} now.')
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    const url = pieces.find(piece => piece.text === 'https://x.invalid/d')?.props
    expect(url).toMatchObject({ color: 'suggestion', underline: true })
    expect(url).not.toHaveProperty('dimColor')
    expect(pieces.find(piece => piece.text === 'the docs at ')?.props).toMatchObject({ dimColor: true })
    await ui.unmount()
  })

  test('contrastOn picks the stronger of dark and light text, and leaves non-hex colours alone', () => {
    expect(contrastOn('#ffd75f')).toEqual({ color: '#1c1c1c' })
    expect(contrastOn('#264f78')).toEqual({ color: '#f2f2f2' })
    expect(contrastOn('#fff')).toEqual({ color: '#1c1c1c' })
    expect(contrastOn('#808080')).toEqual({ color: '#1c1c1c' })
    for (const colour of ['suggestion', '', '#GGGGGG', 'rgb(0,0,0)']) expect(contrastOn(colour)).toEqual({})
  })
})

describe('the style toolbar', () => {
  /** A session with the terminal attached, where the toolbar is drawn. */
  const terminal = (on: On) => on('session.surfaces', () => ({ value: ['terminal'] }))
  /** /cc-stretch:style typed at the prompt, in fullscreen or on the main screen. */
  const runStyle = ($: Engine, isFullscreen = true) =>
    $.command.run({ command: 'cc-stretch:style', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 100 } })
  const mountToolbar = ($: Engine) =>
    $.ui.mount({
      plugin: 'cc-stretch',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
      viewport: FULLSCREEN,
    })
  const showToolbar = async ($: Engine) => ({ answer: await runStyle($), toolbar: await mountToolbar($) })
  const keysOf = async (toolbar: Awaited<ReturnType<typeof mountToolbar>>) => (await toolbar.findAll({ type: 'Button' })).map(button => String(button.key))
  /** What the toolbar writes to the settings, each write answered as made. */
  const recordWrites = (on: On) => {
    const written: [string, unknown][] = []
    on('config.set', (_, e) => {
      written.push([e.key, e.value])
      return { value: e.value }
    })
    return written
  }
  /** What the toolbar toasts. */
  const toasts = (on: On) => {
    const said: string[] = []
    on('ui.toast', (_, e) => {
      said.push(e.text)
      return { value: undefined }
    })
    return said
  }

  test('/cc-stretch:style shows the toolbar, and running it again leaves it shown', async ($, on) => {
    terminal(on)
    const { answer, toolbar } = await showToolbar($)
    expect(answer.text).toContain('shown')
    await runStyle($)
    expect((await keysOf(toolbar)).length).toBeGreaterThan(0)
    await toolbar.unmount()
  })

  test('on the main screen the command says why, and shows no toolbar', async ($, on) => {
    terminal(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const answer = await runStyle($, false)
    expect(answer.text).toContain('run /tui fullscreen')
    expect(answer.text).toContain('CLAUDE_CODE_NO_FLICKER=1')
    const toolbar = await mountToolbar($)
    expect(await keysOf(toolbar)).toEqual([])
    await toolbar.unmount()
  })

  test('with no terminal attached the command says the toolbar is drawn there, and shows none', async ($, on) => {
    on('session.surfaces', () => ({ value: ['desktop'] }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const answer = await runStyle($)
    expect(answer.text).toContain('drawn in the terminal')
    const toolbar = await mountToolbar($)
    expect(await keysOf(toolbar)).toEqual([])
    await toolbar.unmount()
  })

  test('a stored try with no highlight is no try, so there is nothing to reset or save', async ($, on) => {
    terminal(on)
    on('state.get', (_, e, next) => (e.plugin === 'cc-stretch' && e.key === 'look' ? { value: { value: { marks: ['bold'] }, version: 0 } } : next(e)))
    const { toolbar } = await showToolbar($)
    const keys = await keysOf(toolbar)
    expect(keys).not.toContain('save')
    expect(keys).not.toContain('reset')
    await toolbar.unmount()
  })

  test('the toolbar offers five marks and deep highlights, and no text colour', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    const keys = await keysOf(toolbar)
    expect(keys.filter(key => key.startsWith('mark-'))).toEqual(['mark-bold', 'mark-italic', 'mark-underline', 'mark-strikethrough', 'mark-dim'])
    expect(keys.filter(key => key.startsWith('highlight-#'))).toHaveLength(9)
    expect(keys.some(key => key.startsWith('text-'))).toBe(false)
    await toolbar.unmount()
  })

  test('the toolbar restyles replies live', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-underline' })
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'highlight-#5c4a00' })
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ bold: true, backgroundColor: '#5c4a00', color: '#f2f2f2' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
    await toolbar.unmount()
  })

  test('reset and save show only while a try differs from the saved style', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.press({ key: 'mark-bold' })
    expect(await keysOf(toolbar)).toEqual(expect.arrayContaining(['reset', 'save']))
    await toolbar.press({ key: 'mark-bold' })
    expect(await keysOf(toolbar)).not.toContain('reset')
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('reset returns to the saved style', { options: { marks: 'dim' } }, async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-italic' })
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ italic: true, dimColor: true })
    await toolbar.press({ key: 'reset' })
    const again = await mountReply($, FULLSCREEN, REPLY, 'terminal', 'reply-2')
    const phrase = await phraseProps(again)
    expect(phrase).toMatchObject({ dimColor: true })
    expect(phrase).not.toHaveProperty('italic')
    await again.unmount()
    await ui.unmount()
    await toolbar.unmount()
  })

  test('save writes the marks and the highlight when both changed, none for no marks', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-underline' })
    await toolbar.press({ key: 'highlight-#264f78' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.marks', 'none'], ['cc-stretch.highlight', '#264f78']])
    // The try is gone once saved; what shows is the style the settings now hold.
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('a refused save keeps the try and says why', async ($, on) => {
    terminal(on)
    on('config.set', () => ({ deny: 'a managed setting owns it' }))
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'save' })
    expect(said).toEqual(['cc-stretch: the style was not saved: a managed setting owns it'])
    expect(await keysOf(toolbar)).toContain('save')
    await toolbar.unmount()
  })

  /** A settings writer that holds each write until `release`, saying when one is held. */
  const heldWrites = (on: On) => {
    const written: [string, unknown][] = []
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    let entered: () => void = () => {}
    const held = new Promise<void>(resolve => (entered = resolve))
    on('config.set', async (_, e) => {
      entered()
      await gate
      written.push([e.key, e.value])
      return { value: e.value }
    })
    return { written, held, release: () => release() }
  }

  test('while a save is under way the toolbar offers nothing to press, close included', async ($, on) => {
    terminal(on)
    const writes = heldWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    const saving = toolbar.press({ key: 'save' })
    await writes.held
    expect(await keysOf(toolbar)).toEqual([])
    writes.release()
    await saving
    expect(await keysOf(toolbar)).toContain('close')
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('a mark pressed together with save is saved or kept as the try, never lost', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await Promise.all([toolbar.press({ key: 'mark-italic' }), toolbar.press({ key: 'save' })])
    const savedItalic = written.some(([key, value]) => key === 'cc-stretch.marks' && String(value).includes('italic'))
    expect(savedItalic || (await keysOf(toolbar)).includes('save')).toBe(true)
    await toolbar.unmount()
  })

  test('save writes only the settings that changed, and a later refusal names what was saved', async ($, on) => {
    terminal(on)
    const written: [string, unknown][] = []
    on('config.set', (_, e) => {
      if (e.key === 'cc-stretch.highlight' && written.length > 0) return { deny: 'a managed setting owns it' }
      written.push([e.key, e.value])
      return { value: e.value }
    })
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'highlight-#264f78' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.highlight', '#264f78']])
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'highlight-#1f3a5f' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.highlight', '#264f78'], ['cc-stretch.marks', 'bold,underline']])
    expect(said).toEqual(['cc-stretch: marks saved, highlight not saved: a managed setting owns it'])
    await toolbar.unmount()
  })

  test('close and save pressed together never say a style was dropped that then is saved', async ($, on) => {
    terminal(on)
    // As of Claude Code 2.1.302, what is drawn above the prompt once the toolbar steps aside.
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const written = recordWrites(on)
    const said = toasts(on)
    for (const order of [['close', 'save'], ['save', 'close']] as const) {
      written.length = 0
      said.length = 0
      await runStyle($)
      const toolbar = await mountToolbar($)
      await toolbar.press({ key: 'mark-bold' })
      await Promise.allSettled(order.map(key => toolbar.press({ key })))
      if (said.includes('cc-stretch: the style you tried was not saved')) expect(written).toEqual([])
      else expect(written).toEqual([['cc-stretch.marks', 'bold,underline']])
      await toolbar.unmount()
    }
  })

  test('a highlight saved in capitals is the chosen swatch, with nothing to reset or save', { options: { highlight: '#264F78' } }, async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    const chosen = (await toolbar.findAll({ type: 'Text' })).filter(piece => piece.text === '◆◆')
    expect(chosen.map(piece => piece.props.backgroundColor)).toEqual(['#264f78'])
    await toolbar.press({ key: 'highlight-#264f78' })
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('close puts the toolbar away and drops a try it did not save, saying so', async ($, on) => {
    terminal(on)
    // As of Claude Code 2.1.302, what is drawn above the prompt once the toolbar steps aside.
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'close' })
    expect(await keysOf(toolbar)).toEqual([])
    expect(said).toEqual(['cc-stretch: the style you tried was not saved'])
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).not.toHaveProperty('bold')
    await ui.unmount()
    await toolbar.unmount()
  })
})

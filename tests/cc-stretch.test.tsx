import type { On, PromptChangeInput, PromptEditInput, RenderSurface, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { grow } from '../hooks/grow'
import { contrastOn } from '../hooks/contrast'
import { GUIDE, takesTrialGuide } from '../hooks/guide'
import { DEFAULT_LOOK, lookOf, marksSetting } from '../hooks/look'
import { asArriving, hrefAt, layout, leadInOf, link, linkAt, namesOf, tint, widthOf, withLeadIns } from '../hooks/layout'
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
// The dark palette's colours for a closed stretch's tinted highlight, and for the words it adds once open, by place.
const DEEP = ['#403002', '#2c2240', '#122623', '#361e16'] as const
const SOFT = ['#ffdd77', '#d3bdff', '#9ac5c0', '#e9b4a3'] as const
/** The theme row of the settings menu, as `config.list` gives it, holding the setting `value`. */
const themeRow = (value: string) => ({ key: 'theme', label: 'Theme', kind: 'choice', value, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }) as const
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
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).join('\n')
/** The colour of each Text a paragraph's Client draws that reads `text`, spaces around it aside, in reading order. */
const coloursOf = async (ui: Mounted, text: string, key = FIRST) =>
  (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.text?.trim() === text).map(piece => piece.props.color)

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
/** What the plugin toasts. */
const toasts = (on: On) => {
  const said: string[] = []
  on('ui.toast', (_, e) => {
    said.push(e.text)
    return { value: undefined }
  })
  return said
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

  test('a closing fence that carries the braces of the stretches around it closes the block and them, so what follows shows short', async () => {
    const lines = ['{{Count first.|Count first.', '```bash', 'git push', '```}}', '', '## Risks', '{{a|{{b|x', '~~~', 'code', '~~~ }}}}', '{{Risks.|long}}']
    expect(hideLongForms(lines.join('\n'), newStreamState())).toBe(['Count first.', '', '## Risks', 'a', 'Risks.'].join('\n'))
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

  describe('a long form ending in a code block', () => {
    const keys = (text: string) => stretches(parse(text)).map(s => [s.key, s.isClosed])

    test('closes at a closing fence followed by its braces, and what follows still parses', async () => {
      const text = ['{{Count first.|Count first.', '', '```bash', 'git push --force-with-lease', '```}}', '', '## Main risks', '', '{{Risks.|Risks, long.}}', '', '**Bottom line:** done.'].join('\n')
      const parts = parse(text)
      expect(keys(text)).toEqual([['Count first.', true], ['Risks.', true]])
      expect(parts[0]).toMatchObject({ long: ['Count first.\n\n```bash\ngit push --force-with-lease\n```'] })
      expect(parts.at(-1)).toBe('\n\n**Bottom line:** done.')
    })

    test('closes nested stretches at a fence followed by their braces, spaces allowed, with ~~~ fences too', async () => {
      expect(keys('{{a|{{b|x\n```\ncode\n```}}}}\nafter {{c|d}}')).toEqual([['a', true], ['a › b', true], ['c', true]])
      expect(keys('{{a|{{b|x\n~~~~\ncode\n~~~~ }} }}\nafter {{c|d}}')).toEqual([['a', true], ['a › b', true], ['c', true]])
    })

    test('does not close the block for a fence line with other text after it, or one outside every stretch', async () => {
      const [held] = parse('{{a|x\n```\n``` }} more\n```\n}} after')
      expect(held).toMatchObject({ isClosed: true, long: ['x\n```\n``` }} more\n```\n'] })
      expect(parse('```\ncode\n```}}\n{{a|b}}')).toEqual(['```\ncode\n```}}\n{{a|b}}'])
    })
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

  test('finds the hyperlink drawn at a cell, and none beside it', async () => {
    const rows = layout('See [the docs](https://x.invalid/d) or https://x.invalid/u now', 80)
    // "See the docs or https://x.invalid/u now"
    expect([hrefAt(rows, 4, 0), hrefAt(rows, 11, 0), hrefAt(rows, 16, 0), hrefAt(rows, 34, 0)]).toEqual(['https://x.invalid/d', 'https://x.invalid/d', 'https://x.invalid/u', 'https://x.invalid/u'])
    expect([hrefAt(rows, 3, 0), hrefAt(rows, 12, 0), hrefAt(rows, 35, 0), hrefAt(rows, 0, 1)]).toEqual([undefined, undefined, undefined, undefined])
  })

  test('finds the words a link with none of its own is pressed on, back to the start of their sentence', async () => {
    const leadIn = (text: string) => {
      const at = leadInOf(text)
      return at && text.slice(at.from, at.to)
    }
    expect(leadIn('It merged 3 days ago')).toBe('It merged 3 days ago')
    expect(leadIn('- **#212**: merged 3 days ago')).toBe('**#212**: merged 3 days ago')
    expect(leadIn('`npm test` exited 0')).toBe('`npm test` exited 0')
    expect(leadIn('3. **Stop the workers**')).toBe('**Stop the workers**')
    expect(leadIn('It failed. A test ')).toBe('A test')
    // A comma, a semicolon, a colon or a dash inside the sentence does not end the words.
    expect(leadIn('Retries wait 200, 400 and 800 ms')).toBe('Retries wait 200, 400 and 800 ms')
    expect(leadIn('It built; the tests: all passed')).toBe('It built; the tests: all passed')
    expect(leadIn('one, two — three four')).toBe('one, two — three four')
    expect(leadIn('测试通过，已合并')).toBe('测试通过，已合并')
    expect(leadIn('测试通过。已合并')).toBe('已合并')
    expect(leadIn('他说：“测试都通过了。”然后我们合并了')).toBe('然后我们合并了')
    expect(leadIn('测试通过了！）然后合并了')).toBe('然后合并了')
    // A bold phrase is taken whole, unless markup or a sentence's end is inside it.
    expect(leadIn('The **cache key** is stale')).toBe('The **cache key** is stale')
    expect(leadIn('See **[docs](https://x.y)** now')).toBe('now')
    expect(leadIn('So **it failed. Then it** passed')).toBe('passed')
    expect(leadIn('✅ Tests pass')).toBe('Tests pass')
    expect(leadIn('See [docs](https://x.y)')).toBeUndefined()
    expect(leadIn('Use `**` a b**')).toBeUndefined()
    expect(leadIn('- ')).toBeUndefined()
  })

  test('marks the lead-in words of a link with none of its own to open it, and leaves them where a mark would add a place to break', async () => {
    const marked = (text: string, isParagraphEnd = true) =>
      withLeadIns(parse(text), () => true, isParagraphEnd)
        .filter(part => typeof part === 'string')
        .join('|')
    expect(marked('It merged{{.|, and passed.}}')).toBe(link('leadIn', '.', 'It merged'))
    expect(marked('Before {{|hidden}} after')).toBe(`${link('leadIn', '', 'Before')} | after`)
    // An empty short form glued to a period: the period is marked too, so the words and it stay one piece.
    expect(marked('exited 0{{|, so no errors}}. Tests')).toBe(`${link('leadIn', '', 'exited 0')}|${link('leadIn', '', '.')} Tests`)
    expect(marked('exited 0{{|, so no errors}}word')).toBe('exited 0|word')
    expect(marked('exited 0{{|, so no errors}}', false)).toBe('exited 0')
    expect(marked('- {{.|item}}')).toBe('- ')
    expect(marked('-\td{{.|, and more}}')).toBe('-\td')
    // A code span closed on this line but opened on the line before reads as unclosed to `layout`.
    expect(marked('x ``a\nb`` c{{.|d}}')).toBe('x ``a\nb`` c')
    // A sentence that starts in another stretch lends only the words after it, apart from it by a space,
    // so the two links never draw as one; words glued to that stretch's text lend nothing.
    expect(marked('Run {{the tests|the unit tests}} then merge{{.|, after review.}}')).toBe(`Run | ${link('leadIn', '.', 'then merge')}`)
    expect(marked('Run {{the tests|the unit tests}}-merged{{.|, after review.}}')).toBe('Run |-merged')
    // Punctuation glued to an empty short form that runs on into the next stretch is joined to what that stretch draws.
    expect(marked('So the suite passed{{|, all 84}}.{{|, twice}}” Then it merged.')).toBe('So the suite passed|.|” Then it merged.')
  })

  test('names each stretch drawn as a link by its short form, and a wordless one with its lead-in words as drawn', async () => {
    const names = namesOf(parse('It merged{{.|, and passed.}} It is approved{{.|, but blocked.}} The check exited 0{{|, so no errors}}. {{Done.|Done in `ci.ts`.}}'))
    expect([...names.values()]).toEqual(['It merged.', 'It is approved.', 'The check exited 0.', 'Done.'])
    expect([...namesOf(parse('It merged {{.|, and passed.}}')).values()]).toEqual(['It merged .'])
  })

  test('draws the lead-in words of a link with none of its own as a run of their own, so rows break where they would without them', async () => {
    const text = (leadIn: string) => `so then it merged 3 days ${leadIn}${link('open', 'k', '.')} Then more words follow.`
    for (const width of [10, 13, 17, 21]) {
      const plain = layout(text('ago'), width)
      const pressed = layout(text(link('leadIn', 'k', 'ago')), width)
      expect(pressed.map(row => row.map(run => run.text).join(''))).toEqual(plain.map(row => row.map(run => run.text).join('')))
    }
    const rows = layout(`It ${link('leadIn', 'k', 'merged')}${link('open', 'k', '.')}`, 30)
    expect(linkAt(rows, 4, 0)).toEqual({ action: 'open', key: 'k', isLeadIn: true })
    expect(linkAt(rows, 9, 0)).toEqual({ action: 'open', key: 'k' })
  })

  test('never lets a code span or a markdown link run over a pressable phrase, as half of one drawn by a growing long form would', async () => {
    const shown = (text: string) => layout(text, 80).map(row => row.map(run => run.text).join('')).join('\n')
    expect(shown(`Run \`npm then ${link('open', 'k', 'merge `main`')}.`)).toBe('Run `npm then merge main.')
    expect(shown(`See [the ${link('leadIn', 'k', 'docs')}${link('open', 'k', '.')} [x](https://x.y)`)).toBe('See [the docs. x')
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

  describe('italics', () => {
    /** A line's runs as text, each italic one between slashes. */
    const drawn = (text: string) => (layout(text, 200)[0] ?? []).map(run => (run.italic ? `/${run.text}/` : run.text)).join('')

    test('an underscore marks italics as a star does, and neither mark is drawn', () => {
      expect(drawn('Retry _only_ on ARM, where the *only* step runs _at most once_.')).toBe('Retry /only/ on ARM, where the /only/ step runs /at most once/.')
    })

    test('an underscore inside a word, or beside another underscore, is text', () => {
      const names = 'Call snake_case, my_var_name and __init__ here.'
      expect(drawn(names)).toBe(names)
    })

    test('an opening mark with no closing mark on its line is text', () => {
      const lone = 'Set _id on it, match *.ts files, or 5 * 3.'
      expect(drawn(lone)).toBe(lone)
    })

    test('a closing mark pairs with the nearest opening mark of its kind before it', () => {
      expect(drawn('Set _id and _name, then _commit_.')).toBe('Set _id and _name, then /commit/.')
    })

    test('italics close only on the mark that opened them', () => {
      expect(drawn('A *star_ and star* here.')).toBe('A /star_ and star/ here.')
      expect(drawn('An _under* and under_ here.')).toBe('An /under* and under/ here.')
    })

    test('italics of one mark hold beside an unpaired mark of the other, and inside italics of the other', () => {
      expect(drawn('Glob *.ts, keep _id, and run it _at most once_ and *never* twice.')).toBe('Glob *.ts, keep _id, and run it /at most once/ and /never/ twice.')
      expect(drawn('A *star _inside_ star* here.')).toBe('A /star inside star/ here.')
      expect(drawn('Then *a _b* c_ ends.')).toBe('Then /a _b/ c_ ends.')
    })

    test('a code span, a link label and a URL keep their underscores, inside italics too', () => {
      const runs = layout('_See `a_b` and_ [c_d](https://x.invalid/e_f) or https://x.invalid/g_h_i.', 200)[0] ?? []
      expect(runs.map(run => run.text).join('')).toBe('See a_b and c_d or https://x.invalid/g_h_i.')
      expect(runs.filter(run => run.italic).map(run => run.text)).toEqual(['See ', 'a_b', ' and'])
      const link = (layout('Read _https://x.invalid/a_b_ first.', 200)[0] ?? []).find(run => run.href)
      expect(link).toMatchObject({ text: 'https://x.invalid/a_b', href: 'https://x.invalid/a_b', italic: true })
    })

    test('a mark is read by the characters drawn beside it, passing over a pressable phrase\'s frame', () => {
      const word = link('open', 'k', 'word')
      const runs = layout(`${word}_x_ and _${word}_y_`, 200)[0] ?? []
      expect(runs.map(run => run.text).join('')).toBe('word_x_ and word_y')
      expect(runs.filter(run => run.italic).map(run => run.text)).toEqual(['word', '_y'])
      expect(runs.filter(run => run.link).map(run => run.text)).toEqual(['word', 'word'])
    })

    test('a letter that takes two code units is a letter beside an underscore', () => {
      for (const names of ['𝑥_a_', '_a_𝑥']) expect(drawn(names)).toBe(names)
    })

    test('an arriving mark that has met no closing mark is not drawn, and the arriving text after it is italic', () => {
      expect(drawn(`Short, with ${asArriving('_at most')}`)).toBe('Short, with /at most/')
      expect(drawn(`Short, with ${asArriving('_at most')} and the rest.`)).toBe('Short, with /at most/ and the rest.')
    })

    test('an unpaired mark in text already drawn stays text next to arriving text', () => {
      expect(drawn(`Keep _id, then ${asArriving('*two more')}`)).toBe('Keep _id, then /two more/')
    })

    test('a rule or a fence line is left bare by the arriving marks, so it is still read as one', () => {
      expect(asArriving(['a', '---', '```ts', 'b', '```'].join('\n')).split('\n').map(line => /^[\ufdd5]/.test(line))).toEqual([true, false, false, true, false])
    })

    // The mark stands in a word the short form holds too, or apart from any word, as in text without spaces.
    for (const [short, long] of [['Use the cache.', 'Use _the cache for every build_.'], ['缓存。', '使用*缓存和索引*加速。']] as const) {
      test(`no frame of ${long} growing from ${short} draws its opening mark before its closing one`, () => {
        for (let step = 0; step < 20; step += 1) {
          const frame = (layout(asArriving(grow(short, parse(long), step / 20, () => '')), 200)[0] ?? []).map(run => run.text).join('')
          expect(frame).not.toMatch(/[*_]/)
        }
      })
    }
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

  test('a closing fence followed by the braces of the stretch around it ends the stretch, so the blank line after cuts', async () => {
    const text = ['{{a|long', '```', 'code', '```}}', '', 'After {{b|c}}.'].join('\n')
    expect(paragraphsOf(text)).toEqual([
      { text: '{{a|long\n```\ncode\n```}}', hasStretch: true },
      { text: 'After {{b|c}}.', hasStretch: true },
    ])
  })

  test('a reply whose stretch closes on a code block\'s closing fence draws every section after it', async $ => {
    const text = ['{{Count first.|Count first.', '', '```bash', 'git push', '```}}', '', 'After {{risks|the risks}}.'].join('\n')
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui, 'paragraph-0')).toBe('Count first.')
    expect(await textIn(ui, 'paragraph-1')).toBe('After risks.')
    await ui.unmount()
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

test('a link with no words of its own is pressed on the words before it, which stay where they are', async $ => {
  const text = '- **#212 Move sessions to Redis**: merged 3 days ago{{.|, and the e2e run passed.}}'
  const ui = await mountReply($, FULLSCREEN, text)
  expect(await textIn(ui)).toBe('- #212 Move sessions to Redis: merged 3 days ago.')
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  expect(pieces.find(piece => piece.text === '#212 Move sessions to Redis')?.props).toMatchObject({ bold: true, underline: true })
  expect(pieces.find(piece => piece.text === ': merged 3 days ago')?.props).toMatchObject({ underline: true })
  expect(pieces.find(piece => piece.text === '- ')?.props).not.toHaveProperty('underline')
  await pressOn(ui, 'merged')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('- #212 Move sessions to Redis: merged 3 days ago, and the e2e run passed. «')
  await ui.unmount()
})

test('an empty short form joined to the text after it opens from the words before it and that text', async $ => {
  const text = 'The type check exited 0{{|, so it found no errors}}. Tests passed too.'
  const ui = await mountReply($, FULLSCREEN, text)
  expect(await textIn(ui)).toBe('The type check exited 0. Tests passed too.')
  const pieces = await ui.findAll({ type: 'Text', in: FIRST })
  expect(pieces.find(piece => piece.text === 'The type check exited 0.')?.props).toMatchObject({ underline: true })
  await pressOn(ui, 'exited')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('The type check exited 0, so it found no errors «. Tests passed too.')
  await ui.unmount()
})

test('a click on lead-in words opens their stretch once a second press can no longer make a double-click', async $ => {
  const ui = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and the e2e run passed.}}')
  await pressOn(ui, 'merged')
  await ui.advance(400)
  expect(await textIn(ui)).toBe('It merged 3 days ago.')
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('It merged 3 days ago, and the e2e run passed. «')
  await ui.unmount()
})

test('two quick clicks on the lead-in words of two links open both, also on the row below at the same column', async ($, on) => {
  const copies = clipboard(on)
  const ui = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and passed.}} The second one is approved{{.|, but blocked.}}')
  await pressOn(ui, 'merged')
  await pressOn(ui, 'approved')
  await ui.advance(3000)
  expect(await textIn(ui)).toBe('It merged 3 days ago, and passed. « The second one is approved, but blocked. «')
  await ui.unmount()
  const rows = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and passed.}}\nIt failed 2 days ago{{.|, and reran.}}', 'terminal', 'reply-2')
  expect(await textIn(rows)).toBe('It merged 3 days ago.\nIt failed 2 days ago.')
  await rows.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: FIRST })
  await rows.pointer({ type: 'up', x: 4, y: 0, button: 'left', in: FIRST })
  await rows.pointer({ type: 'down', x: 4, y: 1, button: 'left', in: FIRST })
  await rows.pointer({ type: 'up', x: 4, y: 1, button: 'left', in: FIRST })
  await rows.advance(3000)
  expect(await textIn(rows)).toBe('It merged 3 days ago, and passed. «\nIt failed 2 days ago, and reran. «')
  expect(copies).toEqual([])
  await rows.unmount()
})

test('a short form opens as the button comes up, not as it goes down', async $ => {
  const ui = await mountReply($, FULLSCREEN, 'It {{merged|merged 3 days ago}}.')
  await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: FIRST })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('It merged.')
  await ui.pointer({ type: 'up', x: 4, y: 0, button: 'left', in: FIRST })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('It merged 3 days ago «.')
  await ui.unmount()
})

const SIBLINGS = 'The type check exited 0{{|, so it found no errors}}. {{The fix is one line.|The fix is one line in `ci/cache.ts`, where the key hashes the lockfile.}}'

test('while another stretch grows, lead-in words stay drawn and a click on them opens their stretch', async $ => {
  const ui = await mountReply($, FULLSCREEN, SIBLINGS)
  const underlined = async () =>
    (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.underline === true).map(piece => piece.text)
  expect(await underlined()).toEqual(['The type check exited 0.', 'The fix is one line.'])
  await pressOn(ui, 'The fix')
  await ui.advance(100)
  expect(await underlined()).toContain('The type check exited 0.')
  await pressOn(ui, 'exited')
  await ui.advance(3000)
  expect(await textIn(ui)).toContain('The type check exited 0, so it found no errors «.')
  expect(await textIn(ui)).toContain('hashes the lockfile. «')
  await ui.unmount()
})

test('half a code span drawn by a growing long form never draws the marks of a link after it as text', async $ => {
  const text = '{{Run it.|Run `npm run test:unit -- --watch` once.}} Then {{merge `main`|merge `main` into it}}{{.|, after review.}}'
  const ui = await mountReply($, FULLSCREEN, text)
  await pressOn(ui, 'Run it.')
  for (let frame = 0; frame < 120; frame += 1) {
    await ui.advance(16)
    const shown = await textIn(ui)
    expect(shown).not.toMatch(/[\ufdd0-\ufdd6]/)
  }
  expect(await textIn(ui)).toBe('Run npm run test:unit -- --watch once. « Then merge main.')
  await ui.unmount()
})

test('underscore italics in a long form grow without their marks, and an unpaired mark already drawn stays as it is', async $ => {
  const ui = await mountReply($, FULLSCREEN, 'Keep _id. {{Short.|Short, with an _emphasised_ word and _two more_ here.}}')
  await pressOn(ui, 'Short.')
  for (let frame = 0; frame < 120; frame += 1) {
    await ui.advance(16)
    const shown = await textIn(ui)
    expect(shown.startsWith('Keep _id. ')).toBe(true)
    expect(shown.slice('Keep _id. '.length)).not.toContain('_')
  }
  expect(await textIn(ui)).toBe('Keep _id. Short, with an emphasised word and two more here. «')
  const italic = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.italic === true).map(piece => piece.text)
  expect(italic).toEqual(['emphasised', 'two more'])
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

  /** Presses and releases the left button twice on one cell, as a double-click does. */
  const doubleClick = async (ui: Mounted, at: { x: number; y: number }, key = FIRST) => {
    for (let i = 0; i < 2; i += 1) {
      await ui.pointer({ type: 'down', ...at, button: 'left', in: key })
      await ui.pointer({ type: 'up', ...at, button: 'left', in: key })
    }
  }
  const firstRowOf = async (ui: Mounted) => (await rowsOf(ui))[0] ?? ''

  test('a double-click copies the word under it, drawn inverse', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await doubleClick(ui, { x: 6, y: 0 })
    expect(copies).toEqual(['build'])
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'build')?.props).toMatchObject({ inverse: true })
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a double-click takes an id whole, without the punctuation after it', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'See #12806, NMC-2628 and hooks/reply.tsx. Then {{a stretch|a long stretch}}.')
    const row = await firstRowOf(ui)
    for (const id of ['#12806', 'NMC-2628', 'hooks/reply.tsx']) await doubleClick(ui, { x: row.indexOf(id) + 2, y: 0 })
    expect(copies).toEqual(['#12806', 'NMC-2628', 'hooks/reply.tsx'])
    await ui.unmount()
  })

  test('a double-click keeps the marks a path, a dotfile or a flag starts with', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Pass --plugin-dir to ~/.claude, then open .gitignore and /Users/me/a.ts, from .. up. Then {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    const words = ['--plugin-dir', '~/.claude', '.gitignore', '/Users/me/a.ts', '..']
    for (const word of words) await doubleClick(ui, { x: row.indexOf(` ${word}`) + 2, y: 0 })
    expect(copies).toEqual(words)
    await ui.unmount()
  })

  test('a double-click takes a URL whole, and a word of a link label alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'See https://github.com/pro-vi/cc-stretch/pull/16. Then read [the docs](https://x.invalid/docs) and {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    await doubleClick(ui, { x: row.indexOf('github'), y: 0 })
    await doubleClick(ui, { x: row.indexOf('docs'), y: 0 })
    expect(copies).toEqual(['https://github.com/pro-vi/cc-stretch/pull/16', 'docs'])
    await ui.unmount()
  })

  test('a double-click takes a URL drawn as code, with a file scheme, or in brackets, whole and alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Serve `http://localhost:5173`, open file:///Users/me/a.ts. (See https://x.invalid/a_(b)). Then {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    for (const at of ['localhost', 'Users', 'x.invalid']) await doubleClick(ui, { x: row.indexOf(at), y: 0 })
    expect(copies).toEqual(['http://localhost:5173', 'file:///Users/me/a.ts', 'https://x.invalid/a_(b)'])
    await ui.unmount()
  })

  test('a double-click takes a URL a line wrapped inside whole, from either of its rows', async ($, on) => {
    const copies = clipboard(on)
    const url = 'https://github.com/pro-vi/cc-stretch/pull/16'
    const ui = await mountReply($, { columns: 30, rows: 40, isFullscreen: true }, `See ${url} and {{a stretch|a long stretch}}.`)
    const rows = await rowsOf(ui)
    const top = rows.findIndex(row => row.includes('https'))
    const bottom = rows.findIndex(row => row.includes('/16'))
    expect(bottom).toBeGreaterThan(top)
    await doubleClick(ui, { x: (rows[top] ?? '').indexOf('https') + 2, y: top })
    await doubleClick(ui, { x: (rows[bottom] ?? '').indexOf('/16'), y: bottom })
    expect(copies).toEqual([url, url])
    await ui.unmount()
  })

  test('a selection across the rows a list item wraps onto draws selected only the cells it copies', async ($, on) => {
    const copies = clipboard(on)
    const url = 'https://github.com/pro-vi/cc-stretch/pull/16'
    const ui = await mountReply($, { columns: 30, rows: 40, isFullscreen: true }, `- See ${url} and {{a stretch|a long stretch}}.`)
    const rows = await rowsOf(ui)
    const bottom = rows.findIndex(row => row.includes('/16'))
    const drawn = async () => (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
    await doubleClick(ui, { x: (rows[bottom] ?? '').indexOf('/16'), y: bottom })
    expect({ copied: copies, drawn: (await drawn()).join('') }).toEqual({ copied: [url], drawn: url })
    await drag(ui, { x: 0, y: 0 }, { x: 4, y: bottom })
    expect({ copied: copies.at(-1), drawn: await drawn() }).toEqual({
      copied: '- See https://github.com/pro-vi/cc-st',
      drawn: ['- See', 'https://github.com/pro-vi/cc', '-st'],
    })
    await ui.unmount()
  })

  test('a double-click on the last word of a row a line wrapped at a space takes that word alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Each word stays apart where a line wraps at a space between two words, {{a stretch|a long stretch}}.'
    const ui = await mountReply($, { columns: 30, rows: 40, isFullscreen: true }, text)
    const row = (await firstRowOf(ui)).trimEnd()
    await doubleClick(ui, { x: row.length - 1, y: 0 })
    expect(copies).toEqual([row.split(' ').at(-1)])
    await ui.unmount()
  })

  test('a double-click picks a one-letter word', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'Pick a word, then {{a stretch|a long stretch}}.')
    await doubleClick(ui, { x: 'Pick '.length, y: 0 })
    expect(copies).toEqual(['a'])
    await ui.unmount()
  })

  test('a double-click on a space picks nothing, and two clicks more than a cell apart are two clicks', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await doubleClick(ui, { x: 3, y: 0 })
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await drag(ui, { x: 7, y: 0 }, { x: 7, y: 0 })
    expect(copies).toEqual([])
    expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.inverse === true)).toBe(false)
    await ui.unmount()
  })

  test('two clicks over 500 ms apart are two clicks, and two sooner and a cell apart are a double-click', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    // As of Claude Code 2.1.303, `ui.advance` does not move `performance.now()`, which the plugin reads
    // for a press's time, so the test waits the time out.
    const until = performance.now() + 520
    while (performance.now() < until) continue
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    expect(copies).toEqual([])
    await drag(ui, { x: 6, y: 0 }, { x: 6, y: 0 })
    expect(copies).toEqual(['build'])
    await ui.unmount()
  })

  test('a third quick press a cell on from the second keeps the word selected', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const x of [5, 6, 7]) await drag(ui, { x, y: 0 }, { x, y: 0 })
    const selected = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
    expect({ copies, selected }).toEqual({ copies: ['build', 'build'], selected: ['build'] })
    await ui.unmount()
  })

  test('a press that opens a stretch between two clicks keeps them from making a double-click', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await pressOn(ui, 'on a stale cache')
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    expect(copies).toEqual([])
    await ui.unmount()
  })

  test('a drag that starts on a short form or on lead-in words selects and opens nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'It {{merged|merged 3 days ago}} and shipped 2 days ago{{.|, after review.}}')
    await drag(ui, { x: 3, y: 0 }, { x: 8, y: 0 })
    await drag(ui, { x: 14, y: 0 }, { x: 22, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['merged', 'shipped 2'])
    expect(await textIn(ui)).toBe('It merged and shipped 2 days ago.')
    await ui.unmount()
  })

  test('a double-click on lead-in words copies the word and opens nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'Edit hooks/reply.tsx first{{.|, then rerun the tests.}}')
    await doubleClick(ui, { x: 8, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['hooks/reply.tsx'])
    expect(await textIn(ui)).toBe('Edit hooks/reply.tsx first.')
    await ui.unmount()
  })

  test('a click on a short form still opens its stretch and copies nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    const row = await firstRowOf(ui)
    await ui.pointer({ type: 'down', x: row.indexOf('on a stale cache') + 1, y: 0, button: 'left', in: FIRST })
    await ui.pointer({ type: 'up', x: row.indexOf('on a stale cache') + 1, y: 0, button: 'left', in: FIRST })
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    expect(copies).toEqual([])
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

test('the note names a lone period by the words before it, and the one left closed as well', async ($, on) => {
  const text = 'The PR merged 3 days ago{{.|, and the e2e run passed.}} The second one is approved{{.|, but a failing e2e test blocks it.}}'
  on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })
  const ui = await mountReply($, FULLSCREEN, text)
  await pressOn(ui, 'merged')
  await ui.advance(2000)
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretchtext: since your last reply the reader opened "The PR merged 3 days ago.". They did not open "The second one is approved.".',
  ])
  await ui.unmount()
})

test('the note tells apart two stretches written alike after different sentences', async ($, on) => {
  const text = 'It merged{{.|, and passed.}} It shipped{{.|, and passed.}}'
  on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })
  const ui = await mountReply($, FULLSCREEN, text)
  await pressOn(ui, 'merged')
  await ui.advance(2000)
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual(['Stretchtext: since your last reply the reader opened "It merged.". They did not open "It shipped.".'])
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
  expect(rows.at(-1)).toBe('«')
  expect((await rowsOf(ui, 'paragraph-1')).slice(-2)).toEqual(['  key: 1', '«'])
  await pressOn(ui, '«', { last: true })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('Status.')
  await ui.unmount()
})

test('the words a stretch adds take its colour, faded once another opens or the reader writes again', async ($, on) => {
  const text = 'One {{cat|cat, black,}} and {{dog|dog, brown,}} here.'
  on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('config.list', () => ({ value: [themeRow('dark')] }))
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

// As of Claude Code 2.1.322 the theme row holds the setting, so none of these says whether the screen is
// light or dark; undefined leaves `config.list` unanswered, which fails the read. The custom theme's
// name holds `light` without starting with it.
for (const [name, rows] of [
  ['the auto theme', [themeRow('auto')]],
  ['a custom theme', [themeRow('custom:light-paper')]],
  ['no theme row', []],
  ['a settings list that fails', undefined],
] as const) {
  test(`under ${name} the words a stretch adds take the theme's own colours by key, and none fades`, async ($, on) => {
    if (rows !== undefined) on('config.list', () => ({ value: [...rows] }))
    const ui = await mountReply($, FULLSCREEN, 'One {{cat|cat, black,}} and {{dog|dog, brown,}} here.')
    await pressOn(ui, 'cat')
    await ui.advance(2000)
    await pressOn(ui, 'dog')
    await ui.advance(2000)
    expect(await coloursOf(ui, 'black,')).toEqual(['warning'])
    expect(await coloursOf(ui, 'brown,')).toEqual(['autoAccept'])
    expect(await coloursOf(ui, '«')).toEqual(['warning', 'autoAccept'])
    await ui.unmount()
  })
}

for (const [theme, colour] of [['dark-daltonized', SOFT[0]], ['light-ansi', '#533b11']] as const) {
  test(`the ${theme} theme names its palette by how its name starts`, async ($, on) => {
    on('config.list', () => ({ value: [themeRow(theme)] }))
    const ui = await mountReply($, FULLSCREEN, 'One {{cat|cat, black,}} here.')
    await pressOn(ui, 'cat')
    await ui.advance(2000)
    expect(await coloursOf(ui, 'black,')).toEqual([colour])
    await ui.unmount()
  })
}

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

describe('hyperlinks', () => {
  const DOCS = 'Docs at https://x.invalid/docs and {{a stretch|a long stretch}}.'
  /**
   * Answers each command the plugin runs, and keeps the argument vector of each but `uname -s`, which
   * names `system`; with none, `uname` does not start, as on Windows.
   */
  const commands = (on: On, { system = 'Darwin', exitCode = 0 }: { system?: string | null; exitCode?: number } = {}) => {
    const ran: string[][] = []
    const answer = (stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', (_, e, next) => {
      if (e.argv[0] === 'uname') return system === null ? next(e) : answer(`${system}\n`)
      ran.push([...e.argv])
      return answer('')
    })
    return ran
  }
  /** Clicks cell `at` with a modifier held, as a mouse does: down, then up. */
  const clickWith = async (ui: Mounted, at: { x: number; y: number }, modifier: { ctrl?: true; alt?: true }) => {
    await ui.pointer({ type: 'down', ...at, button: 'left', ...modifier, in: FIRST })
    await ui.pointer({ type: 'up', ...at, button: 'left', ...modifier, in: FIRST })
  }

  test("a ctrl- or alt-click on a hyperlink opens it with the machine's own opener, and selects nothing", async ($, on) => {
    const ran = commands(on)
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    // "Docs at https://x.invalid/docs and a stretch."
    await clickWith(ui, { x: 10, y: 0 }, { ctrl: true })
    await clickWith(ui, { x: 28, y: 0 }, { alt: true })
    await ui.advance(100)
    expect(ran).toEqual([['open', 'https://x.invalid/docs'], ['open', 'https://x.invalid/docs']])
    expect(copies).toEqual([])
    expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.inverse === true)).toBe(false)
    await ui.unmount()
  })

  test('a plain click on a hyperlink opens nothing, and a drag across it, ctrl held or not, still copies', async ($, on) => {
    const ran = commands(on)
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await drag(ui, { x: 10, y: 0 }, { x: 10, y: 0 })
    await drag(ui, { x: 8, y: 0 }, { x: 30, y: 0 })
    await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.pointer({ type: 'move', x: 30, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.pointer({ type: 'up', x: 30, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.advance(100)
    expect(ran).toEqual([])
    // The ctrl-drag went down on the second t of https.
    expect(copies).toEqual(['https://x.invalid/docs', 'tps://x.invalid/docs'])
    await ui.unmount()
  })

  test('a ctrl-click on a file: link opens nothing: the terminal\'s own click is left to open it', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, 'See [the log](file:///tmp/x.log) and {{a stretch|a long stretch}}.')
    // "See the log and a stretch."
    await clickWith(ui, { x: 6, y: 0 }, { ctrl: true })
    await ui.advance(100)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('a modified click away from a hyperlink acts as a plain one: on a short form it opens the stretch', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await clickWith(ui, { x: 36, y: 0 }, { ctrl: true })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a long stretch «.')
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('a hyperlink inside a short form opens on a modified click, and the stretch on a plain one', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, 'Read {{the [guide](https://x.invalid/g)|the [guide](https://x.invalid/g), part two}} now.')
    // "Read the guide now."
    await clickWith(ui, { x: 10, y: 0 }, { alt: true })
    await ui.advance(100)
    expect(ran).toEqual([['open', 'https://x.invalid/g']])
    expect(await textIn(ui)).toBe('Read the guide now.')
    await pressOn(ui, 'guide')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Read the guide, part two « now.')
    await ui.unmount()
  })

  test('a hyperlink that could not be opened is said so', async ($, on) => {
    commands(on, { exitCode: 1 })
    const said = toasts(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await clickWith(ui, { x: 10, y: 0 }, { ctrl: true })
    await ui.advance(100)
    expect(said).toEqual(['cc-stretch: could not open https://x.invalid/docs'])
    await ui.unmount()
  })

  // On Windows the URL goes to rundll32, which runs no shell: `cmd /c start` would read the `&` as its own.
  for (const [system, opener] of [
    ['Linux', ['sh', '-c', 'xdg-open "$1" </dev/null >/dev/null 2>&1', 'sh']],
    ['MINGW64_NT-10.0-26100', ['rundll32', 'url.dll,FileProtocolHandler']],
    [null, ['rundll32', 'url.dll,FileProtocolHandler']],
  ] as const) {
    test(`with uname naming ${system ?? 'nothing'}, a hyperlink opens with ${opener.at(-1) === 'sh' ? 'xdg-open' : opener[0]}`, async ($, on) => {
      const ran = commands(on, { system })
      const ui = await mountReply($, FULLSCREEN, 'See https://x.invalid/a?b=1&c=2 and {{a stretch|a long stretch}}.')
      await clickWith(ui, { x: 6, y: 0 }, { ctrl: true })
      await ui.advance(100)
      expect(ran).toEqual([[...opener, 'https://x.invalid/a?b=1&c=2']])
      await ui.unmount()
    })
  }
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

describe('a guide on trial', () => {
  const FILE = '/guides/candidate.txt'
  /** Answers the session's id and the file's text, or its failure to be read, as given; returns what was read: file paths, and `id` for each read of the session's id. */
  const guideUnder = (on: On, id: string, file: () => string) => {
    const reads: string[] = []
    on('prompt.compose', () => ({ sections: [] }))
    on('session.id', () => {
      reads.push('id')
      return { value: id }
    })
    on('fs.read', (_, e) => {
      reads.push(e.path)
      return { value: file() }
    })
    return reads
  }
  const guide = async ($: Engine) => (await $.prompt.compose({ ...COMPOSE, surfaces: ['terminal'] })).sections.at(-1)?.text

  test('about half of all session ids take it, and the same id always falls the same way', async () => {
    const taking = Array.from({ length: 2000 }, (_, i) => `session-${i}`).filter(takesTrialGuide).length
    expect([taking > 900, taking < 1100]).toEqual([true, true])
    expect([takesTrialGuide('session-1'), takesTrialGuide('session-4')]).toEqual([true, false])
  })

  test('a session its id picks carries the file\'s text, the one it first read, to its end', { options: { trialGuide: ` ${FILE} ` } }, async ($, on) => {
    let text = 'A guide on trial.\n'
    const reads = guideUnder(on, 'session-1', () => text)
    expect(await guide($)).toBe('A guide on trial.')
    text = 'Edited since.'
    expect(await guide($)).toBe('A guide on trial.')
    expect(reads).toEqual(['id', FILE])
  })

  test('a session its id does not pick keeps the plugin\'s guide, and the file is not read', { options: { trialGuide: FILE } }, async ($, on) => {
    const reads = guideUnder(on, 'session-4', () => 'A guide on trial.')
    expect(await guide($)).toBe(GUIDE)
    expect(await guide($)).toBe(GUIDE)
    expect(reads).toEqual(['id'])
  })

  test('a file that cannot be read leaves the plugin\'s guide', { options: { trialGuide: FILE } }, async ($, on) => {
    guideUnder(on, 'session-1', () => {
      throw new Error('ENOENT')
    })
    expect(await guide($)).toBe(GUIDE)
  })

  test('an empty file leaves the plugin\'s guide', { options: { trialGuide: FILE } }, async ($, on) => {
    guideUnder(on, 'session-1', () => ' \n')
    expect(await guide($)).toBe(GUIDE)
  })

  test('with no file named, every session keeps the plugin\'s guide and nothing is read', async ($, on) => {
    const reads = guideUnder(on, 'session-1', () => 'A guide on trial.')
    expect(await guide($)).toBe(GUIDE)
    expect(reads).toEqual([])
  })
})

describe('a guide Claude Code never asks for', () => {
  const ASKED: SessionMessage[] = [
    { role: 'user', text: 'why does CI fail?', toolUses: [] },
    { role: 'assistant', text: 'The cache is stale.', toolUses: [] },
  ]
  /** The dim lines the plugin writes into the transcript, with the session's messages read from `session.messages`. */
  const session = (on: On) => {
    const held: { said: string[]; messages: SessionMessage[] } = { said: [], messages: [] }
    on('ui.log', (_, e) => {
      held.said.push(e.text)
      return { value: undefined }
    })
    on('session.messages', () => ({ value: held.messages }))
    on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
    on('prompt.compose', () => ({ sections: [] }))
    return held
  }
  const prompt = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  test('the prompt after a reply written without it says why Claude writes no stretches, once', async ($, on) => {
    const held = session(on)
    await prompt($, 'why does CI fail?')
    // A prompt that got no reply, such as a command, shows nothing yet.
    await prompt($, '/help')
    expect(held.said).toEqual([])

    held.messages = ASKED
    await prompt($, 'and?')
    expect(held.said.length).toBe(1)
    expect(held.said[0]).toContain('has not asked this plugin for its writing guide')
    expect(held.said[0]).toContain('managed settings')

    await prompt($, 'ok')
    expect(held.said.length).toBe(1)
  })

  for (const surfaces of [['terminal'], []] satisfies RenderSurface[][]) {
    test(`nothing is said once Claude Code has asked for it with ${surfaces.length === 0 ? 'nothing' : surfaces.join(' and ')} drawing`, async ($, on) => {
      const held = session(on)
      await prompt($, 'why does CI fail?')
      await $.prompt.compose({ ...COMPOSE, surfaces })
      held.messages = ASKED
      await prompt($, 'and?')
      expect(held.said).toEqual([])
    })
  }

  test('a reply from before the plugin loaded says nothing, a later one does', async ($, on) => {
    const held = session(on)
    held.messages = ASKED
    // A command draws no reply and no ask, so the reply that stands is still the one from before.
    await prompt($, '/help')
    await prompt($, 'and?')
    expect(held.said).toEqual([])

    held.messages = [...ASKED, { role: 'user', text: 'and?', toolUses: [] }, { role: 'assistant', text: 'Its key hashes one file.', toolUses: [] }]
    await prompt($, 'ok')
    expect(held.said.length).toBe(1)
  })
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

  test('with letters up, a drag across the rows a list item wraps onto draws selected only the cells it copies', async ($, on) => {
    const text = '- See https://github.com/pro-vi/cc-stretch/pull/16 and {{a stretch|a long stretch}}.'
    engine(on, [text])
    const copies = clipboard(on)
    const ui = await mountReply($, { columns: 30, rows: 40, isFullscreen: true }, text)
    await down(ui)
    const bottom = (await rowsOf(ui)).findIndex(row => row.includes('/16'))
    await drag(ui, { x: 0, y: 0 }, { x: 4, y: bottom })
    const drawn = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
    expect({ copied: copies, drawn, letters: await letters(ui) }).toEqual({
      copied: ['- See https://github.com/pro-vi/cc-st'],
      drawn: ['- See', 'https://github.com/pro-vi/cc', '-st'],
      letters: ['a'],
    })
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

  for (const [highlight, shown] of [['#264f78', '#264f78'], ['tinted', DEEP[0]]] as const) {
    test(`with the highlight ${highlight}, the rest of a short form under its letter keeps that highlight`, { options: { highlight } }, async ($, on) => {
      engine(on)
      const ui = await mountReply($, FULLSCREEN)
      await down(ui)
      expect(await letters(ui)).toEqual(['a'])
      expect(await phraseProps(ui, 'n a stale cache')).toMatchObject({ backgroundColor: shown, color: '#f2f2f2' })
      expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.backgroundColor === 'permission')).toBe(false)
      await ui.unmount()
    })
  }

  test('under a highlight, code in a short form under its letter, which takes no highlight, is drawn on the permission colour', { options: { highlight: '#264f78' } }, async ($, on) => {
    const text = 'See {{the `cfg` file|the `cfg` file, in ci}} now.'
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await phraseProps(ui, 'cfg')).toMatchObject({ backgroundColor: 'permission' })
    expect(await phraseProps(ui, ' file')).toMatchObject({ backgroundColor: '#264f78' })
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

  test('a stretch with an empty short form opens from the letter on the words before it', async ($, on) => {
    const text = 'Before {{|hidden words}} after {{shown|more}}.'
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toEqual(['a', 's'])
    await type($, 'a')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('Before hidden words « after shown.')
    await ui.unmount()
  })

  test('a stretch with an empty short form and no words before it draws no link and opens from no letter', async ($, on) => {
    const text = '{{|hidden words}} after {{shown|more}}.'
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

/** The props of a pressable phrase, by its text and paragraph; by default the first phrase of the first paragraph. */
const phraseProps = async (ui: Mounted, phrase = 'on a stale cache', key = FIRST) => (await ui.findAll({ type: 'Text', in: key })).find(piece => piece.text === phrase)?.props

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

  test('italic and strikethrough combine with a highlight', { options: { marks: 'italic,strikethrough', highlight: '#264f78' } }, async $ => {
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

  test('dim on a highlight moves the text colour chosen to read on it toward the highlight', { options: { marks: 'dim', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ backgroundColor: '#264f78', color: '#a0b1c1' })
    expect(phrase).not.toHaveProperty('dimColor')
    await ui.unmount()
  })

  test('a highlight that is neither hex nor tinted is none, so dim is the theme grey', { options: { marks: 'dim', highlight: 'suggestion' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ dimColor: true })
    expect(phrase).not.toHaveProperty('backgroundColor')
    await ui.unmount()
  })

  test('an opened stretch keeps its tint under a style with dim and a highlight', { options: { marks: 'bold,dim', highlight: '#264f78' } }, async ($, on) => {
    on('config.list', () => ({ value: [themeRow('dark')] }))
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    const closer = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === '«')?.props
    expect(closer?.color).toBe(SOFT[0])
    expect(closer).not.toHaveProperty('backgroundColor')
    expect(closer).not.toHaveProperty('dimColor')
    expect(closer).toMatchObject({ bold: true })
    await ui.unmount()
  })

  for (const highlight of ['#264f78', '']) {
    const name = highlight === '' ? 'stays dim with no highlight' : 'takes the highlight, its text colour moved toward it as dim'
    test(`the target written after a relative link in a short form ${name}`, { options: { highlight } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'Read {{the [guide](docs/guide.md)|the [guide](docs/guide.md) first}} now.')
      const target = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === ' (docs/guide.md)')?.props
      if (highlight === '') {
        expect(target).toMatchObject({ dimColor: true })
      } else {
        expect(target).toMatchObject({ backgroundColor: highlight, color: '#a0b1c1' })
        expect(target).not.toHaveProperty('dimColor')
      }
      await ui.unmount()
    })
  }

  describe('the tinted highlight', () => {
    const backgroundOf = async (ui: Mounted, phrase: string, key = FIRST) => (await phraseProps(ui, phrase, key))?.backgroundColor

    test('highlights each closed stretch in the colour of its place, counted across the reply', { options: { highlight: ' Tinted ' } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.\n\nThen {{three|three more}}.')
      expect(await backgroundOf(ui, 'one')).toBe(DEEP[0])
      expect(await backgroundOf(ui, 'two')).toBe(DEEP[1])
      expect(await backgroundOf(ui, 'three', 'paragraph-1')).toBe(DEEP[2])
      expect(await phraseProps(ui, 'one')).toMatchObject({ underline: true, color: '#f2f2f2' })
      await ui.unmount()
    })

    test('an opened stretch takes the colour of its place, not of the order it was opened in', { options: { highlight: 'tinted' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('dark')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      await pressOn(ui, 'two')
      await ui.advance(2000)
      const added = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.text.trim() === 'more')
      expect(added.map(piece => piece.props.color)).toEqual([SOFT[1]])
      expect(await backgroundOf(ui, 'one')).toBe(DEEP[0])
      await ui.unmount()
    })

    test('a nested stretch never takes the colour of the stretch holding it', { options: { highlight: 'tinted' } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, '{{p|p {{a|a1}} {{b|b1}} {{c|c1}} {{d|d1}}}} end.')
      await pressOn(ui, 'p')
      await ui.advance(2000)
      expect(await backgroundOf(ui, 'c')).toBe(DEEP[3])
      expect(await backgroundOf(ui, 'd')).toBe(DEEP[1])
      await ui.unmount()
    })

    test('a nested stretch whose short form is spelled like a nested key still never takes its holder\'s colour', { options: { highlight: 'tinted' } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, '{{p|p {{a|a1}} {{b|b1}} {{c|c1}} {{x › y|d1}}}} end.')
      await pressOn(ui, 'p')
      await ui.advance(2000)
      expect(await backgroundOf(ui, 'x › y')).toBe(DEEP[1])
      await ui.unmount()
    })

    test('on the light theme each closed stretch is highlighted pale, its text dark', { options: { highlight: 'tinted' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('light')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await phraseProps(ui, 'one')).toMatchObject({ backgroundColor: '#e5dac7', color: '#1c1c1c' })
      expect(await backgroundOf(ui, 'two')).toBe('#e1bfff')
      await ui.unmount()
    })

    test('under the auto theme each closed stretch keeps the dark palette\'s highlight, and an opened one\'s words take the theme\'s own colour of its place', { options: { highlight: 'tinted' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('auto')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await phraseProps(ui, 'one')).toMatchObject({ backgroundColor: DEEP[0], color: '#f2f2f2' })
      await pressOn(ui, 'two')
      await ui.advance(2000)
      expect(await coloursOf(ui, 'more')).toEqual(['autoAccept'])
      await ui.unmount()
    })

    test('palette light draws the light theme\'s colours under the auto theme, in any case', { options: { highlight: 'tinted', palette: ' Light ' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('auto')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await phraseProps(ui, 'one')).toMatchObject({ backgroundColor: '#e5dac7', color: '#1c1c1c' })
      await pressOn(ui, 'two')
      await ui.advance(2000)
      const added = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.text.trim() === 'more')
      expect(added.map(piece => piece.props.color)).toEqual(['#4a008c'])
      await ui.unmount()
    })

    test('palette dark keeps the dark theme\'s colours under the light theme', { options: { highlight: 'tinted', palette: 'dark' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('light')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await backgroundOf(ui, 'one')).toBe(DEEP[0])
      await ui.unmount()
    })

    test('a palette that names neither light nor dark follows the theme setting', { options: { highlight: 'tinted', palette: 'solarized' } }, async ($, on) => {
      on('config.list', () => ({ value: [themeRow('light')] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await backgroundOf(ui, 'one')).toBe('#e5dac7')
      await ui.unmount()
    })
  })

  test('lookOf reads marks in any case, with commas or spaces, in toolbar order', () => {
    expect(lookOf({ marks: 'Underline , BOLD' }).marks).toEqual(['bold', 'underline'])
    expect(lookOf({ marks: 'italic bold' }).marks).toEqual(['bold', 'italic'])
    expect(lookOf({ marks: ' NONE ', highlight: '#264f78' })).toEqual({ marks: [], highlight: '#264f78' })
    expect(lookOf({ highlight: ' TINTED ' }).highlight).toBe('tinted')
    for (const unknown of ['none', 'tint', '#zzz', '#264f78ff', 'suggestion']) expect(lookOf({ highlight: unknown }).highlight).toBe('')
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

  test('contrastOn picks the stronger of dark and light text, moves it 40% toward the highlight under dim, and leaves non-hex colours alone', () => {
    expect(contrastOn('#264f78', true)).toEqual({ color: '#a0b1c1' })
    expect(contrastOn('#ffd75f', true)).toEqual({ color: '#776737' })
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

  test('the toolbar offers five marks and three highlight choices, and no text colour', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    const keys = await keysOf(toolbar)
    expect(keys.filter(key => key.startsWith('mark-'))).toEqual(['mark-bold', 'mark-italic', 'mark-underline', 'mark-strikethrough', 'mark-dim'])
    expect(keys.filter(key => key.startsWith('highlight-'))).toEqual(['highlight-none', 'highlight-colour', 'highlight-tinted'])
    expect(keys.some(key => key.startsWith('text-'))).toBe(false)
    await toolbar.unmount()
  })

  test('the deep swatches show only while a colour is chosen, and colour starts at the first', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'highlight-colour' })
    expect((await keysOf(toolbar)).filter(key => key.startsWith('highlight-#'))).toHaveLength(9)
    const chosen = (await toolbar.findAll({ type: 'Text' })).filter(piece => piece.text === '◆◆')
    expect(chosen.map(piece => piece.props.backgroundColor)).toEqual(['#264f78'])
    await toolbar.press({ key: 'highlight-tinted' })
    expect((await keysOf(toolbar)).filter(key => key.startsWith('highlight-#'))).toEqual([])
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.highlight', 'tinted']])
    await toolbar.unmount()
  })

  test('the toolbar restyles replies live', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-underline' })
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'highlight-colour' })
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
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.marks', 'none'], ['cc-stretch.highlight', '#264f78']])
    // The try is gone once saved, so nothing is left to save.
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
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['cc-stretch.highlight', '#264f78']])
    await toolbar.press({ key: 'mark-bold' })
    // As of Claude Code 2.1.302 `claude plugin test` does not load the plugin again with the saved settings,
    // so after the save the toolbar shows the style it loaded with, which has no highlight, and colour must
    // be pressed again before a swatch shows.
    await toolbar.press({ key: 'highlight-colour' })
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

import { atom, memberOf, read, update } from 'claude-code'
import type { ClassicEventOf, ClassicResultOf, EngineInterface, Register, RenderInput, RenderNode, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { closeAfter, codeSpan, hideLongForms, isLinkable, isOpenable, KEY_SEPARATOR, newStreamState, paragraphsOf, parentOf, parse, stretches } from './parse'
import type { Segment, StreamState, Stretch } from './parse'
import { targetsIn } from './layout'
import type { Action } from './layout'
import { contrastOn } from './contrast'
import { isSameLook, lookOf, MARK_NAMES, marksSetting, storedLook } from './look'
import type { Look, Mark } from './look'
import type { ReplyPost, ReplyProps, Tint } from './reply'

const openStretches = atom({ plugin: 'cc-stretch', key: 'open' } as const, [])
const seen = atom({ plugin: 'cc-stretch', key: 'seen' } as const, [])
const stretchOrder = atom({ plugin: 'cc-stretch', key: 'order' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'cc-stretch', key: 'newest' } as const, '')
const askedStretch = atom({ plugin: 'cc-stretch', key: 'ask' } as const, null)
const lettering = atom({ plugin: 'cc-stretch', key: 'lettering' } as const, null)
const pickedLook = atom({ plugin: 'cc-stretch', key: 'look' } as const, null)
const toolbarShown = atom({ plugin: 'cc-stretch', key: 'toolbar' } as const, false)
/** Plugin state, not module state: as of Claude Code 2.1.302 each setting written reloads the plugin, and a save outlives the reload. */
const toolbarHolder = atom({ plugin: 'cc-stretch', key: 'busy' } as const, null)
/** Plugin state for the same reason: a save can land while a reply streams, and its next flush continues from here. */
const streamCheckpoints = atom({ plugin: 'cc-stretch', key: 'streams' } as const, {})

// The highlights the toolbar offers: deep colours, whose text turns light. A light highlight would draw
// dark text on a light ground, as a selection does. No text colour is offered: links, code and the
// words a click added already speak in colour.
const HIGHLIGHTS = ['#264f78', '#1f3a5f', '#3b4261', '#4b3b6b', '#5c2a4a', '#5f2a2a', '#5c4a00', '#1e4d2b', '#1d4b4b']

// Claude Code 2.1.300 can start a session on the main screen even with fullscreen set, and the
// variable overrides that.
const FULLSCREEN_HOW = 'run /tui fullscreen. If it says fullscreen is already on, start Claude Code with CLAUDE_CODE_NO_FLICKER=1, which forces fullscreen.'
const MAIN_SCREEN_NOTE =
  "cc-stretch: stretches are open because this session is on Claude Code's main screen, where a printed reply cannot change. " +
  `For clickable stretches, ${FULLSCREEN_HOW}`

// The words a stretch adds are drawn in Claude Code's own theme colours (its 2.1.300 values for
// warning, autoAccept, planMode and claude), mixed 45% toward the text colour so they tint rather
// than shout. Each open stretch keeps its colour; all but the newest take a faded form of it, mixed
// 35% toward the background, quieter but still that colour.
const BASE = {
  dark: [[255, 193, 7], [175, 135, 255], [72, 150, 140], [215, 119, 87]],
  light: [[150, 108, 30], [135, 0, 255], [0, 102, 102], [215, 119, 87]],
}
const mix = (rgb: number[], toward: number, share: number) => rgb.map(v => Math.round(v + (toward - v) * share))
const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
const paletteOf = (base: number[][], text: number, background: number) =>
  base.map(rgb => mix(rgb, text, 0.45)).map(soft => ({ soft: hex(soft), faded: hex(mix(soft, background, 0.35)) }))
const PALETTES = { dark: paletteOf(BASE.dark, 255, 0), light: paletteOf(BASE.light, 0, 255) }
/** How many colours open stretches take in turn. */
const HUES = BASE.dark.length

// Every link the mod draws is answered by the mod: a click opens or closes,
// and the link is never followed. A ctrl- or cmd-click opens it in a browser,
// so it points at a reserved name that resolves nowhere.
const HREF = 'https://cc-stretch.invalid/'

/**
 * A streaming reply's filter state, with what it held and what it was shown as so far; `isWhole` is
 * false for one first seen midway, after the plugin loaded again, whose text so far is not all of it.
 */
type Stream = { state: StreamState; raw: string; shown: string; isWhole: boolean }

/** The letters, in row order: home, top, bottom. */
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm'
// As of Claude Code 2.1.301 a plugin has no chord of its own: a Button naming one of the engine's
// keybinding actions is pressed by that action's chords while no engine handler of it is mounted.
// These two actions scroll the diff panel's file list, bound in its Global context to alt+down and
// ctrl+down, and alt+up and ctrl+up.
const CHORDS: Record<Action, string> = { open: 'app:diffFileListDown', close: 'app:diffFileListUp' }
/** How many of the latest replies on screen holding a stretch take letters. */
const LETTERED_REPLIES = 3
/** How many of the latest replies drawn by Clients are kept, to find the ones that take letters. */
const KEPT_DRAWN_REPLIES = 50

/**
 * A reply drawn by Clients: its text, whether any of its rows are on screen, and its paragraphs that
 * hold a stretch, with each one's state member.
 */
type DrawnReply = { text: string; isOnScreen: boolean; paragraphs: { member: string; text: string }[] }
// Module state, not an atom: as of Claude Code 2.1.301 a render hook cannot write plugin state.
const drawnReplies = new Map<string, DrawnReply>()

/** A reply's text with its whitespace gone, as the site may break and trim its lines. */
const keyOf = (text: string) => text.replace(/\s+/g, '')

// Claude Code 2.1.299 and 2.1.300 hand the AssistantMessage site the reply as the streaming filter
// left it, with its long forms gone. Each filtered reply is kept by what it was shown as, so the
// site can draw it from its markup again; null for one that held no stretch. Replies it could not
// keep, from before the plugin last loaded or whose final flush it did not see whole, are read from the
// session's messages when a draw first finds one missing.
const unfiltered = new Map<string, string | null>()
/** The read of the session's replies into `unfiltered`: undefined until a draw needs it, after a read that failed, and after a reply not kept has finished. */
let sessionKept: Promise<void> | undefined

function remember(raw: string, shown: string): void {
  unfiltered.set(keyOf(shown), raw === shown ? null : raw)
}

/** Sets `key` in `map` as its newest entry, dropping the oldest past `size`. */
function setNewest<V>(map: Map<string, V>, key: string, value: V, size: number): void {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) {
    if (map.size <= size) break
    map.delete(old)
  }
}

/** The text a reply was written with, markup and all, when `text` is how the filter showed it. */
async function rawOf($: EngineInterface, text: string): Promise<string | undefined> {
  const key = keyOf(text)
  if (!unfiltered.has(key)) await (sessionKept ??= keepSession($))
  return unfiltered.get(key) ?? undefined
}

/** Keeps every reply of the session by what the streaming filter shows of it. */
async function keepSession($: EngineInterface): Promise<void> {
  const messages = await $.session.messages().catch(() => undefined)
  if (messages === undefined) {
    sessionKept = undefined
    return
  }
  for (const message of messages) if (message.role === 'assistant') remember(message.text, hideLongForms(message.text, newStreamState()))
}

/** One filter state per streaming message, until its final flush, or until another begins while none of its flushes is pending; null for a message left as written. */
const streams = new Map<string, Stream | null>()
/** Each streaming message's latest flush, which its next one waits for. */
const flushes = new Map<string, Promise<void>>()

type Flush = ClassicEventOf['classic.MessageDisplay']
type Shown = ClassicResultOf['classic.MessageDisplay']
/** A streaming reply's flush with each stretch shown as its short form. */
async function display($: EngineInterface, e: Flush, answer: Shown): Promise<Shown> {
  let stream = streams.get(e.message_id)
  if (stream === undefined) {
    // As of Claude Code 2.1.302 a message that begins abandons any not finished, which then gets no
    // final flush; a finished one may still have flushes on their way.
    if (e.index === 0) for (const id of streams.keys()) if (!flushes.has(id)) streams.delete(id)
    // Seen midway: the plugin loaded again while it streamed, and its last flush left its state.
    const left = e.index === 0 ? undefined : (await read($, streamCheckpoints))[e.message_id]
    // The desktop app draws a finished reply from this display text, so hiding the long forms here
    // would strip the markup its links are made from. Decided on a message's first flush, so a
    // surface that attaches or leaves midway cannot half-filter it.
    if (left !== undefined) stream = left && { state: left, raw: '', shown: '', isWhole: false }
    else stream = (await $.session.surfaces()).includes('desktop') ? null : { state: newStreamState(), raw: '', shown: '', isWhole: e.index === 0 }
    streams.set(e.message_id, stream)
  }

  let displayContent = answer.displayContent
  if (stream !== null) {
    const delta = answer.displayContent ?? e.delta
    displayContent = hideLongForms(delta, stream.state)
    stream.raw += delta
    stream.shown += displayContent
  }
  if (e.final) {
    streams.delete(e.message_id)
    // A reply seen only in part is read from the session's messages when it is drawn.
    if (stream?.isWhole) remember(stream.raw, stream.shown)
    else if (stream !== null) sessionKept = undefined
  }
  await update($, streamCheckpoints, () => Object.fromEntries([...streams].map(([id, kept]) => [id, kept && kept.state])))
  return stream === null ? answer : { ...answer, displayContent }
}

/**
 * Writes the style being tried into the plugin's settings, the ones that differ from `saved`, then
 * drops the try unless a press since made it differ again. A refusal keeps the try and says what was
 * and was not saved. As of Claude Code 2.1.302 the settings land in the person's user settings, keyed
 * `<plugin>.<field>`, and each write reloads the plugin with them.
 */
function saveLook($: EngineInterface, saved: Look): Promise<void> {
  return withClaim($, 'save', async () => {
    // Read when pressed: a mark pressed after the toolbar was last drawn is part of what is saved.
    const tried = storedLook(await read($, pickedLook))
    if (tried === null) return
    const fields: [string, string, string][] = [
      ['marks', marksSetting(tried.marks), marksSetting(saved.marks)],
      ['highlight', tried.highlight, saved.highlight],
    ]
    const written: string[] = []
    for (const [field, value] of fields.filter(([, value, before]) => value !== before)) {
      const result = await $.config.set({ key: `cc-stretch.${field}`, value }).catch((error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) }))
      if (result.deny !== undefined) {
        $.ui.toast(written.length === 0 ? `cc-stretch: the style was not saved: ${result.deny}` : `cc-stretch: ${written.join(' and ')} saved, ${field} not saved: ${result.deny}`)
        return
      }
      written.push(field)
    }
    await update($, pickedLook, stored => (isSameLook(storedLook(stored) ?? saved, tried) ? null : stored))
  })
}

/** Drops the try, unless a save or a close holds the claim: a reset drawn before it began does nothing then. */
async function resetTry($: EngineInterface): Promise<void> {
  if ((await read($, toolbarHolder)) === null) await update($, pickedLook, () => null)
}

/**
 * Puts the toolbar away; a try not saved goes with it, and the reader is told so. It takes the same
 * claim as a save, so a close and a save pressed together never both act on the try.
 */
function closeToolbar($: EngineInterface, saved: Look): Promise<void> {
  return withClaim($, 'close', async () => {
    const [stored] = await Promise.all([read($, pickedLook), update($, toolbarShown, () => false)])
    await update($, pickedLook, () => null)
    const tried = storedLook(stored)
    if (tried !== null && !isSameLook(tried, saved)) $.ui.toast('cc-stretch: the style you tried was not saved')
  })
}

/**
 * Runs a save or a close under the toolbar's one-at-a-time claim, taken before it reads the try and
 * released after, so a second press, or one from a toolbar drawn before the first began, finds the
 * claim held and does nothing.
 */
async function withClaim($: EngineInterface, holder: 'save' | 'close', run: () => Promise<void>): Promise<void> {
  const taken = { isMine: false }
  await update($, toolbarHolder, held => {
    taken.isMine = held === null
    return taken.isMine ? holder : held
  })
  if (!taken.isMine) return
  try {
    await run()
  } finally {
    await update($, toolbarHolder, () => null)
  }
}

export const register: Register = (on, options) => {
  const baseLook = lookOf(options)
  // As of Claude Code 2.1.302, /cc-stretch:style is listed from commands/style.md and answered here;
  // Claude reads the file only when the hooks did not answer. It only shows the toolbar: the band
  // above the prompt has its own [-], which collapses it without the plugin knowing, so a toggle could
  // hide a toolbar the reader no longer sees.
  on('command.run', { command: 'cc-stretch:style' }, async ($, e) => {
    if (!(await $.session.surfaces()).includes('terminal')) return { text: 'The style toolbar is drawn in the terminal, above the prompt; with no terminal attached there is none.' }
    if (!e.presentation.isFullscreen) return { text: `The style toolbar is drawn in fullscreen; on the main screen every stretch is drawn open. To use it, ${FULLSCREEN_HOW}` }
    await update($, toolbarShown, () => true)
    return { text: 'Style toolbar shown above the prompt; close puts it away.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Terminal only: as of Claude Code 2.1.302 the desktop app draws each Button natively, where a highlight swatch has no label.
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, toolbarShown))) return next(e)
    const [stored, holder] = await Promise.all([read($, pickedLook), read($, toolbarHolder)])
    const tried = storedLook(stored)
    const look = tried ?? baseLook
    // Only a try that differs from the saved style leaves anything to reset or save.
    const isTrying = tried !== null && !isSameLook(tried, baseLook)
    // Each press starts from the look as it is now, not as this draw saw it, so quick presses add up.
    const change = (edit: (now: Look) => Partial<Look>) =>
      update($, pickedLook, stored => {
        const now = storedLook(stored) ?? baseLook
        return { ...now, ...edit(now) }
      })
    const toggle = (mark: Mark) => change(now => ({ marks: now.marks.includes(mark) ? now.marks.filter(m => m !== mark) : [...now.marks, mark] }))
    const { Box, Button, Text } = $.ui.resolve(e)
    const chosen = (isOn: boolean, label: string) => (isOn ? <Text bold>[{label}]</Text> : <Text>{label}</Text>)
    // While a save or a close holds the claim nothing is pressable: a press then would race it.
    const pressable = (key: string, onPress: () => unknown, label: RenderNode) =>
      holder !== null ? <Text key={key}>{label}</Text> : <Button plain key={key} onPress={onPress}>{label}</Button>
    const swatch = (c: string) =>
      pressable(`highlight-${c}`, () => change(() => ({ highlight: c })), <Text backgroundColor={c} {...contrastOn(c)}>{look.highlight === c ? '◆◆' : '  '}</Text>)
    const row = (label: string, parts: RenderNode[]) => (
      <Box key={`row-${label}`} flexWrap="wrap" columnGap={1}>
        <Text dimColor>{label.padEnd(9)}</Text>
        {parts}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {row('marks', [
          ...MARK_NAMES.map(mark => pressable(`mark-${mark}`, () => toggle(mark), chosen(look.marks.includes(mark), mark))),
          // A close holds the claim only while the toolbar goes away, so it shows no word.
          ...(holder !== null
            ? holder === 'save' ? [<Text key="saving" dimColor>saving</Text>] : []
            : [
                ...(isTrying
                  ? [
                      <Button plain key="reset" onPress={() => resetTry($)}>reset</Button>,
                      <Button plain key="save" onPress={() => saveLook($, baseLook)}>save</Button>,
                    ]
                  : []),
                <Button plain key="close" onPress={() => closeToolbar($, baseLook)}>close</Button>,
              ]),
        ])}
        {row('highlight', [
          pressable('highlight-none', () => change(() => ({ highlight: '' })), chosen(look.highlight === '', 'no highlight')),
          ...HIGHLIGHTS.map(swatch),
        ])}
      </Box>
    )
  })

  // While a reply streams, Claude Code draws its lines as they arrive, before the reply reaches
  // the AssistantMessage site below. Showing each stretch as its short form there too keeps the
  // raw markup from flashing past. As of Claude Code 2.1.302 up to three flushes of a message run at
  // once and the final one does not wait, so each flush filters after the one before it.
  on('classic.MessageDisplay', ($, e, next) => {
    const before = flushes.get(e.message_id)
    const flush = (async () => {
      try {
        const answer = await next(e)
        await before
        return await display($, e, answer)
      } catch (error) {
        // A reply whose final flush failed is not kept, so the session is read again when it is drawn.
        if (e.final) sessionKept = undefined
        throw error
      }
    })()
    const settled = flush.then(
      () => undefined,
      () => undefined,
    )
    flushes.set(e.message_id, settled)
    void settled.then(() => flushes.get(e.message_id) === settled && flushes.delete(e.message_id))
    return flush
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed

    return {
      sections: [
        ...composed.sections,
        { id: 'cc-stretch:guide', text: GUIDE, scope: 'session' },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)

    const opened = await read($, seen)
    // A stretch that is not a link is drawn open, so it is neither opened nor unopened.
    const written = stretches(parse(lastReply(await $.session.messages())))
      .filter(isLinkable)
      .map(stretch => stretch.short.trim())
    const unopened = written.filter(short => !opened.includes(short))
    await update($, seen, () => [])
    await update($, newestReply, () => '')
    await update($, lettering, () => null)
    if (opened.length === 0 && unopened.length === 0) return next(e)

    const quote = (list: string[]) => list.map(s => `"${s}"`).join(', ')
    // A prompt cannot tell whether the reply was drawn where clicks land, so with no clicks the
    // note names both cases.
    const note =
      opened.length > 0
        ? `Stretchtext: since your last reply the reader opened ${quote(opened)}.${unopened.length > 0 ? ` They did not open ${quote(unopened)}.` : ''}`
        : 'Stretchtext: no click on a stretch of your last reply was recorded. The reader may have read only the short forms; where clicks do not reach the plugin (the classic renderer, apps other than the terminal and the Claude desktop app), every stretch was drawn open.'

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  // The reply that says why stretches are open on the main screen: the first drawn there since the
  // plugin loaded. As of Claude Code 2.1.301 a render hook cannot write plugin state, so it is kept here.
  let notedRequest: string | undefined
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true) return next(e)
    // A stretch still streaming has no closing braces yet; drawing it here keeps the raw markup
    // off the screen until it closes and becomes pressable.
    let text = e.props.text
    let parts = parse(text)
    let all = stretches(parts)
    // Text without a stretch may be a reply the streaming filter already drew short.
    if (all.length === 0) {
      const raw = text.trim() === '' ? undefined : await rawOf($, text)
      if (raw === undefined) return next(e)
      text = raw
      parts = parse(text)
      all = stretches(parts)
      if (all.length === 0) return next(e)
    }

    // The desktop app draws markdown links and hands a press on one to the plugin: the whole block is
    // one Markdown whose closed stretches are links that open in place, each open one ending in a «.
    if (e.surface === 'desktop') {
      const { Markdown } = $.ui.resolve(e)
      const open = memberOf(openStretches, { requestId: `${e.requestId}#desktop` })
      const links: string[] = []
      const text = linkedMarkdown(parts, await read($, open), all, links)
      // Open that stretch, or close it with every stretch inside it. Opening one is what the next
      // prompt reports, as a press in the terminal is.
      const press = async (href: string) => {
        const [action, index] = href.slice(HREF.length).split('/')
        const stretch = all[Number(index)]
        if (stretch === undefined) return
        const { key } = stretch
        if (action === 'close') {
          await update($, open, list => list.filter(k => k !== key && !k.startsWith(key + KEY_SEPARATOR)))
          return
        }
        if (action !== 'open') return
        await update($, open, list => (list.includes(key) ? list : [...list, key]))
        const short = stretch.short.trim()
        await update($, seen, list => (list.includes(short) ? list : [...list, short]))
      }
      return <Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />
    }

    const marker = e.props.isFirstOfReply ? '⏺ ' : '  '
    if (canPress(e)) {
      // A paragraph holding a stretch is drawn by a Client, on the screen's side; the rest is
      // Claude Code's own markdown.
      const { Box, Button, Client, Markdown, Text } = $.ui.resolve(e)
      const [{ order, count }, newest, shown, picked] = await Promise.all([
        read($, memberOf(stretchOrder, { requestId: e.requestId })),
        read($, newestReply),
        read($, lettering),
        read($, pickedLook),
      ])
      const look = storedLook(picked) ?? baseLook
      // The theme matters only once a stretch in this reply is open and so tinted.
      const isLight =
        Object.keys(order).length > 0 &&
        (await $.config.list().catch(() => [])).some(row => row.key === 'theme' && String(row.value).startsWith('light'))
      const palette = isLight ? PALETTES.light : PALETTES.dark
      const paragraphs = paragraphsOf(text).map((paragraph, i) => ({ ...paragraph, key: `paragraph-${i}`, member: `${e.requestId}#paragraph-${i}` }))
      // The terminal says again whether a reply is on screen whenever a scroll changes it; null is off it.
      setNewest(drawnReplies, e.requestId, { text, isOnScreen: e.props.onScreen !== null, paragraphs: paragraphs.filter(p => p.hasStretch) }, KEPT_DRAWN_REPLIES)
      const parts = await Promise.all(
        paragraphs.map(async ({ hasStretch, text, key, member }) => {
          if (!hasStretch) return <Markdown text={text} />
          const [open, ask] = await Promise.all([read($, memberOf(openStretches, { requestId: member })), read($, memberOf(askedStretch, { requestId: member }))])
          const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1, palette)
          const keys = Object.fromEntries((shown?.targets ?? []).filter(one => one.member === member).map(one => [one.key, one.letter]))
          const props: ReplyProps = { text, open, tints, ask, letters: shown === null ? null : { action: shown.action, keys }, look }
          return <Client key={key} module="./reply.tsx" props={props} width="100%" />
        }),
      )
      // On a reply's first row the bullet and the space after it are Buttons: the first puts up the
      // letters that open, or puts them away when they show; the second does the same for those that
      // close. A chord presses them, and so does a click.
      return (
        <Box flexDirection="row">
          {e.props.isFirstOfReply
            ? [
                <Button key="open-letters" plain label="⏺" action={CHORDS.open} onPress={() => void showLetters($, 'open')} />,
                <Button key="close-letters" plain label=" " action={CHORDS.close} onPress={() => void showLetters($, 'close')} />,
              ]
            : <Text>{marker}</Text>}
          <Box flexDirection="column" flexShrink={1} gap={1}>
            {parts}
          </Box>
        </Box>
      )
    }

    // Where a press is not known to land, every stretch is drawn open and nothing is hidden; on the
    // main screen the first such reply says why.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    if (isMainScreen(e)) notedRequest ??= e.requestId
    return (
      <Box flexDirection="row">
        <Text>{marker}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <Markdown text={writeOpen(parts)} />
          {isMainScreen(e) && notedRequest === e.requestId && <Text dimColor>{MAIN_SCREEN_NOTE}</Text>}
        </Box>
      </Box>
    )
  })

  // A paragraph's Client posts the stretches open in it whenever they change, and the one the reader
  // just opened. Kept here, they survive a redraw, reach the next prompt and keep their colours.
  on('ui.message', async ($, e, next) => {
    // Text the reader dragged across in a paragraph, where as of Claude Code 2.1.302 the transcript
    // selects nothing itself.
    const copy = e.module.endsWith('reply.tsx') ? copyOf(e.data) : undefined
    if (copy !== undefined) {
      const copied = await $.ui.copy({ text: copy, surface: e.surface })
      if (!copied.isCopied) $.ui.toast(`cc-stretch: the selection was not copied: ${copied.reason}`)
      return next(e)
    }
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened } = post
    if (opened !== undefined) await update($, seen, list => (list.includes(opened.short) ? list : [...list, opened.short]))

    // Each open stretch keeps the count it was opened at, across the reply's paragraphs; a nested
    // one skips its parent's colour. The newest is the open stretch with the reply's last count.
    const here = `${e.element}#`
    await update($, memberOf(stretchOrder, { requestId: e.requestId }), ({ order, count }) => {
      const kept = Object.fromEntries(Object.entries(order).filter(([at]) => !at.startsWith(here) || post.open.includes(at.slice(here.length))))
      if (opened === undefined) return { order: kept, count }
      const parent = kept[`${here}${parentOf(opened.key)}`]
      const n = parent !== undefined && count % HUES === parent % HUES ? count + 1 : count
      return { order: { ...kept, [`${here}${opened.key}`]: n }, count: n + 1 }
    })
    if (opened !== undefined) await update($, newestReply, () => e.requestId)
    return next(e)
  })

  // While the letters show, the next edit at the prompt puts them away. A key that is one of the
  // letters asks its stretch's paragraph to open or close it, in place as a click does, and is not
  // typed; any other key, including a capital and a letter no stretch has, is typed as usual.
  on('prompt.edit', async ($, e, next) => {
    const shown = await read($, lettering)
    if (shown === null) return next(e)
    await update($, lettering, () => null)
    const typed = e.key?.ctrl === undefined && e.key?.meta === undefined ? e.key?.key : undefined
    const target = shown.targets.find(one => one.letter === typed)
    if (target === undefined) return next(e)
    await update($, memberOf(askedStretch, { requestId: target.member }), last => ({ key: target.key, action: shown.action, n: (last?.n ?? 0) + 1 }))

    return { text: e.text, cursor: e.cursor }
  })

  // A change to the prompt box that is not an edit, such as a recalled history entry or a clear,
  // puts the letters away too.
  on('prompt.change', async ($, e, next) => {
    if ((await read($, lettering)) !== null) await update($, lettering, () => null)
    return next(e)
  })
}

/**
 * Puts up the letters for `action`, or puts them away when they already show for it or no stretch
 * in the latest replies on screen takes one.
 */
async function showLetters($: EngineInterface, action: Action): Promise<void> {
  const shown = await read($, lettering)
  const targets = shown?.action === action ? [] : await lettersFor($, action)
  await update($, lettering, () => (targets.length === 0 ? null : { action, targets }))
}

/**
 * A letter for each of the first 26 stretches `action` can act on in the latest three replies on
 * screen holding a stretch, newest first, in reading order within each. The order is read from the
 * session's messages because Claude Code 2.1.301 draws a reply for the first time when it scrolls
 * into view.
 */
async function lettersFor($: EngineInterface, action: Action): Promise<{ letter: string; member: string; key: string }[]> {
  // With their whitespace gone, no reply is found across two messages joined by a line break.
  const written = (await $.session.messages().catch(() => []))
    .filter(message => message.role === 'assistant' && message.text.includes('{{'))
    .map(message => keyOf(message.text))
    .join('\n')
  const replies = [...drawnReplies.values()]
    .filter(reply => reply.isOnScreen)
    .map(reply => ({ reply, at: written.lastIndexOf(keyOf(reply.text)) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => b.at - a.at)
    .slice(0, LETTERED_REPLIES)
  const paragraphs = replies.flatMap(({ reply }) => reply.paragraphs)
  const targets = await Promise.all(
    paragraphs.map(async ({ member, text }) => {
      const open = await read($, memberOf(openStretches, { requestId: member }))
      return targetsIn(parse(text), open, action).map(stretch => ({ member, key: stretch.key }))
    }),
  )

  return targets.flat().slice(0, LETTERS.length).map((target, i) => ({ ...target, letter: LETTERS.charAt(i) }))
}

/**
 * The tint of each open stretch in one paragraph: its colour by the count it was opened at, faded
 * unless it was opened at `newest`.
 */
function tintsOf(order: Record<string, number>, paragraph: string, newest: number, palette: { soft: string; faded: string }[]): Record<string, Tint> {
  const here = `${paragraph}#`
  return Object.fromEntries(
    Object.entries(order)
      .filter(([at]) => at.startsWith(here))
      .flatMap(([at, n]) => {
        const colours = palette[n % palette.length]
        return colours === undefined ? [] : [[at.slice(here.length), { words: n === newest ? colours.soft : colours.faded, closer: colours.soft }]]
      }),
  )
}

/**
 * A reply as markdown for the desktop: each closed stretch a link, each open one its long form then a
 * «, on a line of its own after a rule or a code fence. A link names its stretch by its place in `all`, not by its key, which can hold any character and
 * run past the 2048 characters a `pressableLinks` entry may have (Claude Code 2.1.295).
 */
function linkedMarkdown(parts: Segment[], open: readonly string[], all: Stretch[], links: string[]): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      if (!isOpenable(part) || part.long === undefined) return part.short
      // A short form over several lines is drawn open, or as written when its long form is empty.
      if (!isLinkable(part)) return part.long.length === 0 ? part.short : linkedMarkdown(part.long, open, all, links)
      const index = all.indexOf(part)
      if (open.includes(part.key)) {
        const close = `${HREF}close/${index}`
        links.push(close)
        return closeAfter(linkedMarkdown(part.long, open, all, links), `[«](${close})`, '\n\n')
      }
      const href = `${HREF}open/${index}`
      links.push(href)
      return `[${labelOf(part.short)}](${href})`
    })
    .join('')
}

/**
 * A short form as link text. Outside code spans, where an escape would show, a link inside it becomes
 * its text and target (the pattern `layout.ts` draws that way in the terminal), and brackets and
 * backslashes are escaped.
 */
function labelOf(short: string): string {
  const plain = (text: string) => text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/([[\]\\])/g, '\\$1')
  let label = ''
  let from = 0
  for (let at = short.indexOf('`'); at !== -1; at = short.indexOf('`', from)) {
    const { stop } = codeSpan(short, at)
    label += plain(short.slice(from, at)) + short.slice(at, stop)
    from = stop
  }

  return label + plain(short.slice(from))
}

/** A reply with every stretch drawn as its long form. */
function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

/** A Client's post, if it is one: the open stretches, and the one just opened. */
function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('short' in opened) || !('key' in opened)) return { open }
  const { short, key } = opened

  return typeof short === 'string' && typeof key === 'string' ? { open, opened: { short, key } } : { open }
}

/** A Client's post of text to copy, if it is one. */
function copyOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('copy' in data)) return undefined
  return typeof data.copy === 'string' && data.copy !== '' ? data.copy : undefined
}

/** The text of the model's last reply: its rows after the person's last prompt. */
function lastReply(messages: SessionMessage[]): string {
  const texts: string[] = []
  for (const message of [...messages].reverse()) {
    if (message.role === 'user' && (message.toolResults?.length ?? 0) === 0 && message.text !== '') break
    if (message.role === 'assistant') texts.unshift(message.text)
  }

  return texts.join('\n')
}

// A press on a Client, or on the tool-call fold's link, is known to land only in the fullscreen
// terminal. In the desktop app (Claude Code 2.1.293) a press on a Client's one-cell « missed, so the
// desktop draws stretches as Markdown links instead (above).
function canPress<E extends Pick<RenderInput, 'surface' | 'viewport'>>(e: E): e is E & { surface: 'terminal' } {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true
}

// The terminal's main screen prints each reply into its scrollback, where nothing can change it.
// Unknown is not the main screen, and the phone app's `false` is not the terminal's.
function isMainScreen(e: Pick<RenderInput, 'surface' | 'viewport'>): boolean {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === false
}

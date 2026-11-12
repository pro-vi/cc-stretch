// Checks hyperlinks in a paragraph that holds a stretch, and a stretch that grows into a link, in a
// live session, as docs/e2e-map.md lists.
// The session runs with a stand-in `open` and `xdg-open` first on its PATH, which write each URL to
// `<outDir>/opened.txt` instead of opening a browser. Claude is told to reply with a fixed sample. Run
// it from a folder Claude Code already trusts. It exits 1 when a step fails.
//   node film/e2e/follow.mjs <package> <outDir>
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { linksOn, parseScreen, plainRows, turnsDone } from '../screen.mjs';
import { sleep, startCheck } from './live.mjs';

const [PLUGIN, out] = process.argv.slice(2);
// Absolute, since the stand-ins' folder goes on PATH and they write there.
const OUT = resolve(out);
const DOCS = 'https://docs.invalid/guide', TOUR = 'https://tour.invalid/start', FORUM = 'https://forum.invalid/thread';
const SAMPLE = `The docs are at ${DOCS} and {{the build is green|the build is green on every platform}}.\n\nRead {{the [tour](${TOUR})|the [tour](${TOUR}), its second part}} next.\n\n{{The forum thread says so|The [forum thread](${FORUM}) says so, twice}}.`;
const APPEND = `This session is a recorded product test. Write in English only, use no tools, and do not end replies with a status block or any closing summary. When the user writes \`sample\`, reply with exactly the text between the lines BEGIN and END, character for character, with nothing before or after it.
BEGIN
${SAMPLE}
END`;
// A wait long enough for a click that should open nothing to have opened something.
const QUIET_MS = 2500;
// SGR mouse report buttons: the left button with alt (8) or ctrl (16) held.
const LEFT = 0, ALT = 8, CTRL = 16;

const BIN = `${OUT}/bin`, OPENED = `${OUT}/opened.txt`;
mkdirSync(BIN, { recursive: true });
writeFileSync(OPENED, '');
for (const name of ['open', 'xdg-open']) {
	writeFileSync(`${BIN}/${name}`, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${OPENED}'\n`);
	chmodSync(`${BIN}/${name}`, 0o755);
}
const opened = () => readFileSync(OPENED, 'utf8').split('\n').filter(Boolean);

const live = startCheck({ plugin: PLUGIN, out: OUT, append: APPEND, env: { PATH: `${BIN}:${process.env.PATH}` } });
const { report, rows, screen, step, submit, text } = live;
const sampleRange = () => live.replyRange(/^[❯>] sample\s*$/);

/** The middle cell of `phrase` in the sample reply, as { row, col }, or undefined. */
function locate(phrase) {
	const [from, end] = sampleRange();
	const r = rows();
	for (let i = from + 1; from >= 0 && i < end; i++) {
		const col = r[i].indexOf(phrase);
		if (col >= 0) return { row: i, col: col + Math.floor(phrase.length / 2) };
	}
	return undefined;
}
/** The middle cell of the hyperlink to `href` in the sample reply, or undefined. */
function linkTo(href) {
	const [from, end] = sampleRange();
	const found = linksOn(screen(), new RegExp(`^${href}$`)).find((x) => x.row > from && x.row < end);
	return found && { row: found.row, col: Math.floor((found.col + found.end) / 2) };
}
const isSelected = () => screen().some((runs) => runs.some((x) => x.inverse && x.text.trim() !== ''));

// The URLs opened before the step's click, so each step sees only what its own click opened.
let before = 0;
const openedSince = () => opened().slice(before).join('|');
/** Clicks the middle of `at` with `button`, waiting out QUIET_MS when `isQuiet`; false when it is not drawn. */
async function clickAt(at, button, isQuiet = false) {
	if (at === undefined) return false;
	before = opened().length;
	await live.click(at.row, at.col, button);
	if (isQuiet) await sleep(QUIET_MS);
	return true;
}

let error;
try {
	live.open();
	await step('reply', 'Claude writes the sample: a URL and a closed stretch, a link inside a short form, then a stretch whose long form links its short form\'s words', async () => {
		if (!(await live.ready())) return false;
		await submit('sample');
	}, () => turnsDone(text()) >= 1 && linkTo(DOCS) !== undefined && linkTo(TOUR) !== undefined && locate('the build is green') !== undefined && locate('its second part') === undefined && locate('The forum thread says so') !== undefined, 300000);

	await step('ctrl-click', 'Ctrl-click the URL: it is opened, and nothing is selected', () => clickAt(linkTo(DOCS), CTRL),
		() => openedSince() === DOCS && !isSelected());

	await step('alt-click', 'Alt-click the URL: it is opened', () => clickAt(linkTo(DOCS), ALT), () => openedSince() === DOCS);

	await step('plain-click', 'Plain click on the URL: nothing is opened, and nothing is selected', () => clickAt(linkTo(DOCS), LEFT, true),
		() => openedSince() === '' && !isSelected());

	await step('ctrl-short-form', 'Ctrl-click the closed stretch: it opens, and no URL is opened', () => clickAt(locate('the build is green'), CTRL),
		() => locate('on every platform') !== undefined && openedSince() === '');

	await step('link-in-short-form', 'Alt-click the link inside a short form: it is opened, and its stretch stays closed', () => clickAt(linkTo(TOUR), ALT, true),
		() => openedSince() === TOUR && locate('its second part') === undefined);

	// The short form holds the link's words plain, and the long form makes them a link. The link is an
	// anchor, so it is whole on every screen of the growth: a label that arrived a word at a time would
	// show its opening bracket first.
	let grown = 0;
	await step('label-grows-whole', 'Click a stretch whose long form links its short form\'s words: the link is drawn, and no screen shows its markup', () => {
		grown = live.frames.length;
		return clickAt(locate('The forum thread says so'), LEFT);
	}, () => locate('twice') !== undefined && linkTo(FORUM) !== undefined
		&& !live.frames.slice(grown).some((frame) => plainRows(parseScreen(frame.screen)).some((row) => /\[forum|thread\]\(/.test(row))));
	report.opened = opened();
} catch (caught) {
	error = caught;
} finally {
	await live.finish(error);
}

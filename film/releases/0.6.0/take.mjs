// Records the two takes of the 0.6.0 film, each a real session asked what cc-stretch is under the
// same added instructions, which tell it what the README and the LICENSE say. `plain` runs without the plugin, in a
// pane tall enough to hold the whole reply, so the film can show all of it at once. `main` runs with
// the plugin: it opens the style toolbar and picks the tinted highlight with no marks, asks, opens
// two stretches of the reply, closes the first, asks which parts were skipped, and then tries other
// styles on the toolbar, back to the one it began with. Nothing is saved, so no setting changes.
// Writes out/releases/0.6.0/take-plain and out/releases/0.6.0/take.
//   node film/releases/0.6.0/take.mjs          both, one after the other
//   node film/releases/0.6.0/take.mjs plain    one of them
import { REPO, sleep, startTake } from '../../recorder.mjs';

const OUT = `${REPO}/film/out/releases/0.6.0`;
// The demo session reads the person's own instructions too; the first sentences keep the take to the
// feature. The rest is what the README and the LICENSE say of the plugin, which Claude would
// otherwise have to guess.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary. '
	+ 'Facts about cc-stretch, for a question about it from someone who has never used it: it is a plugin for Claude Code. With it, Claude\'s replies arrive short, and each marked phrase grows in place when clicked: new words open up around the words already read, which never move. A click on the « after an opened phrase shrinks it back. Claude is told which phrases the reader opened, so it does not assume the rest was read. '
	+ 'The idea is stretchtext, which Ted Nelson described in 1967; it never caught on, because someone had to write every level of a text by hand, which a language model now does. '
	+ 'To install it, run /plugin install cc-stretch --marketplace pro-vi/cc-stretch in a Claude Code session, then /tui fullscreen, because clicks in the terminal need the fullscreen layout. '
	+ '/cc-stretch:style opens a toolbar that changes how the phrases are marked: underlined by default, or bold, italic, one highlight colour, or a tint of its own for each phrase. alt+↓ puts a letter over each phrase, to open it from the keyboard. '
	+ 'Claude writes every level up front, so a reply costs about as many tokens as before: the reader reads less, and does not pay less. It is open source under the MIT licence, at github.com/pro-vi/cc-stretch.';
const QUESTION = 'What is cc-stretch, and how do I use it?';
const FOLLOW_UP = 'Which parts did I skip?';
// The fourth swatch, a deep purple, as the screen reports its background.
const PURPLE = 'rgb(75,59,107)';

async function plain() {
	// 150 rows: at 80 columns a reply of about 1,000 words still fits on one screen.
	const take = await startTake({ out: `${OUT}/take-plain`, append: APPEND, cols: 80, rows: 150, plugin: false });
	try {
		await take.ready();
		await take.ask(QUESTION);
		await sleep(1500);
		take.mark('end');
	} finally {
		await take.finish();
	}
}

async function main() {
	// 60 rows: the reply, what the clicks add to it, the second reply and the toolbar all stay on one
	// screen, so nothing scrolls and every row keeps its place through the take.
	const take = await startTake({ out: `${OUT}/take`, append: APPEND, cols: 80, rows: 60 });
	const lines = () => take.text().split('\n');
	const toolbarRow = (label) => lines().find((r) => r.startsWith(label)) ?? '';
	/** Where `word` sits on the toolbar row that starts with `label`, to click it. */
	function onToolbar(label, word) {
		const rows = lines(), row = rows.findIndex((r) => r.startsWith(label));
		const col = row < 0 ? -1 : rows[row].indexOf(word, label.length);
		if (col < 0) throw new Error(`no "${word}" on the ${label.trim()} row:\n${take.text()}`);
		return { row, col, end: col + word.length };
	}
	/**
	 * Clicks a word on the toolbar, then waits for its row to show it chosen, as `[word]`, or no longer
	 * so, and the screen to be still. Before the first reply the session reads a click as a cell
	 * (Claude Code 2.1.332), which `inCells` sends.
	 */
	async function pressToolbar(name, label, word, { isChosen = true, inCells = false } = {}) {
		await take.click(name, onToolbar(label, word), inCells);
		await take.waitFor(() => toolbarRow(label).includes(`[${word}]`) === isChosen, 10000, `${word} to be ${isChosen ? 'chosen' : 'let go'}`);
		await take.still();
		await sleep(1100);
	}
	// Under the tinted highlight with no marks, a closed stretch is a phrase on a colour of its own,
	// between the question and the toolbar.
	const closed = () => {
		const rows = lines(), from = rows.findIndex((r) => r.startsWith(`❯ ${QUESTION}`)), to = rows.findIndex((r) => r.startsWith('marks '));
		return take.highlighted().filter((p) => p.row > from && p.row < to);
	};
	const isAfter = (p, q) => p.row > q.row || (p.row === q.row && p.col > q.col);
	/** The closed stretches that are items of a list: the row's text before the stretch is only a list marker. */
	const items = () => {
		const rows = lines();
		return closed().filter((p) => /^\s*(?:\d+[.)]|[-•*])\s*$/.test(rows[p.row].slice(0, p.col)));
	};
	try {
		await take.ready();
		// The toolbar stays up through the take: a style it tries is drawn at once and kept while it is open.
		await take.type('/cc-stretch:style');
		await sleep(700);
		take.send('\r');
		await take.waitFor(() => /^highlight\s+\[no highlight\] colour tinted/m.test(take.text()), 15000, 'the toolbar');
		await take.still();
		await pressToolbar('tint', 'highlight ', 'tinted', { inCells: true });
		await pressToolbar('noMarks', 'marks ', 'underline', { isChosen: false, inCells: true });

		await take.ask(QUESTION);
		await sleep(2500);
		if (closed().length < 2) throw new Error(`the reply shows fewer than two tinted stretches:\n${take.text()}`);
		// A list's second item, or the first stretch if the list has none, then the longest stretch after
		// it: among the items when the list has more than two, else among all stretches.
		const list = items();
		const first = list[1] ?? closed()[0];
		await take.click('open1', first);
		await take.settle(1500, 15000);
		await sleep(2200);
		// What the first click added moved the rows under it, so the stretches are read again.
		const later = (list.length > 2 ? items() : closed()).filter((p) => isAfter(p, first));
		const second = later.reduce((best, p) => (p.text.length > best.text.length ? p : best), later[0]);
		if (second === undefined) throw new Error(`no closed stretch after the first one opened:\n${take.text()}`);
		await take.click('open2', second);
		await take.settle(1500, 15000);
		await sleep(2200);
		// The first « on screen closes the first stretch opened, which stands above the second.
		const closer = take.screen().flatMap((runs, row) => runs.filter((run) => run.text.trim() === '«').map((run) => ({ row, col: run.col + run.text.indexOf('«') })))[0];
		if (closer === undefined) throw new Error(`no « on screen:\n${take.text()}`);
		await take.click('close', { ...closer, end: closer.col + 1 });
		await take.settle(1500, 15000);
		await sleep(1800);
		await take.ask(FOLLOW_UP, '2');
		await sleep(2500);

		// Other styles, one click each, and back to the tinted highlight with no marks.
		await pressToolbar('colour', 'highlight ', 'colour');
		const highlightRow = lines().findIndex((r) => r.startsWith('highlight '));
		const purple = take.screen()[highlightRow]?.find((run) => run.bg === PURPLE);
		if (purple === undefined) throw new Error(`no purple swatch on the highlight row:\n${take.text()}`);
		await take.click('swatch', { row: highlightRow, col: purple.col, end: purple.col + 2 });
		await take.settle(600, 10000);
		await sleep(1100);
		await pressToolbar('underline', 'marks ', 'underline');
		await pressToolbar('none', 'highlight ', 'no highlight');
		await pressToolbar('bold', 'marks ', 'bold');
		await pressToolbar('tinted', 'highlight ', 'tinted');
		await pressToolbar('unbold', 'marks ', 'bold', { isChosen: false });
		await pressToolbar('bare', 'marks ', 'underline', { isChosen: false });
		await sleep(1200);
		take.mark('end');
	} finally {
		await take.finish();
	}
}

const only = process.argv[2];
if (only !== undefined && only !== 'plain' && only !== 'main') throw new Error('usage: take.mjs [plain|main]');
if (only !== 'main') await plain();
if (only !== 'plain') await main();

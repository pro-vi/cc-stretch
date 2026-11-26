// Records the two takes of the 0.6.0 film, each a real session asked the same question under the same
// added instructions. `plain` runs without the plugin, in a pane tall enough to hold the whole reply,
// so the film can show all of it at once. `main` runs with the plugin: it opens two steps of the
// reply's plan, closes the first, and asks which parts were skipped. Writes
// out/releases/0.6.0/take-plain and out/releases/0.6.0/take.
//   node film/releases/0.6.0/take.mjs          both, one after the other
//   node film/releases/0.6.0/take.mjs plain    one of them
import { REPO, sleep, startTake } from '../../recorder.mjs';

const OUT = `${REPO}/film/out/releases/0.6.0`;
// The demo session reads the person's own instructions too; these keep the take to the feature.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary.';
const QUESTION = 'How do I move a small Postgres database to a new server with almost no downtime?';
const FOLLOW_UP = 'Which parts did I skip?';

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
	// 60 rows: the reply, what the clicks add to it and the second reply all stay on one screen, so
	// nothing scrolls and every row keeps its place through the take.
	const take = await startTake({ out: `${OUT}/take`, append: APPEND, cols: 80, rows: 60 });
	// pressables() also lists an open stretch's «, which a click would close.
	const isClosed = (p) => p.text.trim() !== '«';
	const isAfter = (p, q) => p.row > q.row || (p.row === q.row && p.col > q.col);
	/** The closed stretches that are steps of a numbered list: the row's text before the stretch is only its number. */
	const steps = () => {
		const rows = take.text().split('\n');
		return take.pressables().filter((p) => isClosed(p) && /^\s*\d+[.)]\s*$/.test(rows[p.row].slice(0, p.col)));
	};
	try {
		await take.ready();
		await take.ask(QUESTION);
		await sleep(2500);
		// The cut shows a plan's steps opening, so a reply without three numbered steps is no take for it.
		if (steps().length < 3) throw new Error(`the reply is not a plan of at least three numbered steps, each a stretch:\n${take.text()}`);
		const first = steps()[1];
		await take.click('open1', first);
		await take.settle(1500, 15000);
		await sleep(2200);
		// What the first click added moved the rows under it, so the steps are read again; the longest of
		// those after the first is opened second.
		const second = steps().filter((p) => isAfter(p, first)).reduce((best, p) => (p.text.length > best.text.length ? p : best));
		await take.click('open2', second);
		await take.settle(1500, 15000);
		await sleep(2200);
		// The first « on screen closes the first step opened, which stands above the second.
		await take.click('close', take.pressables().find((p) => !isClosed(p)));
		await take.settle(1500, 15000);
		await sleep(1800);
		await take.ask(FOLLOW_UP, '2');
		await sleep(2500);
		take.mark('end');
	} finally {
		await take.finish();
	}
}

const only = process.argv[2];
if (only !== undefined && only !== 'plain' && only !== 'main') throw new Error('usage: take.mjs [plain|main]');
if (only !== 'main') await plain();
if (only !== 'plain') await main();

// Records the take of the 0.6.0 film: asks for a plan, whose reply names each step in its short
// forms, then opens two of them, so each grows where it stands with the text after it kept in
// place. Recorded at 80 × 34 cells: 80 columns, so the film can draw its text larger, and enough
// rows that both stretches open without the screen scrolling. Writes out/releases/0.6.0/take.
//   node film/releases/0.6.0/take.mjs
import { REPO, sleep, startTake } from '../../recorder.mjs';

const OUT = `${REPO}/film/out/releases/0.6.0`;
// The demo session reads the person's own instructions too; these keep the take to the feature.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary. Answer in one short paragraph and use a few stretches.';
const QUESTION = 'How do I move a small Postgres database to a new server with almost no downtime?';

const take = await startTake({ out: `${OUT}/take`, append: APPEND, cols: 80, rows: 34 });
// pressables() also lists an open stretch's «, which a click would close.
const isClosed = (p) => p.text.trim() !== '«';
try {
	await take.ready();
	await take.ask(QUESTION);
	await sleep(2500);
	const first = take.pressables().find(isClosed);
	if (first === undefined) throw new Error(`the reply has no stretch:\n${take.text()}`);
	await take.click('open1', first);
	await take.settle(1500, 15000);
	await sleep(2200);
	const closer = take.pressables().find((p) => !isClosed(p));
	const second = closer && take.pressables().find((p) => isClosed(p) && (p.row > closer.row || (p.row === closer.row && p.col > closer.col)));
	if (second === undefined) throw new Error(`no closed stretch after the first one's «:\n${take.text()}`);
	await take.click('open2', second);
	await take.settle(1500, 15000);
	await sleep(2200);
	take.mark('end');
} finally {
	await take.finish();
}

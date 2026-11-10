// Checks the tinted highlight in a live session: the highlight row's three choices, the colour of each
// stretch's place, dim on it, the letters, a stretch opened in its colour, save and close.
//   node film/e2e/tinted.mjs <package> <outDir>
import { ALT_DOWN } from '../recorder.mjs';
import { DEEP, LIGHT_TEXT, TINTS, startCheck } from './live.mjs';

const [PLUGIN, OUT] = process.argv.slice(2);
// The colour each place's words take once open, in the dark palette: the session's theme setting must name it.
const SOFT = ['rgb(255,221,119)', 'rgb(211,189,255)', 'rgb(154,197,192)', 'rgb(233,180,163)'];
const QUESTION = 'In two short paragraphs with two stretches in each, why does a build cache miss? No links, lists or code.';

const live = startCheck({ plugin: PLUGIN, out: OUT });
const { click, closedStretches, press, report, rowIndex, rowText, screen, send, step, submit, text, waitFor } = live;
/** The closed stretches' highlights in reading order, one per stretch: runs of one stretch share it. */
const highlightsInOrder = () => closedStretches().map((s) => s.bg).filter((bg, i, all) => i === 0 || bg !== all[i - 1]);
const swatchesShown = () => screen()[rowIndex('highlight ')]?.some((x) => x.bg === DEEP) ?? false;

let error;
try {
	live.open();
	await step('reply', 'A reply with closed stretches in two paragraphs, underlined: no style saved', async () => {
		if (!(await live.ready())) return false;
		await submit(QUESTION);
	}, () => / · done /.test(text()) && closedStretches().length >= 3 && closedStretches().every((s) => s.underline && s.bg === null), 300000);

	await step('shown', 'The highlight row: no highlight, colour, tinted, and no swatches', () => submit('/cc-stretch:style'), () => /^highlight\s+\[no highlight\] colour tinted\s*$/.test(rowText('highlight ') ?? '') && !swatchesShown());

	await step('colour', 'Colour: the nine swatches appear, and every stretch takes the first', () => press('highlight ', 'colour'),
		() => /\[colour\]/.test(rowText('highlight ') ?? '') && swatchesShown() && closedStretches().every((s) => s.bg === DEEP && s.fg === LIGHT_TEXT));

	await step('tinted', 'Tinted: the swatches go, and each stretch takes the colour of its place', () => press('highlight ', 'tinted'),
		() => {
			const seen = highlightsInOrder();
			// A stretch nested in a closed one takes a place too, so the colours seen may skip one; they
			// start at the first.
			return /\[tinted\]/.test(rowText('highlight ') ?? '') && !swatchesShown() && seen.length >= 3 && seen[0] === TINTS[0] && seen.every((bg) => TINTS.includes(bg));
		});
	report.tintedOrder = highlightsInOrder();

	await step('dim', 'Dim on the tinted highlights: the light text moves toward each one, never the grey', () => press('marks ', 'dim'),
		() => /\[dim\]/.test(rowText('marks ') ?? '') && closedStretches().length > 0 && closedStretches().every((s) => TINTS.includes(s.bg) && s.fg !== LIGHT_TEXT && !s.dim));
	await press('marks ', 'dim');
	await waitFor(() => !/\[dim\]/.test(rowText('marks ') ?? ''), 8000);

	// alt+down puts up the letters that open; pressed again it puts them away.
	await step('letters', 'Letters up: each letter on its own colour, the rest of each short form keeps its tinted highlight', () => send(ALT_DOWN),
		() => {
			const runs = closedStretches();
			const letters = runs.filter((s) => s.text.trim().length === 1 && !TINTS.includes(s.bg));
			const rests = runs.filter((s) => s.text.trim().length > 1);
			return letters.length >= 3 && rests.length >= 3 && rests.every((s) => TINTS.includes(s.bg));
		});
	send(ALT_DOWN);
	await waitFor(() => closedStretches().every((s) => TINTS.includes(s.bg)), 8000);

	let place = -1;
	await step('open-second', 'The second stretch opened first: its words and « take the colour its highlight had', async () => {
		const second = closedStretches().find((s) => s.bg !== TINTS[0]);
		if (!second) return false;
		place = TINTS.indexOf(second.bg);
		await click(second.row, second.col + 1);
	}, () => {
		const closer = screen().flatMap((runs) => runs).find((x) => x.text.trim() === '«');
		return place > 0 && closer !== undefined && closer.fg === SOFT[place] && closer.bg === null;
	});
	report.openedPlace = place;

	await step('save', 'Save: tinted is written to the settings, and the toolbar shows it saved', () => press('marks ', 'save'),
		() => live.savedOptions()?.highlight === 'tinted' && /\[tinted\]/.test(rowText('highlight ') ?? '') && !/save/.test(rowText('marks ') ?? ''), 25000);
	report.savedOptions = live.savedOptions();

	await step('close', 'Close: the toolbar goes, the stretches keep their tinted highlights', () => press('marks ', 'close'),
		() => rowText('marks ') === undefined && highlightsInOrder().length > 0 && highlightsInOrder().every((bg) => TINTS.includes(bg)));
} catch (caught) {
	error = caught;
} finally {
	await live.finish(error);
}

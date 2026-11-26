// Reads a terminal screen as `wezterm cli get-text --escapes` writes it (as of WezTerm
// 20260905-195314-b99b1ca2): text with SGR colour codes, truecolor written with colons
// (`38:2::r:g:b`), and OSC 8 hyperlinks. Returns rows of styled runs, each with the column it
// starts at, so a renderer can place every run exactly and a driver can find what to click or type:
// a link, an underlined phrase, a highlighted phrase, a keyboard letter.

/** @typedef {{ fg: string | null, bg: string | null, bold: boolean, dim: boolean, italic: boolean, underline: boolean, inverse: boolean }} Style */
/** @typedef {Style & { text: string, col: number, link: string | null }} Run */

const BASIC = ['#1d1f21', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
	'#5c6370', '#ff7b86', '#b5e890', '#ffd68a', '#82c4ff', '#e09cff', '#7fd7e0', '#ffffff'];

/** @returns {Style} */
const plain = () => ({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });

function indexed(n) {
	if (n < 16) return BASIC[n];
	if (n < 232) {
		const v = [0, 95, 135, 175, 215, 255];
		const k = n - 16;
		return `rgb(${v[Math.floor(k / 36)]},${v[Math.floor(k / 6) % 6]},${v[k % 6]})`;
	}
	const g = 8 + (n - 232) * 10;
	return `rgb(${g},${g},${g})`;
}

/** Applies one SGR parameter string to `style`. */
function applySgr(style, params) {
	const parts = params === '' ? ['0'] : params.split(';');
	for (let i = 0; i < parts.length; i++) {
		const sub = parts[i].split(':').map((x) => (x === '' ? null : Number(x)));
		const code = sub[0] ?? 0;
		const colour = (target) => {
			// `38:2::r:g:b` or `38:2:r:g:b` in one part, or `38;2;r;g;b` / `38;5;n` across parts.
			if (sub.length > 1) {
				if (sub[1] === 5) style[target] = indexed(sub[2] ?? 0);
				if (sub[1] === 2) { const [r, g, b] = sub.slice(-3); style[target] = `rgb(${r},${g},${b})`; }
				return;
			}
			const mode = Number(parts[i + 1]);
			if (mode === 5) { style[target] = indexed(Number(parts[i + 2])); i += 2; }
			if (mode === 2) { style[target] = `rgb(${parts[i + 2]},${parts[i + 3]},${parts[i + 4]})`; i += 4; }
		};
		if (code === 0) Object.assign(style, plain());
		else if (code === 1) style.bold = true;
		else if (code === 2) style.dim = true;
		else if (code === 3) style.italic = true;
		else if (code === 4) style.underline = sub[1] !== 0;
		else if (code === 7) style.inverse = true;
		else if (code === 22) { style.bold = false; style.dim = false; }
		else if (code === 23) style.italic = false;
		else if (code === 24) style.underline = false;
		else if (code === 27) style.inverse = false;
		else if (code >= 30 && code <= 37) style.fg = BASIC[code - 30];
		else if (code === 38) colour('fg');
		else if (code === 39) style.fg = null;
		else if (code >= 40 && code <= 47) style.bg = BASIC[code - 40];
		else if (code === 48) colour('bg');
		else if (code === 49) style.bg = null;
		else if (code >= 90 && code <= 97) style.fg = BASIC[code - 90 + 8];
		else if (code >= 100 && code <= 107) style.bg = BASIC[code - 100 + 8];
		else if (code === 58 || code === 59) { if (code === 58 && sub.length === 1) i += Number(parts[i + 1]) === 5 ? 2 : 4; }
	}
}

/** Cells a character takes: two for wide East Asian characters and most emoji, else one. */
export function cellWidth(ch) {
	const c = ch.codePointAt(0) ?? 0;
	return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
		(c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
		(c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) ? 2 : 1;
}

/** Cells a run of text takes. */
const textWidth = (text) => [...text].reduce((n, ch) => n + cellWidth(ch), 0);

/** @param {string} text @returns {Run[][]} */
export function parseScreen(text) {
	const rows = [];
	const style = plain();
	let link = null;
	for (const line of text.replace(/\r?\n$/, '').split(/\r?\n/)) {
		/** @type {Run[]} */
		const runs = [];
		let col = 0, buf = '', start = 0;
		const flush = () => { if (buf !== '') runs.push({ text: buf, col: start, link, ...style }); buf = ''; };
		for (let i = 0; i < line.length;) {
			if (line[i] === '\x1b') {
				const rest = line.slice(i);
				const sgr = /^\x1b\[([0-9;:]*)m/.exec(rest);
				if (sgr) { flush(); applySgr(style, sgr[1]); i += sgr[0].length; continue; }
				const osc8 = /^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/.exec(rest);
				if (osc8) { flush(); link = osc8[1] === '' ? null : osc8[1]; i += osc8[0].length; continue; }
				const other = /^\x1b(?:[()*+][0-9A-Za-z]|\[[0-9;:?<>=]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/.exec(rest);
				i += other ? other[0].length : 1;
				continue;
			}
			const ch = String.fromCodePoint(line.codePointAt(i) ?? 32);
			if (buf === '') start = col;
			buf += ch;
			col += cellWidth(ch);
			i += ch.length;
		}
		flush();
		rows.push(runs);
	}
	return rows;
}

// A row that reports the account's usage limits is personal, not part of what is shown, so renderers
// blank it. That includes a status line's five-hour and seven-day windows, such as `12m/5h 10%` and
// `2d/7d 10%`.
export const PRIVATE = /weekly limit|usage limit|resets .* at \d|\/usage|\/5h\b|\/7d\b/i;
// As of WezTerm 20260905-195314-b99b1ca2, a user-variable sequence written while the pane draws can
// land in its cells as text, on the composer's border, pushing the border's end onto the next row.
export const LEAK = /\uFFFD?\]1337;SetUserVar=\S*?=+[A-Za-z0-9+/]*=*/;

/** How many turns a screen's text shows finished: as of Claude Code 2.1.302 each ends with a line such as `✻ Baked for 15s · done 12:09 AM`. */
export const turnsDone = (text) => (text.match(/ · done /g) ?? []).length;

/** The screen's plain text, one string per row. */
export function plainRows(rows) {
	return rows.map((runs) => {
		let out = '';
		for (const run of runs) { out = out.padEnd(run.col, ' ') + run.text; }
		return out;
	});
}

/**
 * The first row of a screen that follows an empty row and starts with text in a style carried from
 * above, or -1. As of WezTerm 20260905-195314-b99b1ca2, get-text writes a row of plain spaces as
 * nothing and leaves out the reset to plain after it (`Line::changes` drops the row's one change of
 * style, while `lines_to_escapes` goes on as if it had been written), so the style such a row seems to
 * have may not be drawn: only a read that starts at the row shows its own.
 */
export function firstCarriedRow(text) {
	const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
	return parseScreen(text).findIndex((runs, i) => lines[i - 1] === '' && !lines[i].startsWith('\x1b') &&
		runs[0] !== undefined && Object.entries(plain()).some(([key, value]) => runs[0][key] !== value));
}

/** Every link on screen whose target matches `pattern`, with the row and the columns it covers. */
export function linksOn(rows, pattern) {
	const found = [];
	rows.forEach((runs, row) => {
		for (const run of runs) {
			if (run.link === null || !pattern.test(run.link)) continue;
			const last = found.at(-1);
			const width = textWidth(run.text);
			if (last && last.link === run.link && last.row === row && last.end === run.col) last.end += width;
			else found.push({ link: run.link, row, col: run.col, end: run.col + width, text: run.text });
		}
	});
	return found;
}

/**
 * Every phrase on screen that carries a mark: markOf gives a run's mark, or null. Adjacent runs of one
 * mark on a row join, and so does a phrase that ends its row with one of the same mark that starts the
 * next: a short form wrapped in two. A phrase keeps the row and columns of its first part, where a
 * click lands.
 */
function phrasesOn(rows, markOf) {
	const found = [];
	// The row whose text ended in a marked phrase, which a first run of that mark on the next row continues.
	let endedRow = -1;
	rows.forEach((runs, row) => {
		const textRuns = runs.filter((run) => run.text.trim() !== '');
		textRuns.forEach((run, i) => {
			const mark = markOf(run);
			if (mark !== null) {
				const last = found.at(-1);
				if (i === 0 && last && endedRow === row - 1 && last.mark === mark) last.text += ` ${run.text.trimStart()}`;
				else if (last && last.row === row && last.end === run.col && last.mark === mark) { last.end += textWidth(run.text); last.text += run.text; }
				else found.push({ row, col: run.col, end: run.col + textWidth(run.text), text: run.text, mark });
			}
			if (i === textRuns.length - 1) endedRow = mark === null ? -1 : row;
		});
	});
	return found;
}

/**
 * Every underlined phrase on screen, which is what a press acts on in the reply region the plugin
 * draws under its default style: a closed stretch's short form, or an open one's «.
 */
export const pressablesOn = (rows) => phrasesOn(rows, (run) => (run.underline ? 'underline' : null));

/**
 * Every phrase on a background colour, each colour apart. Under the plugin's tinted highlight a closed
 * stretch's short form is one; so is a prompt the person sent, which Claude Code 2.1.332 draws on
 * grey, so a caller keeps to the rows it means.
 */
export const highlightedOn = (rows) => phrasesOn(rows, (run) => run.bg);

/** The keyboard letters on screen: a bold lowercase letter on a coloured background, with its cell. */
export function lettersOn(rows) {
	const found = [];
	rows.forEach((runs, row) => {
		for (const run of runs) {
			const letter = run.text.trimEnd();
			const bg = run.inverse ? run.fg : run.bg;
			if (run.bold && bg !== null && /^[a-z]$/.test(letter)) found.push({ letter, row, col: run.col });
		}
	});
	return found;
}

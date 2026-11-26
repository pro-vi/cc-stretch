// What every film page shares: the frame's geometry and easing, the recorded take's frames, the
// terminal drawn cell by cell from them, the camera on it, Clawd, a sentence that stretches, and the
// cards. A film page loads this before its own script; compose.mjs injects window.TAKE before the
// first frame, and for a release film window.TAKES, every take its cut names.
const W = 1920, H = 1080, CELL_W = 14.4, CELL_H = 33;
// The terminal window around its rows, as kit.css draws it: the title bar's height, and the margins
// above, beside and below the rows.
const BAR = 46, PAD_TOP = 14, PAD_SIDE = 18, PAD_FOOT = 18;
// The recorded pane's size in cells, set by setTermSize below: 100 × 30 unless the take was recorded
// at another size. Variables, not constants, though written in capitals as film.html reads ROWS.
let COLS, ROWS, TERM_W, TERM_H;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (k) => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, a, b) => clamp((t - a) / (b - a));
const $ = (id) => document.getElementById(id);

function frameAt(takeT, take = window.TAKE) {
	const f = take.frames;
	let lo = 0, hi = f.length - 1;
	while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t <= takeT) lo = mid; else hi = mid - 1; }
	return f[lo];
}

/**
 * A recorded growth shows each distinct screen it captured for the same share of the first
 * GROWTH seconds, whatever the gaps between captures were, then plays the rest of the take.
 */
const GROWTH = 1.1;
function evenFrame(seg, local) {
	seg.steps ??= window.TAKE.frames.filter((f) => f.t >= seg.from && f.t <= seg.from + 1.8);
	if (seg.steps.length === 0 || local >= GROWTH) return frameAt(Math.max(seg.from + 1.8, lerp(seg.from, seg.to, local / (seg.b - seg.a))));
	return seg.steps[Math.min(seg.steps.length - 1, Math.floor((local / GROWTH) * seg.steps.length))];
}

// --- drawing helpers -------------------------------------------------------------------------
// The block elements as rectangles of a cell: [x, y, width, height] in fractions of the cell.
const UL = [0, 0, .5, .5], UR = [.5, 0, .5, .5], LL = [0, .5, .5, .5], LR = [.5, .5, .5, .5];
const QUADS = {
	'█': [[0, 0, 1, 1]], '▀': [[0, 0, 1, .5]], '▄': [[0, .5, 1, .5]], '▌': [[0, 0, .5, 1]], '▐': [[.5, 0, .5, 1]],
	'▘': [UL], '▝': [UR], '▖': [LL], '▗': [LR], '▚': [UL, LR], '▞': [UR, LL],
	'▛': [UL, UR, LL], '▜': [UL, UR, LR], '▙': [UL, LL, LR], '▟': [UR, LL, LR],
};
// The box-drawing characters of a table's border, as the arms each has from its cell's middle: up, down, left, right.
const ARMS = { '─': 'lr', '│': 'ud', '┌': 'dr', '┐': 'dl', '└': 'ur', '┘': 'ul', '├': 'udr', '┤': 'udl', '┬': 'dlr', '┴': 'ulr', '┼': 'udlr' };
// Each arm as a rectangle of its cell, LINE pixels thick: [x, y, width, height].
const LINE = 2;
const ARM = {
	u: [(CELL_W - LINE) / 2, 0, LINE, (CELL_H + LINE) / 2], d: [(CELL_W - LINE) / 2, (CELL_H - LINE) / 2, LINE, (CELL_H + LINE) / 2],
	l: [0, (CELL_H - LINE) / 2, (CELL_W + LINE) / 2, LINE], r: [(CELL_W - LINE) / 2, (CELL_H - LINE) / 2, (CELL_W + LINE) / 2, LINE],
};
/** Draws a take's frame in the terminal. */
const drawRows = (frame) => rowsInto($('rows'), frame.rows);
/**
 * Draws screen rows into `host`, an element of class rows or the terminal's own, unless it already
 * shows them. With `isBordered`, the box-drawing characters of a table's border are drawn as lines
 * that meet from cell to cell, as a terminal draws them, not as glyphs a font leaves gaps between.
 */
function rowsInto(host, rows, isBordered = false) {
	if (host.shownRows === rows) return;
	host.shownRows = rows;
	host.innerHTML = '';
	rows.forEach((runs, r) => {
		const row = document.createElement('div');
		row.className = 'row';
		row.style.top = `${r * CELL_H}px`;
		for (const run of runs) {
			// Block characters are cell shapes, as a terminal draws them, not glyphs a font leaves gaps around.
			if ([...run.text].some((ch) => QUADS[ch] !== undefined || (isBordered && ARMS[ch] !== undefined))) {
				let col = run.col;
				for (const ch of run.text) {
					const quads = QUADS[ch];
					if (isBordered && ARMS[ch] !== undefined) {
						for (const arm of ARMS[ch]) {
							const [x, y, w, h] = ARM[arm];
							const b = document.createElement('i');
							b.style.cssText = `position:absolute;left:${col * CELL_W + x}px;top:${y}px;width:${w}px;height:${h}px;background:${run.fg ?? 'var(--term-fg)'}`;
							row.appendChild(b);
						}
					} else if (quads !== undefined) {
						for (const [qx, qy, qw, qh] of quads) {
							const b = document.createElement('i');
							b.style.cssText = `position:absolute;left:${(col + qx) * CELL_W}px;top:${qy * CELL_H}px;width:${qw * CELL_W + 1.2}px;height:${qh * CELL_H + 1.2}px;background:${run.fg ?? 'var(--term-fg)'}`;
							row.appendChild(b);
						}
					} else if (ch !== ' ') {
						const g = document.createElement('span');
						g.textContent = ch;
						g.style.left = `${col * CELL_W}px`;
						g.style.color = run.fg ?? 'var(--term-fg)';
						row.appendChild(g);
					}
					col += 1;
				}
				continue;
			}
			const s = document.createElement('span');
			s.textContent = run.text;
			s.style.left = `${run.col * CELL_W}px`;
			let fg = run.fg ?? 'var(--term-fg)', bg = run.bg;
			if (run.inverse) [fg, bg] = [bg ?? 'var(--term)', run.fg ?? 'var(--term-fg)'];
			s.style.color = fg;
			if (bg) s.style.background = bg;
			if (run.bold) s.style.fontWeight = '700';
			if (run.dim) s.style.opacity = '.55';
			if (run.italic) s.style.fontStyle = 'italic';
			if (run.underline) s.style.textDecoration = 'underline';
			row.appendChild(s);
		}
		host.appendChild(row);
	});
}
/** Draws the terminal at the size its take was recorded at, in cells. */
function setTermSize(cols, rows) {
	COLS = cols;
	ROWS = rows;
	TERM_W = COLS * CELL_W + 2 * PAD_SIDE;
	TERM_H = ROWS * CELL_H + BAR + PAD_TOP + PAD_FOOT;
	$('term').style.width = `${TERM_W}px`;
	$('rows').style.width = `${COLS * CELL_W}px`;
	$('rows').style.height = `${ROWS * CELL_H}px`;
}
setTermSize(100, 30);
/** The scale at which the whole terminal fits the frame under the caption. */
const termFit = () => Math.min((W - 160) / TERM_W, (H - 230) / TERM_H);
/** The zoom placeTerm takes to draw the terminal at `s` frame pixels to one of its own. */
const zoomFor = (s) => s / termFit();
function placeTerm(zoom, focusRow, lift = 0) {
	const s = termFit() * zoom;
	const cx = W / 2, cy = 190 + (H - 190) / 2 + lift;
	const fy = BAR + PAD_TOP + focusRow * CELL_H;
	const x = cx - (TERM_W / 2) * s;
	const y = zoom > 1 ? cy - fy * s : cy - (TERM_H / 2) * s;
	$('term-wrap').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
	return { x, y, s };
}
function cellToScreen(cam, row, col) {
	return { x: cam.x + (PAD_SIDE + (col + 0.5) * CELL_W) * cam.s, y: cam.y + (BAR + PAD_TOP + (row + 0.6) * CELL_H) * cam.s };
}

/** The colour of each sprite pixel that is not Clawd's body: its eyes, and a drop of sweat. */
const PIXEL = { K: '#1f1e1b', B: '#6cb4ee' };
const SPRITE = {
	idle: ['..XXXXXXXXXX..', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	walk: ['..XXXXXXXXXX..', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '...X.X..X.X...', '...X.X..X.X...'],
	blink: ['..XXXXXXXXXX..', '..XXXXXXXXXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	wave: ['..XXXXXXXXXX.X', '..XXKXXXXKXX.X', '..XXKXXXXKXXXX', 'XXXXXXXXXXXX..', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	sweat: ['..XXXXXXXXXX.B', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
};
function drawClawd(c) {
	const el = $('clawd');
	if (!c) { el.style.opacity = 0; return; }
	const ctx = el.getContext('2d');
	ctx.clearRect(0, 0, 14, 8);
	SPRITE[c.pose].forEach((line, y) => [...line].forEach((p, x) => {
		if (p === '.') return;
		ctx.fillStyle = PIXEL[p] ?? '#d97757';
		ctx.fillRect(x, y, 1, 1);
	}));
	el.style.opacity = c.alpha ?? 1;
	el.style.width = `${14 * c.px}px`;
	el.style.height = `${8 * c.px}px`;
	el.style.transform = `translate(${c.x}px, ${c.y}px) scaleX(${c.flip ? -1 : 1}) rotate(${c.rot ?? 0}deg)`;
}
// --- Clawd as SVG, so a scene can squash, stretch and tint as many of it as it likes ----------------

/**
 * Clawd's pixels as an SVG string, `px` screen pixels to a sprite pixel, standing with its feet at
 * (x, y + 8 × px). It squashes and stretches about its feet, so it stays on the ground it stands on.
 */
function clawdSvg({ pose = 'idle', colour = '#d97757', px = 14, x = 0, y = 0, sx = 1, sy = 1 }) {
	const cells = SPRITE[pose].flatMap((line, row) => [...line].flatMap((p, col) => (p === '.' ? [] : [`<rect x="${col}" y="${row}" width="1.02" height="1.02" fill="${PIXEL[p] ?? colour}"/>`])));
	return `<svg viewBox="0 0 14 8" width="${14 * px}" height="${8 * px}" shape-rendering="crispEdges" style="position:absolute;left:${x}px;top:${y}px;overflow:visible;transform-origin:50% 100%;transform:scale(${sx.toFixed(3)},${sy.toFixed(3)})">${cells.join('')}</svg>`;
}

/** A shape squashed (sy < 1) or stretched (sy > 1) that keeps about the area it covers. */
const keepArea = (sy) => ({ sy, sx: 1 / sy ** 0.85 });

/**
 * One of a run of hops of `period` seconds that began at time 0: how high above the ground, and how
 * squashed (sy < 1, wider) or stretched (sy > 1, narrower) by how fast it moves. It is squashed most
 * as it lands, and the area it covers stays about the same.
 */
function hop(t, period, height) {
	if (t < 0) return { lift: 0, sx: 1, sy: 1 };
	const p = (t % period) / period, GROUND = 0.09, SQUASH = 0.3, STRETCH = 0.22;
	const contact = Math.min(p, 1 - p);
	if (contact < GROUND) return { lift: 0, ...keepArea(lerp(1 - SQUASH, 1 + STRETCH, contact / GROUND)) };
	const q = (p - GROUND) / (1 - 2 * GROUND);
	return { lift: height * 4 * q * (1 - q), ...keepArea(1 + STRETCH * Math.abs(1 - 2 * q) ** 2) };
}

/** A spring let go `t` seconds ago at `from`, ringing down onto `to`. */
function spring(t, from, to, freq = 2.4, damping = 4.2) {
	if (t <= 0) return from;
	return to + (from - to) * Math.exp(-damping * t) * Math.cos(2 * Math.PI * freq * t);
}

/**
 * Pulled from its own shape to (sx, sy) between `from` and `full` seconds, held there, and let go at
 * `go` to ring back: a stretch opening and snapping shut.
 */
function pulled(t, { from, full, go, sx, sy, freq, damping }) {
	if (t < go) { const k = ease(span(t, from, full)); return { sx: lerp(1, sx, k), sy: lerp(1, sy, k) }; }
	return { sx: spring(t - go, sx, 1, freq, damping), sy: spring(t - go, sy, 1, freq, damping) };
}

// --- a sentence that stretches ------------------------------------------------------------------
// As Nelson's 1970 article has it: "Gaps appear between phrases; new words and phrases pop into the
// gaps, an item at a time." The sentence stays real flowing text: each new word opens from no width
// to its own, so the browser lays the line out again every frame and the words already there are
// pushed along. The element that holds it has the class stretching (kit.css).
// The typewriter face of the 1967 page, and the heavier one its new words are set in, as in Dream Machines.
const TYPED = `400 58px/1.5 'Courier Prime', Courier, monospace`, TYPED_NEW = `700 58px/1.5 'Courier Prime', Courier, monospace`;
const bareWord = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
const PLANS = new Map();
/**
 * The words of a [short, long] pair in reading order: kept, new (in the long form only) or old (in
 * the short form only), each with the width it has set in `font`, a new word in `newFont`, and a new
 * word with the share of the stretch at which it starts to open: those beside a kept word first.
 */
function planOf([short, long], font, newFont) {
	const key = [font, newFont, short, long].join('|');
	if (PLANS.has(key)) return PLANS.get(key);
	const units = (text) => text.match(/\S+\s*/g) ?? [];
	const S = units(short), L = units(long);
	const a = S.map(bareWord), b = L.map(bareWord);
	const n = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) n[i][j] = a[i] === b[j] ? n[i + 1][j + 1] + 1 : Math.max(n[i + 1][j], n[i][j + 1]);
	const plan = [];
	let i = 0, j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) { plan.push({ kind: 'kept', text: L[j] }); i++; j++; }
		else if (j < b.length && (i >= a.length || n[i][j + 1] >= n[i + 1][j])) { plan.push({ kind: 'new', text: L[j] }); j++; }
		else { plan.push({ kind: 'old', text: S[i] }); i++; }
	}
	// A new word's turn: 1 beside a kept word, more the further it sits from every kept word.
	plan.forEach((u, k) => {
		if (u.kind !== 'new') return;
		let d = 1;
		while (plan[k - d]?.kind !== 'kept' && plan[k + d]?.kind !== 'kept' && (k - d >= 0 || k + d < plan.length)) d++;
		u.turn = d;
	});
	const last = Math.max(1, ...plan.map((u) => u.turn ?? 0));
	for (const u of plan) if (u.kind === 'new') u.start = 0.6 * ((u.turn - 1) / last);
	const gauge = document.createElement('span');
	gauge.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre';
	$('stage').appendChild(gauge);
	for (const u of plan) {
		gauge.style.font = u.kind === 'new' ? newFont : font;
		gauge.textContent = u.text;
		u.width = gauge.getBoundingClientRect().width;
	}
	gauge.remove();
	PLANS.set(key, plan);
	return plan;
}
/** How open a plan's new word is when the whole stretch is `p` of the way open. */
const openAt = (u, p) => ease(clamp((p - u.start) / 0.4));
/**
 * A [short, long] pair `p` of the way from its short form to its long form, as HTML for a stretching
 * element whose font is `font`: a new word is a span of class new set in `newFont`, with `newStyle`
 * added, and a word only the short form has a span of class old, which closes as the stretch begins.
 */
function stretched(pair, p, font, newFont, newStyle = '') {
	if (p <= 0) return pair[0];
	const plan = planOf(pair, font, newFont);
	return plan.map((u) => {
		if (u.kind === 'kept') return `<span>${u.text}</span>`;
		const q = u.kind === 'old' ? 1 - ease(clamp(p / 0.3)) : openAt(u, p);
		if (q <= 0) return '';
		return `<span class="${u.kind}" style="width:${(u.width * q).toFixed(2)}px;opacity:${q.toFixed(3)};${u.kind === 'new' ? `font:${newFont};${newStyle}` : ''}">${u.text}</span>`;
	}).join('');
}

function bubble(text, x, y, alpha) {
	const b = $('bubble');
	b.textContent = text;
	b.style.opacity = alpha;
	b.style.transform = `translate(${x}px, ${y}px)`;
}
function show(id, alpha) { $(id).style.opacity = alpha; }
/** Sets an element's HTML, leaving it alone when it already holds it. */
function setHtml(el, html) {
	if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
}
function card(html, cls = '') {
	setHtml($('card'), html);
	$('card').className = `layer ${cls}`;
}
/** The caption over the terminal: one line, and a small one under it. */
function setCaption(big, small) {
	setHtml($('caption'), `${big}<small>${small || '&nbsp;'}</small>`);
	$('caption').style.opacity = 1;
}

const loads = [];
function setImage(target, src) {
	const img = typeof target === 'string' ? $(target) : target;
	if (img.getAttribute('src') === src) return;
	img.setAttribute('src', src);
	loads.push(img.decode().catch(() => {}));
}

/** When a press shows in the take: the first frame after take second `t`, less 0.15 s. */
const changed = (t) => (window.TAKE.frames.find((f) => f.t > t)?.t ?? t) - 0.15;

/**
 * The pointer travels to each click, given in the frame's pixels, and a ring spreads where it lands.
 * It takes a second on the way, or the click's own `travel`: clicks less than 1.45 s apart need a
 * shorter one, as the pointer leaves only once the ring of the click before has spread.
 */
function pointTo(clicks, t) {
	const next = clicks.find((c) => t <= c.at + 0.35);
	const prev = [...clicks].reverse().find((c) => t > c.at + 0.35);
	const travel = next?.travel ?? 1;
	if (!next || t <= next.at - 0.3 - travel) {
		$('pointer').style.opacity = 0;
		$('ring').style.opacity = 0;
		return;
	}
	const from = prev ?? { x: W - 260, y: H - 120 };
	const k = ease(span(t, next.at - 0.1 - travel, next.at - 0.1));
	$('pointer').style.opacity = 1;
	$('pointer').style.transform = `translate(${lerp(from.x, next.x, k) - 6}px, ${lerp(from.y, next.y, k) - 4}px)`;
	const r = span(t, next.at, next.at + 0.35);
	$('ring').style.opacity = r > 0 && r < 1 ? 1 - r : 0;
	$('ring').style.transform = `translate(${next.x}px, ${next.y}px) scale(${0.4 + r})`;
}

/** Resolves once the frame's images have decoded, its fonts loaded, and the page painted it twice. */
async function endFrame() {
	await Promise.all(loads);
	await document.fonts.ready;
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

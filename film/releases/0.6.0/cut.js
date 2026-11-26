// The 0.6.0 film, for people who know the plugin from its launch film: what this release changed.
// A title, then three changes, each on screen: phrases that say their point before a click, on a
// card and in a reply that explains the plugin; an opening that starts from what was on screen, as
// two phrases of that reply open and one closes; and a table in a stretch, as release 0.5.6 drew it
// and as it is drawn now. Claude is asked which parts were skipped between the second change and
// the third, the style toolbar then tries other marks, and the end card gives the install and
// update commands. compose.mjs --release=0.6.0 loads it into release.html with take.mjs's three takes.
(() => {
	const COPY = {
		kicker: 'What’s new in',
		title: 'cc-stretch 0.6.0',
		titleSmall: 'Three changes you can see.',
		newKicker: 'New in 0.6.0 · 1 of 3',
		named: 'Phrases now say something before you click.',
		beforeBadge: 'Before',
		afterBadge: 'Now',
		// An illustration, not footage: a short form that only announces what the take's own one states.
		beforeLabel: ['A note on cost.'],
		before: 'Sometimes only a label',
		after: 'The point itself, in a few words',
		trial: 'Over two weeks of real sessions, half on each guide, with a model judging every phrase in view:<br>phrases that were only a label fell from 11% to 3% with Opus 5.5, and from 11% to 1% with Fable 5.2.',
		said: 'Each phrase here already says its point.',
		saidSmall: '1 of 3 · click one for the rest',
		steady: 'An opening starts from exactly what you read.',
		steadySmall: '2 of 3 · nothing after it jumps as the click lands',
		between: 'The detail grows between the words you read.',
		betweenSmall: 'Open only what you need.',
		fold: 'Click « and it folds back.',
		knows: 'And Claude knows which parts you opened.',
		knowsSmall: 'Ask it what you skipped.',
		table: 'A table in a stretch is drawn as a table.',
		tableSmall: '3 of 3 · the same reply under each release',
		versions: ['0.5.6', '0.6.0'],
		drew: ['wrote it as typed', 'draws the table'],
		style: 'Since 0.5.0: mark the phrases your way.',
		styleSmall: '/cc-stretch:style puts a toolbar above the prompt.',
		product: 'cc-stretch',
		tagline: ['Short replies that stretch where you click.', 'Short replies from Claude that stretch to the full answer where you click.'],
		install: '/plugin install cc-stretch --marketplace pro-vi/cc-stretch',
		update: 'Have it already? claude plugin update cc-stretch@cc-stretch',
		where: 'Works in the terminal and in the Claude desktop app.',
		repo: 'github.com/pro-vi/cc-stretch',
		fine: 'Clawd belongs to Anthropic. Stretchtext belongs to Ted Nelson. The bugs are ours.',
	};

	// --- what the takes hold ---------------------------------------------------------------------
	const rowText = (runs) => runs.reduce((out, run) => out.padEnd(run.col, ' ') + run.text, '');
	const textsOf = (frame) => (frame.texts ??= frame.rows.map(rowText));
	/**
	 * Blanks Claude Code's header, three rows as of Claude Code 2.1.332, which name the account's plan
	 * and the folder. The launch film shows the header as part of its picture, so each cut decides.
	 */
	function hideHeader(take) {
		for (const frame of take.frames) {
			const at = frame.rows.findIndex((runs) => /Claude Code v[\d.]+/.test(rowText(runs)));
			if (at !== -1) for (let i = at; i < at + 3; i++) frame.rows[i] = [];
		}
	}
	/**
	 * A frame's first question and the reply under it: the rows from the question to the reply's last
	 * filled row so far, and the row where the reply's own text begins. A command the take ran before
	 * it, which starts with a slash, is no question. As of Claude Code 2.1.332 a finished turn ends
	 * with a line that times it (`· done`), and while a reply is being written a spinner sits in the
	 * screen's last eight rows, above the prompt; the reply ends above whichever is there.
	 */
	function replyOf(frame) {
		if (frame.reply) return frame.reply;
		const texts = textsOf(frame);
		const from = texts.findIndex((text) => /^❯\s+[^\s/]/.test(text));
		const done = texts.findIndex((text, i) => i > from && / · done /.test(text));
		let to = (done === -1 ? texts.length - 8 : done) - 1;
		while (to > from && texts[to].trim() === '') to--;
		const first = texts.findIndex((text, i) => i > from && i <= to && text.startsWith('⏺'));
		return (frame.reply = { from, to, first, rows: frame.rows.slice(from, to + 1) });
	}

	// --- what this film draws beside the terminal ------------------------------------------------
	// A panel is rows cut from a screen, with the terminal's own margins: a reply's last paragraphs,
	// the style toolbar's rows, or a reply from a take of another width. The film has two, for the
	// scenes that set two things side by side or one above the other; the tables scene puts a tag
	// over each.
	const CSS = `
		#panels { z-index: 2; }
		.panel { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: var(--term); border-radius: 18px; overflow: hidden;
			box-shadow: 0 30px 80px rgba(30,20,10,.28), 0 0 0 1px rgba(0,0,0,.4); }
		.tag { position: absolute; left: 0; top: 0; font: 400 30px/1 var(--sans); color: var(--muted); white-space: nowrap; }
		.tag b { margin-right: 20px; font: 400 68px/1 var(--serif); letter-spacing: -.015em; color: var(--ink); }`;
	let dom = null;
	function buildDom() {
		const style = document.createElement('style');
		style.textContent = CSS;
		document.head.appendChild(style);
		const make = (parent, html, before = null) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return parent.insertBefore(t.content.firstChild, before); };
		// The panels' layer lies over the terminal and under its caption, which has the higher z-index.
		const panels = make($('stage'), '<div id="panels" class="layer"></div>', $('termlayer').nextSibling);
		dom = {
			panels: [make(panels, '<div class="panel"><div class="rows"></div></div>'), make(panels, '<div class="panel"><div class="rows"></div></div>')],
			tags: [make(panels, '<div class="tag"></div>'), make(panels, '<div class="tag"></div>')],
		};
	}
	const panelHeight = (rows) => PAD_TOP + rows * CELL_H + PAD_FOOT;
	const panelWidth = (cols) => cols * CELL_W + 2 * PAD_SIDE;
	/** Draws `rows` in a panel, a table's border as lines that meet; `cols` is the width in cells of the take they come from, the main take's unless given. */
	function place(panel, rows, { x, y, s, alpha, cols = COLS }) {
		rowsInto(panel.firstChild, rows, true);
		panel.firstChild.style.width = `${cols * CELL_W}px`;
		panel.firstChild.style.height = `${rows.length * CELL_H}px`;
		panel.style.width = `${panelWidth(cols)}px`;
		panel.style.opacity = alpha;
		panel.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
	}
	/** A panel's tag: a large word and a few small ones after it. */
	function tag(el, x, y, big, small, alpha) {
		setHtml(el, `<b>${big}</b>${small}`);
		el.style.opacity = alpha;
		el.style.transform = `translate(${x}px, ${y}px)`;
	}

	// The framing of the reply in the terminal: the question's row under the caption and the whole reply
	// in view. The command that opened the style toolbar stands above the question.
	const FIRST = { s: 1.3, focus: 19 };

	// --- other marks for the phrases ------------------------------------------------------------------
	// The take's clicks on the style toolbar, in order, a beat of the score apart. The take is recorded
	// in the tinted highlight with no marks, where these clicks end again.
	const LOOKS = ['colour', 'swatch', 'underline', 'none', 'bold', 'tinted', 'unbold', 'bare'];
	const BEAT = 0.625, LEAD = 2 * BEAT, STYLE = LEAD + LOOKS.length * BEAT + 1.0;
	// The scale of the scene's two panels, where the upper one's top stands, the gap between them, and
	// the toolbar's rows: its marks and its highlights.
	const STYLE_S = 1.25, STYLE_TOP = 208, STYLE_GAP = 18, TOOLBAR_ROWS = 2;
	function styles(main) {
		const m = main.marks, last = frameAt(m.end.t, main);
		const texts = textsOf(last), reply = replyOf(last), tool = texts.findIndex((text) => text.startsWith('marks '));
		const x = (W - TERM_W * STYLE_S) / 2, toolY = H - 30 - panelHeight(TOOLBAR_ROWS) * STYLE_S;
		// As many of the first reply's last rows as fit above the toolbar, from the start of a paragraph.
		const fits = Math.floor(((toolY - STYLE_GAP - STYLE_TOP) / STYLE_S - PAD_TOP - PAD_FOOT) / CELL_H);
		let first = Math.max(0, reply.rows.length - fits);
		while (first > 0 && first < reply.rows.length && texts[reply.from + first - 1].trim() !== '') first++;
		// The screen keeps its rows through these clicks, so the last frame's places hold for every frame.
		const cutOf = (frame) => (frame.styled ??= { reply: frame.rows.slice(reply.from + first, reply.to + 1), toolbar: frame.rows.slice(tool, tool + TOOLBAR_ROWS) });
		// The toolbar's panel as a camera on its rows: a panel has no title bar. The pointer glides to the
		// first click and darts to each one after, in about the fifth of a second the beat leaves it.
		const cam = { x, y: toolY - BAR * STYLE_S, s: STYLE_S };
		const clicks = LOOKS.map((name, i) => ({ at: LEAD + i * BEAT, travel: i === 0 ? 1 : 0.2, ...cellToScreen(cam, m[name].row - tool, m[name].col) }));
		// A look shows from its click as it stood in the take just before the next one, the last as the take ended.
		const shownAt = (t) => { const next = clicks.findIndex((c) => c.at > t - 0.06); return next === -1 ? m.end.t : m[LOOKS[next]].t - 0.1; };
		const draw = (t) => {
			show('termlayer', 1);
			show('panels', 1);
			$('term-wrap').style.opacity = 0;
			for (const el of dom.tags) el.style.opacity = 0;
			const cut = cutOf(frameAt(shownAt(t), main)), arrive = ease(span(t, 0.25, 0.7));
			place(dom.panels[0], cut.reply, { x, y: STYLE_TOP, s: STYLE_S, alpha: 1 });
			place(dom.panels[1], cut.toolbar, { x, y: toolY + 40 * (1 - arrive), s: STYLE_S, alpha: arrive });
			setCaption(COPY.style, COPY.styleSmall);
			pointTo(clicks, t);
			show('fade', 1 - span(t, 0, 0.35) + span(t, STYLE - 0.35, STYLE));
		};
		return { kind: 'custom', len: STYLE, draw, clicks, cues: { looks: clicks.map((c) => c.at) } };
	}

	// --- a table in a stretch, as release 0.5.6 drew it and as it is drawn now -------------------------
	// When each take's stretch is clicked, on beats of the score, and the scene's length, twelve beats.
	const PRESSED = [2 * BEAT, 6 * BEAT], TABLES = 12 * BEAT;
	// The scale of the two panels, where their tops stand, and the gap between them.
	const TABLE_S = 0.98, TABLE_TOP = 430, TABLE_GAP = 56;
	function tables({ 'table-before': before, table: now }) {
		const sides = [before, now].map((take, i) => {
			const m = take.marks, last = replyOf(frameAt(m.end.t, take));
			const x = W / 2 + (i === 0 ? -TABLE_GAP / 2 - panelWidth(m.size.cols) * TABLE_S : TABLE_GAP / 2);
			return {
				take, x, cols: m.size.cols,
				// The rows the reply fills once open, in every frame, so a panel keeps its size while its stretch opens.
				rowsAt: (takeT) => { const frame = frameAt(takeT, take); return (frame.tabled ??= frame.rows.slice(last.first, last.to + 1)); },
				// The first screen the click changed.
				opened: take.frames.find((f) => f.t > m.open.t).t,
				// A panel as a camera on its rows: it has no title bar.
				click: { at: PRESSED[i], ...cellToScreen({ x, y: TABLE_TOP - BAR * TABLE_S, s: TABLE_S }, m.open.row - last.first, m.open.col) },
			};
		});
		const clicks = sides.map((side) => side.click);
		const draw = (t) => {
			show('termlayer', 1);
			show('panels', 1);
			$('term-wrap').style.opacity = 0;
			sides.forEach(({ take, x, cols, rowsAt, opened, click }, i) => {
				// Closed until its click lands, then the take's own seconds from the screen the click changed.
				const takeT = t < click.at ? take.marks.open.t : Math.min(take.marks.end.t, opened + t - click.at);
				const arrive = ease(span(t, 0.2 + 0.3 * i, 0.6 + 0.3 * i));
				place(dom.panels[i], rowsAt(takeT), { x, y: TABLE_TOP, s: TABLE_S, alpha: arrive, cols });
				tag(dom.tags[i], x + 8, TABLE_TOP - 92, COPY.versions[i], COPY.drew[i], arrive);
			});
			setCaption(COPY.table, COPY.tableSmall);
			pointTo(clicks, t);
			show('fade', 1 - span(t, 0, 0.35) + span(t, TABLES - 0.35, TABLES));
		};
		return { kind: 'custom', len: TABLES, draw, clicks, cues: { tabled: clicks.map((click) => click.at) } };
	}

	// --- the first change, on a card: phrases that say their point --------------------------------
	// Two small panels, each one item of a reply's list as a closed stretch on its highlight: on the
	// left a short form that only announces its point, on the right the take's own, which states it.
	const PW = 800, PH = 230, LEFT = { x: 130, y: 470 }, RIGHT = { x: 990, y: 470 };
	// The closed stretch of the first reply that the card shows: the one about its cost, whose words
	// come from the facts in take.mjs's added instructions. It must sit in one run, on one row.
	const POINT = /costs about as many tokens/;
	const mini = (at, lines, highlight, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:${PW}px;height:${PH}px;box-sizing:border-box;padding:58px 44px 0;opacity:${opacity};`
		+ `background:var(--term);border-radius:22px;box-shadow:0 30px 80px rgba(30,20,10,.22);text-align:left;font:400 28px/1.75 var(--mono);color:var(--term-fg);white-space:pre">`
		+ lines.map((text, i) => `${i === 0 ? '<span style="color:#8d877d">- </span>' : '  '}<span style="background:${highlight};padding:5px 0">${text}</span>`).join('\n') + `</div>`;
	const badge = (at, text, style, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y - 74}px;width:${PW}px;text-align:center;opacity:${opacity}">`
		+ `<span style="display:inline-block;padding:12px 26px;border-radius:999px;font:600 24px/1 var(--sans);letter-spacing:.04em;${style}">${text}</span></div>`;
	const label = (at, text, colour, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y + PH + 34}px;width:${PW}px;text-align:center;opacity:${opacity};font:500 32px/1.3 var(--sans);color:${colour}">${text}</div>`;
	/** `text` in lines of at most `width` characters, broken at spaces. */
	const wrapped = (text, width) => text.split(' ').reduce((lines, word) => {
		if (lines.length > 0 && `${lines.at(-1)} ${word}`.length <= width) lines[lines.length - 1] += ` ${word}`;
		else lines.push(word);
		return lines;
	}, []);
	const stage = (...parts) => `<div style="position:relative;width:${W}px;height:${H}px">${parts.join('')}</div>`;
	const line = (cls, top, html, style = '') => `<div class="${cls}" style="position:absolute;top:${top}px;left:0;width:100%;${style}">${html}</div>`;
	/** The card for a closed stretch of the take, a run of its screen: its text, on its highlight. */
	const newCard = (stretch) => {
		const lines = wrapped(stretch.text.trim(), 38);
		return (t) => {
			// The left side shows first and dims as the right one arrives; both are lit at the end.
			const left = ease(span(t, 0.5, 0.9)) * (1 - 0.55 * (ease(span(t, 1.9, 2.3)) - ease(span(t, 4.6, 5.0))));
			const right = ease(span(t, 1.9, 2.4));
			return stage(
				line('kicker', 150, COPY.newKicker, 'margin:0'),
				line('big', 204, COPY.named, 'max-width:none;font-size:84px'),
				badge(LEFT, COPY.beforeBadge, 'background:#e4dfd4;color:#6f6a61', left), badge(RIGHT, COPY.afterBadge, 'background:var(--orange);color:#fff', right),
				mini(LEFT, COPY.beforeLabel, stretch.bg, left), mini(RIGHT, lines, stretch.bg, right),
				label(LEFT, COPY.before, 'var(--muted)', left), label(RIGHT, COPY.after, 'var(--ink)', right),
				line('fine', 860, COPY.trial, `margin:0;max-width:none;font-size:28px;opacity:${ease(span(t, 2.8, 3.3))}`),
			);
		};
	};

	/** When each new word of a stretch that opens from `t0` to `t1` is half open, for the score. */
	const popsOf = (pair, font, newFont, t0, t1) => planOf(pair, font, newFont).filter((u) => u.kind === 'new').map((u) => lerp(t0, t1, u.start + 0.2));

	// --- the title -----------------------------------------------------------------------------------
	const TITLE = 2.6;
	const titleCard = (t) => stage(
		line('kicker', 392, COPY.kicker, `margin:0;opacity:${ease(span(t, 0.1, 0.5))}`),
		line('big', 440, COPY.title, 'max-width:none;font-size:128px'),
		line('small', 624, COPY.titleSmall, `margin:0;opacity:${ease(span(t, 0.7, 1.1))}`),
	);

	// --- the end: the tagline is itself a stretch, and a click opens it -----------------------------
	const TAG = `500 44px/1.3 Inter, sans-serif`;
	const PX = 16, GROUND = 300, TAG_Y = 520, CLICK = 2.0, TAG_OPEN = [CLICK + 0.1, CLICK + 1.5], LET_GO = CLICK + 1.6;
	function endCard(t) {
		// Clawd is pulled wide as the tagline opens and rings back once it has.
		const body = pulled(t, { from: CLICK, full: CLICK + 0.4, go: LET_GO, sx: 1.55, sy: 0.86 });
		const pose = t > LET_GO + 0.9 && t % 2.7 > 2.55 ? 'blink' : 'idle';
		const open = span(t, ...TAG_OPEN);
		return stage(
			clawdSvg({ pose, px: PX, x: W / 2 - 7 * PX, y: GROUND - 8 * PX, ...body }),
			line('big', 345, COPY.product, 'max-width:none;font-size:112px'),
			line('stretching', TAG_Y, `<span style="text-decoration:${open > 0 ? 'none' : 'underline'};text-decoration-thickness:2px;text-underline-offset:10px">${stretched(COPY.tagline, open, TAG, TAG, 'color:var(--orange)')}</span>`, `text-align:center;font:${TAG};color:var(--ink);opacity:${ease(span(t, 0.5, 0.9))}`),
			line('', 660, `<div class="mono" style="margin:0">${COPY.install}</div>`, `display:flex;justify-content:center;opacity:${ease(span(t, 0.9, 1.3))}`),
			line('small', 742, COPY.update, `margin:0;font:400 24px/1 var(--mono);opacity:${ease(span(t, 1.0, 1.4))}`),
			line('small', 796, COPY.where, `margin:0;font-size:28px;opacity:${ease(span(t, 1.1, 1.5))}`),
			line('small', 846, COPY.repo, `margin:0;font-size:28px;opacity:${ease(span(t, 1.2, 1.6))}`),
			line('fine', 905, COPY.fine, `margin:0;max-width:none;opacity:${ease(span(t, LET_GO + 0.6, LET_GO + 1.0))}`),
		);
	}

	window.CUT = {
		takes: ['table', 'table-before'],
		scenes(take, takes) {
			buildDom();
			for (const each of Object.values(takes)) hideHeader(each);
			const m = take.marks;
			const shot = (len, from, to, [big, small], rest = {}) => ({ kind: 'take', len, from, to, caption: big, small, zoom: zoomFor(FIRST.s), focus: FIRST.focus, ...rest });
			// Each growth starts at the first frame that changed after its press (changed, in kit.js).
			const grown = (mark, len, words, rest = {}) => shot(len, changed(mark.t), changed(mark.t) + len, words, { growth: true, ...rest });
			const SAID = [COPY.said, COPY.saidSmall], STEADY = [COPY.steady, COPY.steadySmall], BETWEEN = [COPY.between, COPY.betweenSmall];
			const FOLD = [COPY.fold, ''], KNOWS = [COPY.knows, COPY.knowsSmall];
			// The camera moves in while a phrase opens, and on the second reply. How long each opening and
			// the closing are held. The take scenes together last 32 beats of the score and the tables 12,
			// so the clicks on the tables and on the style toolbar land on its beats.
			const NEAR = zoomFor(1.6), CLOSER = zoomFor(1.45), GROW1 = 3.4, GROW2 = 4.0, SHUT = 2.0;
			// The second reply: when its first row shows, and when the line that times it does.
			const second = take.frames.find((f) => f.t > m.asked2.t && textsOf(f).filter((text) => text.startsWith('⏺')).length > 1).t;
			const timed = take.frames.find((f) => textsOf(f).filter((text) => / · done /.test(text)).length > 1).t;
			const stretch = frameAt(m.replied.t + 0.3).rows.flat().find((run) => run.bg && POINT.test(run.text));
			if (stretch === undefined) throw new Error(`the first reply shows no highlighted phrase that matches ${POINT}`);
			return [
				{ kind: 'card', len: TITLE, html: titleCard, cues: { title: [0] } },
				{ kind: 'card', len: 6.0, html: newCard(stretch), cues: { card: [0] } },
				shot(2.4, m.replied.t + 0.3, m.open1.t, SAID, { click: m.open1 }),
				grown(m.open1, GROW1, STEADY, { zoom: NEAR, focus: 22, cues: { grow: [0.1] } }),
				shot(1.3, changed(m.open1.t) + GROW1, m.open2.t, STEADY, { zoom: NEAR, focus: 23, click: m.open2 }),
				grown(m.open2, GROW2, BETWEEN, { zoom: NEAR, focus: 24.5, cues: { grow: [0.1] } }),
				shot(1.2, changed(m.open2.t) + GROW2, m.close.t, BETWEEN, { focus: 23, click: m.close }),
				grown(m.close, SHUT, FOLD, { focus: 23, cues: { shrink: [0.1] } }),
				shot(0.9, m.asked2.t + 0.3, second - 0.1, KNOWS, { zoom: CLOSER, focus: 36 }),
				shot(1.6, second - 0.1, timed - 0.05, KNOWS, { zoom: CLOSER, focus: 37 }),
				shot(3.2, m.replied2.t - 0.2, m.replied2.t, KNOWS, { zoom: CLOSER, focus: 37 }),
				tables(takes),
				styles(take),
				{ kind: 'card', len: 7.2, html: endCard, clicks: [{ at: CLICK, x: W / 2, y: TAG_Y + 30 }], boings: [LET_GO],
					cues: { end: [0], pops: popsOf(COPY.tagline, TAG, TAG, ...TAG_OPEN), chirp: [5.0] } },
			];
		},
	};
})();

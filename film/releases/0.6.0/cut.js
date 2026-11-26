// The 0.6.0 film, made for people who have never seen the plugin. It opens on a real reply written
// without it, pulls back to show all of that reply, sets the reply to the same question with the
// plugin beside it at the same scale, and moves in on that one: two steps opened, one closed, and
// Claude asked which parts were skipped. Then what 0.6.0 changed, where the idea comes from, and how
// to install. compose.mjs --release=0.6.0 loads it into release.html with both of take.mjs's takes.
(() => {
	const COPY = {
		asked: 'You asked one question.',
		writing: (n) => `Claude has written <b>${n}</b> words…`,
		answered: (n) => `Claude answered in ${n} words.`,
		answeredSmall: 'This is all of it, top to bottom.',
		same: 'Same question, with cc-stretch.',
		sameSmall: (n) => `${n} words. Every step of the plan is in them.`,
		without: 'without the plugin',
		with: 'with cc-stretch',
		words: (n) => `${n} words`,
		click: 'Click a step. It grows right where it is.',
		clickSmall: 'The new words arrive in colour.',
		between: 'The detail grows between the words you read.',
		betweenSmall: 'Open only the steps you need.',
		fold: 'Click « and it folds back.',
		knows: 'And Claude knows which parts you opened.',
		knowsSmall: 'Ask it what you skipped.',
		newKicker: 'New in 0.6.0',
		named: 'Plans now arrive with their steps named.',
		beforeBadge: 'Before',
		afterBadge: 'Now',
		beforeStep: ['Here is how to cut over.'],
		before: 'Sometimes only a label',
		after: 'The parts, in a few words',
		trial: 'Over two weeks of real sessions, half on each guide, with a model judging every phrase in view:<br>phrases that were only a label fell from 11% to 3% with Opus 5.5, and from 11% to 1% with Fable 5.2.',
		older: 'The idea is older than the web.',
		year: '1967',
		who: 'Ted Nelson, Hypertext Note 8',
		// Ted Nelson's own example of stretchtext, as the launch film sets it.
		nelson: ['Stretchtext is a form of writing.', 'Stretchtext, a kind of hypertext, is basically a form of writing closely related to other prose.'],
		nelsonNote: 'Ted Nelson’s own example, printed in 1970',
		never: 'It never caught on.',
		neverSmall: 'Someone had to write every level by hand.',
		clawdSays: 'I don’t mind.',
		product: 'cc-stretch',
		tagline: ['Short replies that stretch where you click.', 'Short replies from Claude that stretch to the full answer where you click.'],
		install: '/plugin install cc-stretch --marketplace pro-vi/cc-stretch',
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
	 * filled row so far, and how many words the reply holds. As of Claude Code 2.1.332 a finished turn
	 * ends with a line that times it (`· done`), and while a reply is being written a spinner sits in
	 * the screen's last eight rows, above the prompt; the reply ends above whichever is there.
	 */
	function replyOf(frame) {
		if (frame.reply) return frame.reply;
		const texts = textsOf(frame);
		const from = texts.findIndex((text) => /^❯\s+\S/.test(text));
		const done = texts.findIndex((text, i) => i > from && / · done /.test(text));
		let to = (done === -1 ? texts.length - 8 : done) - 1;
		while (to > from && texts[to].trim() === '') to--;
		const first = texts.findIndex((text, i) => i > from && i <= to && text.startsWith('⏺'));
		const said = first === -1 ? '' : texts.slice(first, to + 1).join(' ').replace(/⏺/g, ' ');
		// A word holds a letter or a digit; a list's own numbering is not counted.
		const words = said.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !/^\d+[.)]$/.test(w)).length;
		return (frame.reply = { from, to, rows: frame.rows.slice(from, to + 1), words });
	}
	/** The reply the plugin's session gave, as it stood before any click. */
	const shortReply = (main) => replyOf(frameAt(main.marks.replied.t + 0.3, main));

	// --- what this film draws beside the terminal ------------------------------------------------
	// A panel is a reply cut from its screen, the question's row first, with the terminal's own margins,
	// so a panel at the terminal's scale and place covers the same rows exactly.
	const CSS = `
		#opening { z-index: 2; }
		.panel { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: var(--term); border-radius: 18px; overflow: hidden;
			box-shadow: 0 30px 80px rgba(30,20,10,.28), 0 0 0 1px rgba(0,0,0,.4); }
		.tally { position: absolute; left: 0; top: 0; width: 420px; font: 400 30px/1.3 var(--sans); color: var(--muted); }
		.tally b { display: block; font: 400 84px/1.05 var(--serif); letter-spacing: -.015em; color: var(--ink); }
		#caption small b { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }`;
	let dom = null;
	function buildDom() {
		const style = document.createElement('style');
		style.textContent = CSS;
		document.head.appendChild(style);
		const make = (parent, html, before = null) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return parent.insertBefore(t.content.firstChild, before); };
		// The opening's layer lies over the terminal and under its caption, which has the higher z-index.
		const opening = make($('stage'), '<div id="opening" class="layer"></div>', $('termlayer').nextSibling);
		dom = {
			long: make(opening, '<div class="panel"><div class="rows"></div></div>'),
			short: make(opening, '<div class="panel"><div class="rows"></div></div>'),
			longTally: make(opening, '<div class="tally" style="text-align:right"></div>'),
			shortTally: make(opening, '<div class="tally"></div>'),
			paper: make($('stage'), `<div id="paper" class="layer"><div class="year"></div><div class="who"></div><div class="line"></div><div id="nelson" class="stretching"></div>
				<div id="throttle"><div class="track"></div><div class="knob"></div><div class="label">THROTTLE</div></div><div class="note"></div></div>`, $('fade')),
		};
	}
	const panelHeight = (rows) => PAD_TOP + rows * CELL_H + PAD_FOOT;
	function place(panel, rows, { x, y, s, alpha }) {
		rowsInto(panel.firstChild, rows);
		panel.firstChild.style.width = `${COLS * CELL_W}px`;
		panel.firstChild.style.height = `${rows.length * CELL_H}px`;
		panel.style.width = `${TERM_W}px`;
		panel.style.opacity = alpha;
		panel.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
	}
	function tally(el, x, y, big, small, alpha) {
		setHtml(el, `<b>${big}</b>${small}`);
		el.style.opacity = alpha;
		el.style.transform = `translate(${x}px, ${y}px)`;
	}

	// --- the opening: one reply without the plugin, then the same question with it ------------------
	// When each part of the opening ends, in seconds: the question alone, the reply being written, the
	// pull back to the whole of it, the two replies side by side, and the move in on the short one.
	const ALONE = 0.6, WRITTEN = 4.5, WHOLE = 6.3, BESIDE = 9.5, INTRO = 10.8;
	// The scale the reply is read at as it is written, and where its newest row and its top are held.
	const READ = 1.5, EDGE = 905, TOP = 232;
	// Where the two whole replies stand, and the first take scene's framing, which the opening ends on.
	const WHOLE_TOP = 222, WHOLE_FOOT = 1042, LONG_X = 500, SHORT_X = 1010;
	const FIRST = { s: 1.45, focus: 13 };

	function intro({ main, plain }) {
		const long = replyOf(frameAt(plain.marks.end.t, plain)), short = shortReply(main);
		// The take seconds the writing spans: from just before the reply's first row to its last.
		const begun = plain.frames.find((f) => f.t > plain.marks.asked.t && replyOf(f).words > 0).t - 0.15;
		const ended = plain.frames.find((f) => replyOf(f).words === long.words).t + 0.1;
		const takeAt = (t) => lerp(begun, ended, span(t, ALONE, WRITTEN) ** 1.15);
		const lastRow = (t) => replyOf(frameAt(takeAt(t), plain)).rows.length - 1;
		// The newest row's place eased over the last 0.3 s, so the reply glides up as rows arrive.
		const smoothRow = (t) => { let sum = 0; for (let k = 0; k < 8; k++) sum += lastRow(t - (k * 0.3) / 8); return sum / 8; };
		const fullH = panelHeight(long.rows.length), fitS = (WHOLE_FOOT - WHOLE_TOP) / fullH;

		const draw = (t) => {
			show('termlayer', 1);
			show('opening', 1);
			const reply = replyOf(frameAt(takeAt(t), plain));
			// While it is written, the panel hangs from the frame's top until its newest row reaches the
			// edge, then rises to keep that row there. The pull back turns about the reply's foot.
			const readY = Math.min(TOP, EDGE - (PAD_TOP + (smoothRow(t) + 1) * CELL_H) * READ);
			const back = ease(span(t, WRITTEN, WRITTEN + 1.3));
			const s = READ * (fitS / READ) ** back;
			const footY = lerp(readY + fullH * READ, WHOLE_FOOT, back);
			const aside = ease(span(t, WHOLE, WHOLE + 0.8)), leave = ease(span(t, BESIDE, BESIDE + 0.7));
			const centreX = lerp(lerp(W / 2, LONG_X + (TERM_W * fitS) / 2, aside), -400, leave);
			place(dom.long, t < WRITTEN ? reply.rows : long.rows, { x: centreX - (TERM_W * s) / 2, y: t < WRITTEN ? readY : footY - fullH * s, s, alpha: 1 - leave });

			// The short reply arrives beside it at the same scale, then grows to the place the terminal
			// takes in the next scene, where the terminal itself fades in under it.
			drawRows(frameAt(main.marks.replied.t + 0.3, main));
			const cam = placeTerm(zoomFor(FIRST.s), FIRST.focus);
			const grow = ease(span(t, BESIDE, INTRO - 0.15));
			const at = { x: lerp(SHORT_X, cam.x, grow), y: lerp(WHOLE_TOP, cam.y + (BAR + short.from * CELL_H) * cam.s, grow), s: fitS * (cam.s / fitS) ** grow };
			place(dom.short, short.rows, { ...at, alpha: ease(span(t, WHOLE + 0.5, WHOLE + 0.9)) });
			$('term-wrap').style.opacity = span(t, INTRO - 0.45, INTRO - 0.1);

			const tallies = ease(span(t, WHOLE + 0.9, WHOLE + 1.3)) * (1 - span(t, BESIDE - 0.1, BESIDE + 0.25));
			tally(dom.longTally, LONG_X - 460, WHOLE_TOP + 20, COPY.words(long.words), COPY.without, tallies);
			tally(dom.shortTally, SHORT_X + TERM_W * fitS + 40, WHOLE_TOP + 20, COPY.words(short.words), COPY.with, tallies);

			if (t < WRITTEN) setCaption(COPY.asked, reply.words > 0 ? COPY.writing(reply.words) : '');
			else if (t < WHOLE + 0.5) setCaption(COPY.answered(long.words), COPY.answeredSmall);
			else setCaption(COPY.same, COPY.sameSmall(short.words));
		};
		// A key's tick for every eight words written, a low note as the camera pulls back, bells as the
		// short reply arrives and as it lands.
		const typed = [];
		for (let t = ALONE, at = 0; t < WRITTEN; t += 1 / 60) { const n = replyOf(frameAt(takeAt(t), plain)).words; if (n >= at + 8) { typed.push(t); at = n; } }
		return { kind: 'custom', len: INTRO, draw, cues: { typed, back: [WRITTEN], beside: [WHOLE + 0.5], landed: [INTRO - 0.2] } };
	}

	// --- what 0.6.0 changed -------------------------------------------------------------------------
	// Two small panels, each one numbered step of a reply as a closed stretch: on the left a short form
	// that only announces its step, on the right the take's own, which names the step's parts.
	const PW = 800, PH = 230, LEFT = { x: 130, y: 470 }, RIGHT = { x: 990, y: 470 };
	const mini = (at, number, lines, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:${PW}px;height:${PH}px;box-sizing:border-box;padding:58px 44px 0;opacity:${opacity};`
		+ `background:var(--term);border-radius:22px;box-shadow:0 30px 80px rgba(30,20,10,.22);text-align:left;font:400 28px/1.75 var(--mono);color:var(--term-fg);white-space:pre">`
		+ lines.map((text, i) => `${i === 0 ? `<span style="color:#8d877d">${number}. </span>` : ' '.repeat(number.length + 2)}<span style="text-decoration:underline;text-underline-offset:8px">${text}</span>`).join('\n') + `</div>`;
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
	/** The card for a step numbered `number` whose closed form the take showed as `afterStep`. */
	const newCard = (number, afterStep) => (t) => {
		// The left side shows first and dims as the right one arrives; both are lit at the end.
		const left = ease(span(t, 0.5, 0.9)) * (1 - 0.55 * (ease(span(t, 1.9, 2.3)) - ease(span(t, 4.6, 5.0))));
		const right = ease(span(t, 1.9, 2.4));
		return stage(
			line('kicker', 150, COPY.newKicker, 'margin:0'),
			line('big', 204, COPY.named, 'max-width:none;font-size:84px'),
			badge(LEFT, COPY.beforeBadge, 'background:#e4dfd4;color:#6f6a61', left), badge(RIGHT, COPY.afterBadge, 'background:var(--orange);color:#fff', right),
			mini(LEFT, number, COPY.beforeStep, left), mini(RIGHT, number, afterStep, right),
			label(LEFT, COPY.before, 'var(--muted)', left), label(RIGHT, COPY.after, 'var(--ink)', right),
			line('fine', 860, COPY.trial, `margin:0;max-width:none;font-size:28px;opacity:${ease(span(t, 2.8, 3.3))}`),
		);
	};

	// --- 1967 ----------------------------------------------------------------------------------------
	// When a line of its own gives way to Nelson's sentence, the seconds the sentence opens over, and the scene's end.
	const OLDER = 1.4, OPENS = [2.2, 4.1], PAPER = 6.0;
	function paper(t) {
		show('paper', 1);
		const q = (selector) => dom.paper.querySelector(selector);
		const sentence = t >= OLDER, open = span(t, ...OPENS);
		q('.line').textContent = sentence ? '' : COPY.older;
		q('.line').style.opacity = 1 - span(t, OLDER - 0.3, OLDER);
		q('.year').textContent = sentence ? COPY.year : '';
		q('.who').textContent = sentence ? COPY.who : '';
		q('.note').textContent = t > OPENS[0] ? COPY.nelsonNote : '';
		q('#nelson').style.font = TYPED;
		setHtml(q('#nelson'), sentence ? stretched(COPY.nelson, open, TYPED, TYPED_NEW) : '');
		q('.knob').style.top = `${lerp(386, 0, ease(open))}px`;
		for (const selector of ['.year', '.who', '#nelson', '#throttle']) q(selector).style.opacity = (selector === '.who' ? 0.8 : 1) * span(t, OLDER, OLDER + 0.3);
		show('fade', 1 - span(t, 0, 0.4) + span(t, PAPER - 0.4, PAPER));
	}
	/** When each new word of a stretch that opens from `t0` to `t1` is half open, for the score. */
	const popsOf = (pair, font, newFont, t0, t1) => planOf(pair, font, newFont).filter((u) => u.kind === 'new').map((u) => lerp(t0, t1, u.start + 0.2));

	// It never caught on; Clawd walks in, as in the launch film.
	const NEVER = 3.2, WALKS = 1.3;
	function never(t) {
		show('card', 1);
		card(`<div class="big">${COPY.never}</div><div class="small" style="opacity:${ease(span(t, 0.7, 1.1))}">${COPY.neverSmall}</div>`);
		const walkIn = ease(span(t, WALKS, WALKS + 0.9));
		const x = lerp(W + 40, 1500, walkIn);
		drawClawd({ pose: walkIn < 1 ? (Math.floor(t * 8) % 2 ? 'walk' : 'idle') : 'wave', x, y: 780, px: 14 });
		bubble(COPY.clawdSays, x - 210, 680, span(t, WALKS + 0.95, WALKS + 1.1));
		show('fade', 1 - span(t, 0, 0.4) + span(t, NEVER - 0.3, NEVER));
	}

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
			line('small', 765, COPY.repo, `margin:0;opacity:${ease(span(t, 1.1, 1.5))}`),
			line('fine', 905, COPY.fine, `margin:0;max-width:none;opacity:${ease(span(t, LET_GO + 0.6, LET_GO + 1.0))}`),
		);
	}

	window.CUT = {
		takes: ['plain'],
		scenes(take, takes) {
			buildDom();
			for (const each of Object.values(takes)) hideHeader(each);
			const m = take.marks;
			const shot = (len, from, to, [big, small], rest = {}) => ({ kind: 'take', len, from, to, caption: big, small, zoom: zoomFor(FIRST.s), focus: FIRST.focus, ...rest });
			// Each growth starts at the first frame that changed after its press (changed, in kit.js).
			const grown = (mark, len, words, rest = {}) => shot(len, changed(mark.t), changed(mark.t) + len, words, { growth: true, ...rest });
			const SAME = [COPY.same, COPY.sameSmall(shortReply(take).words)], CLICKED = [COPY.click, COPY.clickSmall], BETWEEN = [COPY.between, COPY.betweenSmall];
			const FOLD = [COPY.fold, ''], KNOWS = [COPY.knows, COPY.knowsSmall];
			// The camera moves in a little while a step opens. How long each opening and the closing are held.
			const NEAR = zoomFor(1.6), GROW1 = 3.4, GROW2 = 4.0, SHUT = 2.0;
			// The second reply: when its first row shows, and when the line that times it does. Its screen is
			// drawn once more as that line arrives, so the hold starts from the take's last frame.
			const second = take.frames.find((f) => f.t > m.asked2.t && textsOf(f).filter((text) => text.startsWith('⏺')).length > 1).t;
			const timed = take.frames.find((f) => textsOf(f).filter((text) => / · done /.test(text)).length > 1).t;
			// The step the take opened second, as it stood closed when clicked, for the card on what changed.
			const [, number, step] = /^\s*(\d+)\.\s+(.*\S)\s*$/.exec(textsOf(frameAt(m.open2.t))[m.open2.row]) ?? [];
			if (step === undefined) throw new Error('the row the take clicked second is not a numbered step');
			return [
				intro(takes),
				shot(2.4, m.replied.t + 0.3, m.open1.t, SAME, { cutIn: true, click: m.open1 }),
				grown(m.open1, GROW1, CLICKED, { zoom: NEAR, focus: 13.5, cues: { grow: [0.1] } }),
				shot(1.3, changed(m.open1.t) + GROW1, m.open2.t, CLICKED, { zoom: NEAR, focus: 16, click: m.open2 }),
				grown(m.open2, GROW2, BETWEEN, { zoom: NEAR, focus: 18.5, cues: { grow: [0.1] } }),
				shot(1.2, changed(m.open2.t) + GROW2, m.close.t, BETWEEN, { focus: 17, click: m.close }),
				grown(m.close, SHUT, FOLD, { focus: 16, cues: { shrink: [0.1] } }),
				shot(0.9, m.asked2.t + 0.3, second - 0.1, KNOWS, { focus: 30 }),
				shot(1.6, second - 0.1, timed - 0.05, KNOWS, { focus: 31 }),
				shot(3.0, m.end.t - 0.2, m.end.t, KNOWS, { focus: 31 }),
				{ kind: 'card', len: 6.0, html: newCard(number, wrapped(step, 38)), cues: { card: [0] } },
				{ kind: 'custom', len: PAPER, draw: paper, cues: { paper: [0], pops: popsOf(COPY.nelson, TYPED, TYPED_NEW, ...OPENS) } },
				{ kind: 'custom', len: NEVER, draw: never, cues: { never: [0], chirp: [WALKS] } },
				{ kind: 'card', len: 7.2, html: endCard, clicks: [{ at: CLICK, x: W / 2, y: TAG_Y + 30 }], boings: [LET_GO],
					cues: { end: [0], pops: popsOf(COPY.tagline, TAG, TAG, ...TAG_OPEN), chirp: [5.0] } },
			];
		},
	};
})();

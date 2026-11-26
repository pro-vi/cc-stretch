// The 0.6.0 film, scene by scene, timed from the take's marks: what a plan's short form was and is,
// a plan arriving with every step named, two of its steps opened where they stand, and what a trial
// in live sessions counted. compose.mjs --release=0.6.0 loads it into release.html.
(() => {
	const COPY = {
		kicker: 'What’s new in',
		title: 'cc-stretch 0.6.0',
		features: 'A plan you can read before you click.',
		named: 'A short form names each part.',
		namedSmall: 'Not a label you have to open to learn anything.',
		beforeBadge: 'Before · 0.5.6',
		afterBadge: 'Now · 0.6.0',
		beforeLink: 'Here is the plan.',
		afterLink: ['Copy the schema, stream the data,', 'then switch over.'],
		before: 'Sometimes only a label',
		after: 'Every part, in a few words',
		arrives: 'Ask for a plan, and every step is already in view.',
		arrivesSmall: 'Each underlined phrase opens for more.',
		grows: 'Click a step, and it grows where it stands.',
		growsSmall: 'Colour marks the words the click added.',
		only: 'Open only the steps you need.',
		onlySmall: 'The rest stay as short as they arrived.',
		trialKicker: 'Two weeks of real sessions, half on each guide',
		trial: '11% → 3%',
		trialSmall: 'of clickable phrases were only a label, with Opus 5.5.',
		trialFine: 'With Fable 5.2, 11% → 1%. Sessions were split by their id, and a model judged every phrase in view.',
		install: '/plugin install cc-stretch --marketplace pro-vi/cc-stretch',
		repo: 'github.com/pro-vi/cc-stretch',
	};

	// Two small terminal panels, each a reply of one closed stretch: on the left a short form that
	// only announces its plan, on the right one that names the plan's parts.
	const PW = 800, PH = 250, LEFT = { x: 130, y: 400 }, RIGHT = { x: 990, y: 400 };
	const panel = (at, lines, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:${PW}px;height:${PH}px;box-sizing:border-box;padding:66px 48px 0;opacity:${opacity};`
		+ `background:var(--term);border-radius:22px;box-shadow:0 30px 80px rgba(30,20,10,.22);text-align:left;font:400 32px/1.75 var(--mono);color:var(--term-fg);white-space:pre">`
		+ lines.map((text, i) => `${i === 0 ? '<span style="color:#8d877d">⏺ </span>' : '  '}<span style="text-decoration:underline;text-underline-offset:8px">${text}</span>`).join('\n') + `</div>`;
	const badge = (at, text, style, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y - 74}px;width:${PW}px;text-align:center;opacity:${opacity}">`
		+ `<span style="display:inline-block;padding:12px 26px;border-radius:999px;font:600 24px/1 var(--sans);letter-spacing:.04em;${style}">${text}</span></div>`;
	const label = (at, text, colour, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y + PH + 40}px;width:${PW}px;text-align:center;opacity:${opacity};font:500 32px/1.3 var(--sans);color:${colour}">${text}</div>`;
	function namedCard(t) {
		// The left side shows first and dims as the right one arrives; both are lit at the end.
		const left = ease(span(t, 0.5, 1.0)) * (1 - 0.55 * (ease(span(t, 2.6, 3.0)) - ease(span(t, 5.2, 5.6))));
		const right = ease(span(t, 2.6, 3.1));
		return `<div style="position:relative;width:${W}px;height:${H}px">`
			+ `<div class="big" style="position:absolute;top:104px;left:0;width:100%;max-width:none;font-size:84px">${COPY.named}</div>`
			+ `<div class="small" style="position:absolute;top:196px;left:0;width:100%;margin:0;opacity:${ease(span(t, 0.4, 0.8))}">${COPY.namedSmall}</div>`
			+ badge(LEFT, COPY.beforeBadge, 'background:#e4dfd4;color:#6f6a61', left) + badge(RIGHT, COPY.afterBadge, 'background:var(--orange);color:#fff', right)
			+ panel(LEFT, [COPY.beforeLink], left) + panel(RIGHT, COPY.afterLink, right)
			+ label(LEFT, COPY.before, 'var(--muted)', left) + label(RIGHT, COPY.after, 'var(--ink)', right) + `</div>`;
	}

	window.CUT = {
		scenes(take) {
			const m = take.marks;
			// The camera holds the question and its reply. Focus 14 and zoom 2.2 belong to the 80 × 34 take:
			// zoom multiplies the scale that fits the pane's height, which comes to 1.56 here. Claude Code's
			// header (rows 1 to 3 as of 2.1.332: the account's plan and the folder) stays under the caption
			// with about one row to spare, and nothing else blanks it. A lower focus, a taller pane or a
			// taller header shows it, so look at a still of the first take scene after recording again.
			const shot = (len, from, to, caption, small, rest = {}) => ({ kind: 'take', len, from, to, caption, small, focus: 14, zoom: 2.2, ...rest });
			// Each growth starts at the first frame that changed after its press (changed, in kit.js).
			const GROW = 3.2;
			const grown = (mark, len, caption, small) => shot(len, changed(mark.t), changed(mark.t) + len, caption, small, { growth: true });
			return [
				{ kind: 'card', len: 4.5, html: (t) => `<div class="kicker">${COPY.kicker}</div><div class="big">${COPY.title}</div><div class="small" style="opacity:${ease(span(t, 0.9, 1.4))}">${COPY.features}</div>` },
				{ kind: 'card', len: 7, html: namedCard },

				shot(3.6, m.replied.t - 0.2, m.open1.t, COPY.arrives, COPY.arrivesSmall, { click: m.open1 }),
				grown(m.open1, GROW, COPY.grows, COPY.growsSmall),
				shot(1.4, changed(m.open1.t) + GROW, m.open2.t, COPY.only, COPY.onlySmall, { click: m.open2 }),
				grown(m.open2, GROW + 0.6, COPY.only, COPY.onlySmall),

				{ kind: 'card', len: 6.5, html: (t) => `<div class="kicker">${COPY.trialKicker}</div><div class="big" style="font-size:150px">${COPY.trial}</div>`
					+ `<div class="small" style="opacity:${ease(span(t, 0.7, 1.2))}">${COPY.trialSmall}</div><div class="fine" style="opacity:${ease(span(t, 1.6, 2.1))}">${COPY.trialFine}</div>` },
				{ kind: 'card', len: 6.5, clawd: true, html: `<div class="big" style="margin-top:120px">${COPY.title}</div><div class="mono">${COPY.install}</div><div class="small">${COPY.repo}</div>` },
			];
		},
	};
})();

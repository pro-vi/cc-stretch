// The 0.6.0 film's soundtrack, played on the instruments in instruments.js. The title holds the tonic
// under two bells, and the card on the first change holds a chord. Then the electric piano walks the
// progression through the take, the tables and the style toolbar, with a tick at every click: three
// rising music-box notes as a phrase or a table opens, three falling as a phrase closes, and one
// note up the box for each style tried. On the end card the tonic, a note for each word the tagline
// gains, the boing as Clawd is let go, and its chirp.
// window.renderMusic({ total, takes, clicks, boings, named }) resolves a 16-bit stereo WAV as base64;
// named holds the cues the cut's scenes carry.
window.renderMusic = ({ total, takes, clicks, boings = [], named }) => window.playFilm(total, ({ bell, pad, boing, CHORDS, TONIC, walk, clickTicks, held, bellPair, chirp }) => {
	const [title] = named.title, [card] = named.card, [end] = named.end;
	const BOX = [74, 76, 78, 81, 83, 86, 88, 90];
	const rise = (at, from) => [0, 2, 3].forEach((step, k) => bell(at + k * 0.11, BOX[from + step], 0.045));

	// The title, and the first change on its card.
	pad(title, card + 0.4, [TONIC], 0.03);
	held(title + 0.15, 2);
	bellPair(title);
	pad(card, takes[0][0] + 0.4, [CHORDS[2]], 0.03);
	bellPair(card);

	// The take, the tables and the style toolbar.
	walk(takes[0][0], end);
	clickTicks(clicks);
	named.grow.forEach((at, i) => rise(at, i));
	for (const at of named.shrink) [3, 2, 0].forEach((step, k) => bell(at + k * 0.11, BOX[step], 0.04));
	named.tabled.forEach((at, i) => rise(at + 0.15, 2 * i));
	named.looks.forEach((at, i) => bell(at + 0.03, BOX[i], 0.04));

	// The end card: the tonic, and the tagline opening up the music box.
	pad(end, total, [TONIC], 0.035);
	held(end + 0.15, 4);
	bell(end + 0.4, 86, 0.05);
	for (const at of boings) boing(at);
	for (const at of named.chirp) chirp(at);
	[...named.pops].sort((a, b) => a - b).forEach((at, i) => bell(at, BOX[i % BOX.length], 0.05));
});

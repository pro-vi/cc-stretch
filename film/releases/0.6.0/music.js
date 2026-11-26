// The 0.6.0 film's soundtrack, played on the instruments in instruments.js. A busy piano and a key's
// tick for every few words as the long reply is written; a low fifth and a held chord as the camera
// pulls back to all of it; bells as the short reply arrives and lands. Then the electric piano walks
// the progression through the take and the style toolbar, with a tick at every click, three rising
// music-box notes as a phrase opens and three falling as one closes, and one note up the box for
// each style tried. The card on what changed holds a chord. On the 1967
// page a drone, and a music-box note for each word that pops into the sentence, as in the launch
// film; Clawd's chirp as it walks in; and on the end card the tonic, a note for each word the tagline
// gains, the boing as Clawd is let go, and its chirp once more.
// window.renderMusic({ total, takes, clicks, boings, named }) resolves a 16-bit stereo WAV as base64;
// named holds the cues the cut's scenes carry.
window.renderMusic = ({ total, takes, clicks, boings = [], named }) => window.playFilm(total, ({ BEAT, ep, bell, pad, tick, boing, CHORDS, TONIC, walk, clickTicks, held, bellPair, chirp }) => {
	const [back] = named.back, [beside] = named.beside, [landed] = named.landed;
	const [changed] = named.card, [paper] = named.paper, [never] = named.never, [end] = named.end;
	const BOX = [74, 76, 78, 81, 83, 86, 88, 90];

	// The long reply: a pad and a piano that gets louder as the words pile up.
	pad(0, back + 0.3, CHORDS.slice(0, 2), 0.022);
	for (let i = 0, at = 0.2; at < back - 0.1; i++, at = 0.2 + (i * BEAT) / 2) ep(at, CHORDS[Math.floor(i / 8) % 2][(i * 3) % 5] + 12, 0.045 + 0.003 * i, 0.9);
	for (const at of named.typed) tick(at, 1600 + Math.random() * 300, 0.16);
	// All of it at once: the piano stops on a low fifth and a held chord.
	pad(back, beside + 0.4, [CHORDS[3]], 0.03);
	ep(back + 0.05, 38, 0.12, 2.6);
	ep(back + 0.05, 45, 0.07, 2.6);
	// The short reply beside it, and its landing in the terminal.
	pad(beside, landed + 0.4, [TONIC], 0.03);
	bellPair(beside - 0.1);
	bell(landed, 86, 0.05);

	// The take, and the style toolbar after it.
	walk(takes[0][0], changed);
	clickTicks(clicks);
	named.looks.forEach((at, i) => bell(at + 0.03, BOX[i], 0.04));
	named.grow.forEach((at, i) => [0, 2, 3].forEach((step, k) => bell(at + k * 0.11, BOX[i + step], 0.045)));
	for (const at of named.shrink) [3, 2, 0].forEach((step, k) => bell(at + k * 0.11, BOX[step], 0.04));

	// What changed.
	pad(changed, paper + 0.4, [CHORDS[2]], 0.03);
	bellPair(changed);
	// 1967: a drone, and a note for each word that pops into a gap.
	pad(paper, never + 0.4, [[38, 50, 57]], 0.026);
	ep(paper + 0.3, 74, 0.07, 2.5);
	// It never caught on, until Clawd walks in.
	pad(never, end + 0.4, [CHORDS[2]], 0.03);
	for (const at of named.chirp) chirp(at);

	// The end card: the tonic, and the tagline opening.
	pad(end, total, [TONIC], 0.035);
	held(end + 0.15, 4);
	bell(end + 0.4, 86, 0.05);
	for (const at of boings) boing(at);
	// Each stretched sentence plays up the music box from its own first note.
	let since = -Infinity, note = 0;
	for (const at of [...named.pops].sort((a, b) => a - b)) {
		if (at - since > 2) note = 0;
		bell(at, BOX[note++ % BOX.length], 0.05);
		since = at;
	}
});

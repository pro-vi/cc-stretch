// The 0.6.0 film's score, written for it: in F major, at the beat the cut is laid out on, which it
// reads from window.CUT.beat. A marimba, a bass, a kick, a snap, a shaker and a pad, built here, play
// with the bells, room and Clawd's sounds of instruments.js. No click in the film has a sound of its own: each lands on a beat and is
// a marimba note of the score. A click that opens a phrase plays its bar's chord upward under a
// bell, the click that closes one plays it downward, and the eight clicks on the style toolbar are
// the tune of their bars, a note to a click, which leads to the title's chord. "Before" on the card
// and release 0.5.6's table get one note three times, fading; "Now" and release 0.6.0's table get the
// rising chord. The opening climbs in sixteenths while the long reply is written and stops on a low
// fifth as the camera pulls back; the end card holds the home chord under a bell for each word the
// tagline gains, the boing as Clawd is let go, and its chirp.
// window.renderMusic({ total, boings, named }) resolves a 16-bit stereo WAV as base64; named holds the
// cues the cut's scenes carry, in the film's seconds.
window.renderMusic = ({ total, boings = [], named }) => window.playFilm(total, ({ ctx, bus, hz, noise, bell, boing, chirp }) => {
	const BEAT = window.CUT.beat, BAR = 4 * BEAT, STEP = BEAT / 4;
	const wood = bus(0.8, 0.3), low = bus(1, 0), kit = bus(0.8, 0.12), air = bus(0.7, 0.6);

	// --- the instruments -----------------------------------------------------------------------------
	/** One oscillator from `at`: up to `vel` in `attack` seconds, then dying away to nothing by `len`. */
	function struck(out, type, freq, at, vel, attack, len) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type; o.frequency.value = freq;
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(vel, at + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, at + len);
		o.connect(g).connect(out);
		o.start(at); o.stop(at + len + 0.05);
	}
	/** One oscillator sustained for `len` seconds: up to `vel`, down to three fifths of it, and let go at the end. */
	function sustained(out, type, freq, at, vel, len) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type; o.frequency.value = freq;
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(vel, at + 0.008);
		g.gain.setTargetAtTime(vel * 0.6, at + 0.008, 0.08);
		g.gain.setTargetAtTime(0, at + len, 0.04);
		o.connect(g).connect(out);
		o.start(at); o.stop(at + len + 0.3);
	}
	/** A burst of noise through one filter. */
	function burst(out, at, len, decay, type, freq, vel, q = 1) {
		const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
		s.buffer = noise(len, decay); f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = vel;
		s.connect(f).connect(g).connect(out); s.start(at);
	}
	/** A marimba bar: its note, the octave over it, and for a moment the overtone two octaves up. Struck `hard`, the mallet's knock sounds too. */
	function marimba(at, midi, vel, hard = false) {
		struck(wood, 'sine', hz(midi), at, vel, 0.003, 0.7);
		struck(wood, 'sine', hz(midi) * 2, at, vel * 0.3, 0.003, 0.4);
		struck(wood, 'sine', hz(midi) * 4, at, vel * (hard ? 0.5 : 0.3), 0.002, 0.12);
		if (hard) burst(wood, at, 0.03, 0.005, 'bandpass', 1800, vel * 1.2);
	}
	/** A bass note: a sine, a triangle on it, and a sine an octave up, which small speakers still play. */
	function bass(at, midi, len, vel = 0.05) {
		sustained(low, 'sine', hz(midi), at, vel, len);
		sustained(low, 'triangle', hz(midi), at, vel * 0.5, len);
		sustained(low, 'sine', hz(midi + 12), at, vel * 0.5, len);
	}
	function kick(at, vel = 0.11) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.frequency.setValueAtTime(115, at);
		o.frequency.exponentialRampToValueAtTime(46, at + 0.1);
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(vel, at + 0.004);
		g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
		o.connect(g).connect(low);
		o.start(at); o.stop(at + 0.32);
	}
	const snap = (at, vel = 0.085) => { burst(kit, at, 0.12, 0.02, 'bandpass', 2100, vel, 1.4); burst(kit, at + 0.011, 0.12, 0.025, 'bandpass', 1700, vel * 0.8, 1.2); };
	const shake = (at, vel) => burst(kit, at, 0.06, 0.012, 'highpass', 6500, vel);
	/** A chord on the pad for `len` seconds, each note two saws a few cents apart; it fades in and out, so one chord runs into the next. */
	function pad(at, len, notes, vel = 0.03) {
		const f = ctx.createBiquadFilter(), g = ctx.createGain();
		f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(vel, at + 0.3);
		g.gain.setValueAtTime(vel, at + len);
		g.gain.linearRampToValueAtTime(0, at + len + 0.45);
		g.connect(f).connect(air);
		for (const m of notes) for (const detune of [-6, 6]) {
			const o = ctx.createOscillator(), soft = ctx.createGain();
			o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = detune; soft.gain.value = 0.25;
			o.connect(soft).connect(g); o.start(at); o.stop(at + len + 0.5);
		}
	}

	// --- the chords ----------------------------------------------------------------------------------
	// Each as the pad's notes, the bass's root, and the marimba's four, low to high.
	const F = { pad: [53, 57, 60, 67], root: 41, tones: [65, 69, 72, 77] };
	const Am = { pad: [52, 57, 60, 67], root: 45, tones: [64, 69, 72, 76] };
	const Bb = { pad: [53, 58, 62, 69], root: 46, tones: [65, 70, 74, 77] };
	const C = { pad: [55, 60, 64, 67], root: 48, tones: [67, 72, 76, 79] };
	const Dm = { pad: [53, 57, 60, 65], root: 50, tones: [65, 69, 74, 77] };
	const Gm = { pad: [55, 58, 62, 65], root: 43, tones: [67, 70, 74, 77] };
	const Csus = { pad: [55, 58, 60, 65], root: 48, tones: [67, 70, 72, 77] };
	const C7 = { pad: [55, 58, 60, 64], root: 48, tones: [72, 76, 79, 82] };

	// --- the groove ----------------------------------------------------------------------------------
	const [opening] = named.opening, [writes, written] = named.written, [arrives] = named.arrives, [pickup] = named.pickup, [reply] = named.reply;
	const [styles] = named.styles, [title] = named.title, [card] = named.card, [tables] = named.tables, [end] = named.end;
	// The clicks and arrivals that play a figure of their own: the marimba's riff rests for the beat each takes.
	const figures = [...named.open, ...named.shut, ...named.label, ...named.point, ...named.asTyped, ...named.drawn];
	const isTaken = (t) => figures.some((from) => t > from - 0.01 && t < from + BEAT - 0.01);
	// The marimba's riff over a bar: the beat each note falls on, and which of the chord's four it is.
	const RIFF = [[0, 0], [1, 2], [1.5, 1], [2.5, 3], [3, 2]];
	/**
	 * `beats` beats of the groove under a chord, from `at`: the pad; the bass on the first beat, before
	 * the third, and on the fourth the chord's fifth, a fourth below the root; the shaker's eighths;
	 * with `kicks`, a kick on the first beat, a snap on the third and a softer kick after it; and the
	 * marimba's riff, which rests on the beats in `figures`.
	 */
	function groove(at, chord, { beats, kicks = true }) {
		pad(at, beats * BEAT, chord.pad);
		for (const [beat, midi, len] of [[0, chord.root, 1.3], [1.5, chord.root, 0.4], [3, chord.root - 5, 0.8]]) {
			if (beat < beats) bass(at + beat * BEAT, midi, Math.min(len, beats - beat) * BEAT);
		}
		for (let eighth = 0; eighth < beats * 2; eighth++) shake(at + (eighth * BEAT) / 2, eighth % 2 ? 0.034 : 0.018);
		if (kicks) {
			kick(at);
			if (beats > 2) snap(at + 2 * BEAT);
			if (beats > 2.5) kick(at + 2.5 * BEAT, 0.07);
		}
		RIFF.forEach(([beat, tone], i) => { if (beat < beats && !isTaken(at + beat * BEAT)) marimba(at + beat * BEAT, chord.tones[tone], i === 0 ? 0.1 : 0.082); });
	}
	/** Plays chords one after another from `from`, each for a bar unless it gives its beats, and returns the chord that sounds at a time. */
	function section(from, parts, options = {}) {
		const spans = [];
		let at = from;
		for (const part of parts) {
			const [chord, beats = 4] = Array.isArray(part) ? part : [part];
			groove(at, chord, { ...options, beats });
			spans.push([at, chord]);
			at += beats * BEAT;
		}
		return (t) => spans.findLast(([start]) => start <= t + 0.01)[1];
	}
	/** A click that opens something: the chord's four notes upward, a sixteenth apart, and a bell over the last. */
	const rise = (at, { tones }) => { tones.forEach((midi, i) => marimba(at + i * STEP, midi, 0.12 + 0.01 * i, i === 0)); bell(at + 3 * STEP, tones[3] + 12, 0.05); };
	/** A click that closes something: the four notes downward. */
	const fall = (at, { tones }) => [...tones].reverse().forEach((midi, i) => marimba(at + i * STEP, midi, 0.15 - 0.01 * i, i === 0));
	/** What falls short: one note three times, fading. */
	const flat = (at, { tones }) => [0.14, 0.09, 0.055].forEach((vel, i) => marimba(at + i * STEP, tones[1], vel, i === 0));
	/** An arrival: the chord struck from the bottom up with a bell at the top, the bass and a kick under it, and the pad for `len` seconds. */
	function arrive(at, chord, len, vel = 1) {
		pad(at, len, chord.pad, 0.04 * vel);
		bass(at, chord.root, Math.min(len, 3 * BEAT), 0.06 * vel);
		kick(at, 0.11 * vel);
		chord.tones.forEach((midi, i) => marimba(at + i * 0.035, midi, 0.12 * vel, i === 0));
		bell(at + 0.14, chord.tones[3] + 12, 0.055 * vel);
	}

	// --- the film ------------------------------------------------------------------------------------
	// The opening: sixteenths that climb and swell while the long reply is written, an octave higher for
	// the last eight, and stop on a low fifth as the camera pulls back to all of it.
	pad(opening, written - opening, Dm.pad, 0.028);
	const RUN = [62, 65, 69, 72, 74, 72, 69, 65], run = Math.round((written - writes) / STEP);
	for (let i = 0; i < run; i++) {
		marimba(writes + i * STEP, RUN[i % 8] + (i >= run - 8 ? 12 : 0), 0.05 + 0.0045 * i);
		if (i % 2 === 0) shake(writes + i * STEP, 0.012 + 0.001 * i);
	}
	pad(written, arrives - written, Csus.pad, 0.042);
	bass(written, 36, arrives - written - 0.1, 0.07);
	marimba(written, 48, 0.15, true);
	marimba(written, 55, 0.12);
	marimba(written + 2 * BEAT, 60, 0.07);
	// The short reply beside it: two bells, and three notes up its chord. Then four up a chord that
	// wants the home one, into the groove.
	pad(arrives, pickup - arrives, Bb.pad, 0.038);
	bass(arrives, Bb.root, pickup - arrives - 0.1, 0.05);
	bell(arrives, 81, 0.055);
	bell(arrives + BEAT / 2, 86, 0.05);
	[70, 74, 77].forEach((midi, i) => marimba(arrives + (1 + i) * BEAT, midi, 0.075));
	pad(pickup, reply - pickup, C7.pad, 0.036);
	bass(pickup, C7.root, reply - pickup - 0.1, 0.05);
	C7.tones.forEach((midi, i) => { marimba(pickup + (i * BEAT) / 2, midi, 0.09 + 0.02 * i); shake(pickup + (i * BEAT) / 2, 0.03); });
	snap(pickup + BEAT);

	// The reply and its three clicks, eight bars.
	const verse = section(reply, [F, Am, Bb, C, Dm, Am, Bb, Csus]);
	for (const t of named.open) rise(t, verse(t));
	for (const t of named.shut) fall(t, verse(t));

	// The style toolbar, three bars that lead home: the riff plays until the first click, and from
	// there the clicks are the tune, a note each.
	const TUNE = [74, 77, 79, 82, 81, 79, 77, 76];
	const [firstLook] = named.looks;
	figures.push(...named.looks, firstLook + 8 * BEAT);
	section(styles, [Dm, Gm, [Csus, 2], [C, 2]]);
	named.looks.forEach((t, i) => marimba(t, TUNE[i], 0.17, true));

	// The title, on the home chord, with a bell after it and two notes into the card. The card's bars
	// have no kick; "Before" is flat and "Now" rising.
	arrive(title, F, card - title);
	bell(title + 2 * BEAT, 84, 0.04);
	marimba(card - BEAT, 72, 0.08);
	marimba(card - BEAT / 2, 74, 0.09);
	const bridge = section(card, [Bb, Dm, [Gm, 2], [Csus, 2]], { kicks: false });
	for (const t of named.label) flat(t, bridge(t));
	for (const t of named.point) rise(t, bridge(t));

	// The tables, four bars: release 0.5.6's click flat, release 0.6.0's rising.
	const chorus = section(tables, [F, Am, Bb, [Csus, 2], [C, 2]]);
	for (const t of named.asTyped) flat(t, chorus(t));
	for (const t of named.drawn) rise(t, chorus(t));

	// The end card: the home chord held, the click on the tagline, a bell up the scale on the nearest
	// sixteenth for each word the tagline gains, Clawd's boing and chirp, and the home note once more.
	arrive(end, F, total - end, 0.9);
	for (const t of named.tagline) marimba(t, 81, 0.15, true);
	const SCALE = [72, 74, 77, 79, 81, 84, 86, 89];
	[...named.pops].sort((a, b) => a - b).forEach((t, i) => bell(end + Math.round((t - end) / STEP) * STEP, SCALE[i % SCALE.length], 0.055));
	for (const t of boings) boing(t);
	for (const t of named.chirp) chirp(t);
	const last = end + 2 * BAR;
	marimba(last, 65, 0.1);
	marimba(last, 77, 0.1);
	bass(last, F.root, 2 * BEAT, 0.05);
});

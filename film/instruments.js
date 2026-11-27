// The instruments every film's soundtrack is played on: a soft FM electric piano, pads, a music-box
// bell, a sub, ticks for clicks and runs of typing, a brown switch for a single key, a boing for a
// spring let go, a thud for a landing, and a chiptune square, through one compressor and room, with
// the phrases more than one film plays on them. A film's own score may build further instruments on
// what arrange is handed: the context, the master, bus (a channel into the master with a send to the
// room), hz and noise.
// window.playFilm(total, arrange) builds them for `total` seconds, lets `arrange` place the notes, renders
// offline, and resolves a 16-bit stereo WAV as base64.
window.playFilm = async (total, arrange) => {
	const RATE = 48000, BEAT = 60 / 96, BAR = BEAT * 4;
	const ctx = new OfflineAudioContext(2, Math.ceil(total * RATE), RATE);
	const master = ctx.createDynamicsCompressor();
	master.threshold.value = -18; master.ratio.value = 2.5; master.attack.value = 0.02; master.release.value = 0.3;
	const out = ctx.createGain(); out.gain.value = 2.2;
	master.connect(out).connect(ctx.destination);

	// A soft room: decaying, lowpassed stereo noise as the impulse response.
	const room = ctx.createConvolver();
	const ir = ctx.createBuffer(2, RATE * 2.8, RATE);
	for (let c = 0; c < 2; c++) {
		const d = ir.getChannelData(c);
		let lp = 0;
		for (let i = 0; i < d.length; i++) { lp += 0.25 * ((Math.random() * 2 - 1) - lp); d[i] = lp * (1 - i / d.length) ** 2.5; }
	}
	room.buffer = ir;
	const wet = ctx.createGain(); wet.gain.value = 0.55;
	room.connect(wet).connect(master);
	const bus = (dry, send) => { const g = ctx.createGain(); g.gain.value = dry; g.connect(master); const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(room); return g; };
	const keys = bus(0.8, 0.5), pads = bus(0.7, 0.6), bells = bus(0.5, 0.8), fx = bus(0.6, 0.15);
	const chipTone = ctx.createBiquadFilter(); chipTone.type = 'lowpass'; chipTone.frequency.value = 5000;
	const chip = ctx.createGain(); chip.gain.value = 0.45; chip.connect(chipTone).connect(master);

	const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
	/** An electric piano note: a sine carrier whose brightness (FM index) decays with the note. */
	function ep(at, midi, vel = 0.12, len = 1.6, out = keys) {
		const car = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), amp = ctx.createGain();
		car.frequency.value = hz(midi); mod.frequency.value = hz(midi);
		modGain.gain.setValueAtTime(hz(midi) * 1.6, at);
		modGain.gain.exponentialRampToValueAtTime(hz(midi) * 0.15, at + 0.5);
		amp.gain.setValueAtTime(0, at);
		amp.gain.linearRampToValueAtTime(vel, at + 0.006);
		amp.gain.exponentialRampToValueAtTime(vel * 0.35, at + 0.4);
		amp.gain.exponentialRampToValueAtTime(0.0001, at + len);
		mod.connect(modGain).connect(car.frequency);
		car.connect(amp).connect(out);
		car.start(at); mod.start(at); car.stop(at + len + 0.05); mod.stop(at + len + 0.05);
	}
	/** A music-box bell: inharmonic FM, short and high. */
	function bell(at, midi, vel = 0.06) {
		const car = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), amp = ctx.createGain();
		car.frequency.value = hz(midi); mod.frequency.value = hz(midi) * 3.5;
		modGain.gain.setValueAtTime(hz(midi) * 2, at); modGain.gain.exponentialRampToValueAtTime(1, at + 1.2);
		amp.gain.setValueAtTime(0, at); amp.gain.linearRampToValueAtTime(vel, at + 0.003); amp.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
		mod.connect(modGain).connect(car.frequency); car.connect(amp).connect(bells);
		car.start(at); mod.start(at); car.stop(at + 1.5); mod.stop(at + 1.5);
	}
	/** One continuous pad across [a, b], moving through `chords` (one per bar) with crossfades. */
	function pad(a, b, chords, vel = 0.03) {
		const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
		f.connect(pads);
		let bar = 0;
		for (let at = a; at < b - 0.05; at += BAR, bar++) {
			const end = Math.min(b, at + BAR);
			const g = ctx.createGain();
			const fadeIn = bar === 0 ? 0.8 : 0.35, fadeOut = end >= b - 0.01 ? 0.8 : 0.35;
			g.gain.setValueAtTime(0, at);
			g.gain.linearRampToValueAtTime(vel, at + fadeIn);
			g.gain.setValueAtTime(vel, Math.max(at + fadeIn, end - 0.01));
			g.gain.linearRampToValueAtTime(0, end + fadeOut);
			g.connect(f);
			for (const m of chords[bar % chords.length]) for (const detune of [-6, 6]) {
				const o = ctx.createOscillator();
				o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = detune;
				const soft = ctx.createGain(); soft.gain.value = 0.25;
				o.connect(soft).connect(g); o.start(at); o.stop(end + fadeOut + 0.05);
			}
		}
	}
	function sub(at, midi, len, vel = 0.08) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.frequency.value = hz(midi);
		g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vel, at + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
		o.connect(g).connect(master); o.start(at); o.stop(at + len + 0.05);
	}
	/** Noise `len` seconds long that dies away by a factor of e every `decay` seconds. */
	function noise(len, decay) {
		const b = ctx.createBuffer(1, Math.ceil(RATE * len), RATE), d = b.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (RATE * decay));
		return b;
	}
	/** A soft tick, a mouse button or a key in a run of typing: a short, low-passed knock with a little body under it. */
	function tick(at, freq, vel) {
		const b = noise(0.03, 0.004);
		const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), soft = ctx.createBiquadFilter(), g = ctx.createGain();
		s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2.5; soft.type = 'lowpass'; soft.frequency.value = 3200; g.gain.value = vel;
		s.connect(f).connect(soft).connect(g).connect(fx); s.start(at);
		const body = ctx.createOscillator(), bg = ctx.createGain();
		body.frequency.value = freq / 8;
		bg.gain.setValueAtTime(vel * 0.5, at); bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
		body.connect(bg).connect(fx); body.start(at); body.stop(at + 0.05);
	}
	/**
	 * A tactile mechanical key, as a brown switch sounds: a faint bump on the way down, a short clack
	 * as it bottoms out on the plate with the plate and case ringing under it, and a lighter clack as
	 * it springs back up. Each press is pitched a little differently, as no two strokes match.
	 */
	function brownSwitch(at, vel = 0.5) {
		const jitter = 1 + (Math.random() - 0.5) * 0.08;
		const burst = (t, freq, q, decay, gain) => {
			const b = noise(decay * 6, decay);
			const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
			s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq * jitter; f.Q.value = q; g.gain.value = gain;
			s.connect(f).connect(g).connect(fx); s.start(t);
		};
		const ring = (t, freq, decay, gain) => {
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.frequency.value = freq * jitter;
			g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
			o.connect(g).connect(fx); o.start(t); o.stop(t + decay + 0.01);
		};
		burst(at, 4200, 2, 0.0015, vel * 0.12);
		burst(at + 0.012, 2000, 1.4, 0.004, vel * 0.9);
		ring(at + 0.012, 520, 0.045, vel * 0.25);
		burst(at + 0.11, 2800, 1.6, 0.003, vel * 0.45);
		ring(at + 0.11, 640, 0.03, vel * 0.1);
	}
	/**
	 * A spring let go: a soft tone that leaps up in pitch and wobbles back down as its swing dies, the
	 * cartoon sound of a stretched thing snapping back, with a triangle an octave under it for body.
	 */
	function boing(at, vel = 0.09) {
		const from = 170, peak = 430;
		for (const [type, scale, gain] of [['sine', 1, vel], ['triangle', 0.5, vel * 0.45]]) {
			const o = ctx.createOscillator(), wobble = ctx.createOscillator(), depth = ctx.createGain(), amp = ctx.createGain();
			o.type = type;
			o.frequency.setValueAtTime(from * scale, at);
			o.frequency.exponentialRampToValueAtTime(peak * scale, at + 0.07);
			o.frequency.exponentialRampToValueAtTime(peak * 0.62 * scale, at + 0.55);
			wobble.frequency.value = 17;
			depth.gain.setValueAtTime(peak * 0.16 * scale, at + 0.04);
			depth.gain.exponentialRampToValueAtTime(0.5, at + 0.55);
			wobble.connect(depth).connect(o.frequency);
			amp.gain.setValueAtTime(0, at);
			amp.gain.linearRampToValueAtTime(gain, at + 0.012);
			amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
			o.connect(amp).connect(fx);
			o.start(at); wobble.start(at); o.stop(at + 0.62); wobble.stop(at + 0.62);
		}
	}
	/** A soft landing: a low tone falling away under a short, muffled puff of noise. */
	function thud(at, vel = 0.12) {
		const o = ctx.createOscillator(), amp = ctx.createGain();
		o.frequency.setValueAtTime(120, at);
		o.frequency.exponentialRampToValueAtTime(48, at + 0.16);
		amp.gain.setValueAtTime(0, at);
		amp.gain.linearRampToValueAtTime(vel, at + 0.004);
		amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
		o.connect(amp).connect(fx);
		o.start(at); o.stop(at + 0.24);
		const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
		n.buffer = noise(0.12, 0.02); f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = vel * 0.5;
		n.connect(f).connect(g).connect(fx); n.start(at);
	}
	function square(at, midi, len, vel = 0.035, type = 'square') {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type; o.frequency.value = hz(midi);
		g.gain.setValueAtTime(vel, at); g.gain.setValueAtTime(vel, at + len * 0.8); g.gain.linearRampToValueAtTime(0, at + len * 0.95);
		o.connect(g).connect(chip); o.start(at); o.stop(at + len);
	}

	// D major: Dmaj9, Bm9, Gmaj7, A6sus, voiced in the middle register.
	const CHORDS = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 59], [45, 52, 57, 59, 62]];
	const ROOTS = [38, 35, 31, 33];
	const TONIC = [50, 57, 61, 64, 69];
	/** The electric piano walking the progression from `from` to `to`, a chord a bar, over its pad and sub. */
	function walk(from, to) {
		pad(from, to + 0.4, CHORDS, 0.024);
		for (let bar = 0, at = from; at < to; bar++, at = from + bar * BAR) {
			const chord = CHORDS[bar % 4];
			sub(at, ROOTS[bar % 4], BAR * 0.9);
			[0, 1.5, 2, 3].forEach((beat, i) => { if (at + beat * BEAT < to) ep(at + beat * BEAT, chord[(i * 2 + 1) % 5] + 12, i === 0 ? 0.08 : 0.055, 1.2); });
		}
	}
	/** A mouse button pressed and released at each of `times`. */
	const clickTicks = (times) => { for (const t of times) { tick(t, 1300, 0.4); tick(t + 0.07, 1100, 0.3); } };
	/** The tonic's top three notes held on the piano for `len`. */
	const held = (at, len) => { ep(at, 62, 0.08, len); ep(at, 66, 0.06, len); ep(at, 69, 0.06, len); };
	/** Two bells rising, a card's arrival. */
	const bellPair = (at) => { bell(at + 0.3, 81, 0.04); bell(at + 0.6, 85, 0.035); };
	/** Clawd's two-note chirp. */
	const chirp = (at) => { square(at, 84, 0.08); square(at + 0.12, 91, 0.12); };
	arrange({ ctx, master, bus, hz, noise, BEAT, ep, bell, pad, tick, brownSwitch, square, boing, thud, CHORDS, TONIC, walk, clickTicks, held, bellPair, chirp });

	const rendered = await ctx.startRendering();
	const n = rendered.length, bytes = new DataView(new ArrayBuffer(44 + n * 4));
	const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
	str(0, 'RIFF'); bytes.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
	bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
	bytes.setUint32(24, RATE, true); bytes.setUint32(28, RATE * 4, true); bytes.setUint16(32, 4, true); bytes.setUint16(34, 16, true);
	str(36, 'data'); bytes.setUint32(40, n * 4, true);
	const ch = [rendered.getChannelData(0), rendered.getChannelData(1)];
	for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) bytes.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
	let s = '';
	const u = new Uint8Array(bytes.buffer);
	for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
	return btoa(s);
};

// Renders a film frame by frame from its page and recorded take, then muxes the music. Without
// --release it is the launch film, from film.html and out/take; with --release=<version> it is that
// release's film, from release.html, releases/<version>/cut.js and out/releases/<version>/take, with a
// take-<name> beside it for each take the cut names in CUT.takes, and releases/<version>/music.js for
// its soundtrack if the release has one.
//   node film/compose.mjs --stills=1,9,20     one JPEG per time, in out/stills/
//   node film/compose.mjs --audio             the soundtrack alone, out/soundtrack.wav
//   node film/compose.mjs --mux               new sound over the frames already rendered
//   node film/compose.mjs --fress             the launch cut with the 1976 Brown film, out/cc-stretch-fress.mp4
//   node film/compose.mjs                     every frame, the soundtrack, out/cc-stretch.mp4, and a
//                                             copy under 10 MB, cc-stretch-web.mp4, when it is larger
//   node film/compose.mjs --release=0.4.0 …   any of these but --fress for that release's film, in
//                                             out/releases/0.4.0, as cc-stretch-0.4.0.mp4
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { LEAK, parseScreen, plainRows, PRIVATE } from './screen.mjs';

const FILM = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const release = process.argv.find((a) => a.startsWith('--release='))?.slice(10);
const OUT = release ? `${FILM}/out/releases/${release}` : `${FILM}/out`;
const FPS = 30;
const stills = process.argv.find((a) => a.startsWith('--stills='))?.slice(9).split(',').map(Number);

function readTake(dir) {
	const marks = JSON.parse(readFileSync(`${dir}/marks.json`, 'utf8'));
	const cols = marks.size?.cols ?? 100;
	// A row's text, and its runs as last drawn with its margin plain.
	const clean = new Map();
	const frames = readFileSync(`${dir}/frames.jsonl`, 'utf8').trim().split('\n').map((line) => {
		const f = JSON.parse(line);
		const rows = parseScreen(f.screen).map((runs) => (PRIVATE.test(runs.map((r) => r.text).join('')) ? [] : runs));
		// A paragraph's first row can carry the style the paragraph before it ends in, a stretch's
		// underline or a letter's background, from its margin on: as of WezTerm 20260905-195314-b99b1ca2,
		// get-text left out a reset (see firstCarriedRow in screen.mjs), and the pane never drew it.
		// readScreen in recorder.mjs reads such rows again, so mostly takes recorded before it have them.
		// The margin is never styled otherwise, so such a row is drawn as it was last drawn plain, or
		// failing that with its indent and list marker plain.
		const texts = plainRows(rows);
		rows.forEach((runs, i) => {
			const first = runs[0];
			const isBled = first !== undefined && first.col === 0 && /^\s/.test(first.text) && (first.underline || first.bg !== null || first.inverse);
			if (!isBled) {
				if (texts[i].trim() !== '') clean.set(texts[i], runs);
				return;
			}
			const seen = clean.get(texts[i]);
			if (seen !== undefined) {
				rows[i] = seen.map((run) => ({ ...run }));
				return;
			}
			const lead = /^\s+(?:(?:[-*+]|\d+[.)])\s+)?/.exec(first.text)?.[0] ?? '';
			const plainLead = { ...first, text: lead, fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
			runs.splice(0, 1, plainLead, ...(first.text.length > lead.length ? [{ ...first, text: first.text.slice(lead.length), col: lead.length }] : []));
		});
		// A user-variable sequence that landed on the composer's border: the border is drawn whole again
		// and the pushed-over end dropped.
		rows.forEach((runs, i) => {
			if (!LEAK.test(runs.map((r) => r.text).join(''))) return;
			rows[i] = [{ ...runs[0], text: '─'.repeat(cols), col: 0 }];
			const next = rows[i + 1]?.[0];
			if (next?.col === 0 && /^─+\S/.test(next.text)) next.text = next.text.replace(/^─+/, (bar) => ' '.repeat(bar.length));
		});
		return { t: f.t, rows };
	});
	return { frames, marks };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const withFress = process.argv.includes('--fress');
if (release) {
	await page.goto(`file://${FILM}/release.html`);
	await page.addScriptTag({ path: `${FILM}/releases/${release}/cut.js` });
	// The main take is out/…/take; a cut that names others, CUT.takes = ['table', 'table-before'], has each in take-<name>.
	const names = await page.evaluate(() => window.CUT.takes ?? []);
	const takes = Object.fromEntries([['main', readTake(`${OUT}/take`)], ...names.map((name) => [name, readTake(`${OUT}/take-${name}`)])]);
	await page.evaluate((all) => { window.TAKES = all; window.TAKE = all.main; }, takes);
} else {
	execFileSync('npx', ['-y', 'esbuild@0.25', `${FILM}/grow-entry.ts`, '--bundle', '--format=iife', '--global-name=Grow', `--outfile=${OUT}/grow.js`], { stdio: 'ignore' });
	await page.goto(`file://${FILM}/film.html`);
	await page.addScriptTag({ content: readFileSync(`${OUT}/grow.js`, 'utf8') });
	await page.evaluate((take) => { window.TAKE = take; }, readTake(`${OUT}/take`));

	// The launch film's archive pictures live in out/assets (git-ignored; see out/assets/CREDITS.md).
	// Without them it falls back to a plain card. --fress swaps the 1969 close-up for the 1976 Brown film.
	const ASSETS = `${OUT}/assets`;
	const archive = existsSync(`${ASSETS}/hes-1969-ibm2250-console-1920.png`) ? {
		console: `file://${ASSETS}/hes-1969-ibm2250-console-1920.png`,
		closeup: `file://${ASSETS}/hes-1969-ibm2250-lightpen-closeup-1920.png`,
		nelson: `file://${ASSETS}/ted-nelson-2010-murch-1920.jpg`,
		fress: null,
	} : null;
	if (archive && withFress) {
		mkdirSync(`${ASSETS}/fress-frames`, { recursive: true });
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '16.3', '-t', '2.0', '-i', `${ASSETS}/fress-1976-lightpen-opens-text.mp4`, '-vf', 'fps=30,scale=1920:-2', `${ASSETS}/fress-frames/%03d.jpg`]);
		archive.fress = Array.from({ length: 60 }, (_, i) => `file://${ASSETS}/fress-frames/${String(i + 1).padStart(3, '0')}.jpg`);
	}
	await page.evaluate((a) => { window.ARCHIVE = a; }, archive);
}
// Every face the page's stylesheets name is loaded before the first frame: as of Playwright 1.62.0's
// Chromium a face loads when text is first set in it, so a scene that measures text in a face not yet
// used would measure a fallback font.
const unloaded = await page.evaluate(async () => (await Promise.all([...document.fonts].map((face) => face.load().then(() => null, () => `${face.weight} ${face.family}`)))).filter(Boolean));
if (unloaded.length > 0) console.log('faces that did not load, so text measured in them is off:', [...new Set(unloaded)].join(', '));
const FINAL = `${OUT}/${release ? `cc-stretch-${release}` : withFress ? 'cc-stretch-fress' : 'cc-stretch'}.mp4`;
await page.evaluate(() => window.setState({ t: 0 }));
const total = await page.evaluate(() => window.TOTAL);

async function shoot(t, path) {
	await page.evaluate((s) => window.setState(s), { t });
	await page.screenshot({ path, type: 'jpeg', quality: 92 });
}

async function soundtrack() {
	const cues = await page.evaluate(() => ({ total: window.TOTAL, clicks: window.CLICKS, typing: window.TYPING, ...window.CUES }));
	await page.addScriptTag({ path: `${FILM}/instruments.js` });
	const ownMusic = release && `${FILM}/releases/${release}/music.js`;
	await page.addScriptTag({ path: !release ? `${FILM}/music.js` : existsSync(ownMusic) ? ownMusic : `${FILM}/release-music.js` });
	const wav = await page.evaluate((c) => window.renderMusic(c), cues);
	writeFileSync(`${OUT}/soundtrack.wav`, Buffer.from(wav, 'base64'));
}

if (process.argv.includes('--audio')) {
	await soundtrack();
	await browser.close();
	console.log('soundtrack', total.toFixed(2), 's ->', `${OUT}/soundtrack.wav`);
	process.exit(0);
}

if (stills) {
	mkdirSync(`${OUT}/stills`, { recursive: true });
	for (const t of stills) await shoot(t, `${OUT}/stills/t_${t}.jpg`);
	console.log('total', total.toFixed(2), 's; stills', stills.join(' '));
	await browser.close();
	process.exit(0);
}

// --mux reuses the frames already in out/frames and renders only the sound.
if (!process.argv.includes('--mux')) {
	rmSync(`${OUT}/frames`, { recursive: true, force: true });
	mkdirSync(`${OUT}/frames`, { recursive: true });
	const count = Math.round(total * FPS);
	for (let i = 0; i < count; i++) {
		await shoot(i / FPS, `${OUT}/frames/${String(i).padStart(5, '0')}.jpg`);
		if (i % 150 === 0) console.log('frame', i, 'of', count);
	}
}
await soundtrack();
await browser.close();

// One fixed gain to -16 LUFS, measured first, so the level never rides up and down with the music.
// ffmpeg prints the ebur128 summary on stderr.
const measured = spawnSync('ffmpeg', ['-hide_banner', '-i', `${OUT}/soundtrack.wav`, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const loudness = Number(/I:\s+(-?[\d.]+) LUFS/.exec(measured.split('Summary').at(-1) ?? '')?.[1]);
if (!Number.isFinite(loudness)) throw new Error('could not measure the soundtrack loudness');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${OUT}/frames/%05d.jpg`, '-i', `${OUT}/soundtrack.wav`,
	'-filter_complex', `[1:a]volume=${(-16 - loudness).toFixed(2)}dB,alimiter=limit=0.89:level=false,afade=t=in:d=0.2,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[a]`, '-map', '0:v', '-map', '[a]',
	'-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', FINAL]);
const size = statSync(FINAL).size;
console.log('done', total.toFixed(2), 's ->', FINAL, size, 'bytes');

// A video attached to a GitHub comment or release note plays inline up to 10 MB on a free plan (GitHub
// Docs, "Attaching files", read 2026-10-16). A film over that gets a copy encoded to fit, in two passes
// at a fixed bitrate, since CRF sets quality, not size.
const LIMIT = 10_000_000;
if (size > LIMIT) {
	const kbps = Math.floor((0.9 * LIMIT * 8) / total / 1000 - 128);
	const web = FINAL.replace(/\.mp4$/, '-web.mp4');
	const encode = ['-y', '-loglevel', 'error', '-i', FINAL, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-passlogfile', `${OUT}/enc`];
	execFileSync('ffmpeg', [...encode, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
	execFileSync('ffmpeg', [...encode, '-pass', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', web]);
	console.log('under', LIMIT, 'bytes ->', web, statSync(web).size, 'bytes');
}

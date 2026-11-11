// Records a take of Claude Code: opens a WezTerm pane sized for the film, starts a real session in
// it, and saves every change of the screen, colours and links included, with the second it
// happened. A take script drives the session through the returned handle and calls finish(), which
// writes frames.jsonl and marks.json into `out`. Needs WezTerm and a signed-in `claude`. Record with
// the machine otherwise idle: under load the pane redraws a few times a second, so a stretch's growth
// crawls across the take and a settle can time out (two takes failed at a load average of 121).
// The live checks in film/e2e/ build on its openPane, claudePath and keepSettings.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { firstCarriedRow, lettersOn, linksOn, parseScreen, plainRows, pressablesOn, turnsDone } from './screen.mjs';

const run = promisify(execFile);
export const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
/** Where Claude Code keeps the person's settings and transcripts: the folder CLAUDE_CONFIG_DIR names, else ~/.claude. */
export const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? `${homedir()}/.claude`;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const wez = (...args) => execFileSync('wezterm', ['cli', ...args], { encoding: 'utf8' }).trim();

/** The keys a terminal sends for alt+down and alt+up. */
export const ALT_DOWN = '\x1b[1;3B', ALT_UP = '\x1b[1;3A';

/**
 * Keeps the settings files a session can write, and returns what puts them back: each file the
 * session changed is written back byte for byte, or removed if the session made it, when the plugin's
 * own entry (`pluginConfigs['cc-stretch@inline']`, as a --plugin-dir session saves it as of Claude
 * Code 2.1.302) is its only change; any other change is left and named.
 */
export function keepSettings() {
	const kept = [`${CONFIG_DIR}/settings.json`, `${REPO}/.claude/settings.json`, `${REPO}/.claude/settings.local.json`].map((file) => [file, existsSync(file) ? readFileSync(file) : null]);
	return () => {
		for (const [file, before] of kept) {
			if (!existsSync(file)) continue;
			const now = readFileSync(file);
			if (before !== null && now.equals(before)) continue;
			const left = JSON.parse(now.toString('utf8'));
			delete left.pluginConfigs?.['cc-stretch@inline'];
			const was = before === null ? {} : JSON.parse(before.toString('utf8'));
			if (left.pluginConfigs && Object.keys(left.pluginConfigs).length === 0 && !('pluginConfigs' in was)) delete left.pluginConfigs;
			if (JSON.stringify(left) !== JSON.stringify(was)) {
				console.log('NOT put back, it changed in other ways too:', file);
				continue;
			}
			if (before === null) rmSync(file);
			else writeFileSync(file, before);
			console.log('put back:', file);
		}
	};
}

/**
 * The screen of a pane `rows` high as `wezterm cli get-text --escapes` writes it, except that each row
 * firstCarriedRow names is read again from that row on, where a read starts plain, and spliced in. If
 * that row's text changed between the two reads, it starts over with a new whole read, up to three
 * whole reads; the last is then given as written. Every read names its last row: as of WezTerm
 * 20260905-195314-b99b1ca2, a read whose end runs past the screen gives the last rows whatever its
 * start, two rows early from row 14 of 30 and into the scrollback from row 0.
 */
async function readScreen(pane, rows) {
	const getText = async (from) => (await run('wezterm', ['cli', 'get-text', '--pane-id', pane, '--escapes', '--start-line', String(from), '--end-line', String(rows - 1)], { maxBuffer: 1 << 24 })).stdout;
	let screen = '';
	for (let tries = 0; tries < 3; tries++) {
		screen = await getText(0);
		let text = screen, isChanged = false;
		for (let row = firstCarriedRow(text); row !== -1; row = firstCarriedRow(text)) {
			const rest = await getText(row);
			isChanged = plainRows(parseScreen(rest))[0] !== plainRows(parseScreen(text))[row];
			if (isChanged) break;
			text = [...text.split('\n').slice(0, row), `\x1b[0m${rest}`].join('\n');
		}
		if (!isChanged) return text;
	}
	return screen;
}

/** The `claude` a login shell finds. */
export const claudePath = () => execFileSync('zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim();

/**
 * Opens a WezTerm pane of `cols` × `rows` cells running `command` in this repo, beside two plain
 * shells that hold it to that size, and records every change of its screen into `frames` with the
 * seconds since `t0`, which is now unless given. A session started with `--debug-file <debugFile>` is
 * clicked in the unit its log says it reads. close() stops the recording and closes the three panes.
 */
export function openPane({ cols, rows, command, t0, frames = [], debugFile }) {
	const base = wez('spawn', '--cwd', REPO, '--', 'zsh', '-f');
	const lower = wez('split-pane', '--pane-id', base, '--bottom', '--cells', String(rows), '--', 'zsh', '-f');
	const pane = wez('split-pane', '--pane-id', lower, '--right', '--cells', String(cols), '--cwd', REPO, '--', ...command);
	const size = JSON.parse(execFileSync('wezterm', ['cli', 'list', '--format', 'json'], { encoding: 'utf8' })).find((p) => String(p.pane_id) === pane)?.size;
	if (size === undefined) throw new Error(`pane ${pane} is not in wezterm cli list`);
	t0 ??= Date.now();
	const send = (keys) => wez('send-text', '--pane-id', pane, '--no-paste', keys);
	// As of Claude Code 2.1.302 a session reads the pointer in cells, counted from 1, until its debug log
	// says it reads pixels; a pixel is sent at the cell's middle, from the pane's size. Without a log
	// the session is taken to read pixels, as it does once a reply holding a stretch is drawn.
	const isPixels = () => {
		if (debugFile === undefined) return true;
		try {
			return readFileSync(debugFile, 'utf8').includes('Mouse reports in pixels');
		} catch {
			return false;
		}
	};

	let last = '';
	let isRecording = true;
	const recording = (async () => {
		while (isRecording) {
			const screen = await readScreen(pane, size.rows);
			if (screen !== last) {
				frames.push({ t: (Date.now() - t0) / 1000, screen });
				last = screen;
			}
		}
	})();
	return {
		t0,
		size,
		frames,
		/** The screen as last recorded, escapes and all. */
		last: () => last,
		send,
		/** Sends a mouse report for `button` over a cell, a release when `isUp`; returns whether it was in pixels. */
		mouse(button, row, col, isUp = false) {
			const pixels = isPixels();
			const [x, y] = pixels ? [Math.round((col + 0.5) * size.pixel_width / size.cols), Math.round((row + 0.5) * size.pixel_height / size.rows)] : [col + 1, row + 1];
			send(`\x1b[<${button};${x};${y}${isUp ? 'm' : 'M'}`);
			return pixels;
		},
		async close() {
			isRecording = false;
			await recording;
			for (const id of [pane, lower, base]) {
				try { wez('kill-pane', '--pane-id', id); } catch {}
			}
		},
	};
}

/**
 * Starts a session with this repo's plugin and begins recording. `append` is added to the
 * system prompt, to keep a demo session to the feature. The pane is `cols` × `rows` cells, saved in
 * the marks as `size` for film/kit.js to draw; a smaller pane draws larger text in the film. The
 * session reads the project's and local settings only, unless `sources` names others: a take that
 * saves a plugin setting needs `user`, where as of Claude Code 2.1.302 the setting is written. Such a
 * take writes the person's own settings, so they are kept at the start and put back by finish().
 */
export async function startTake({ out, append, cols = 100, rows = 30, sources = 'project,local' }) {
	const putSettingsBack = sources.split(',').includes('user') ? keepSettings() : () => {};
	mkdirSync(out, { recursive: true });
	const pane = openPane({
		cols, rows,
		command: ['env', '-u', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_NO_FLICKER=1',
			claudePath(), '--plugin-dir', REPO, '--setting-sources', sources, '--model', 'opus', '--append-system-prompt', append],
	});
	const { frames, send } = pane;
	const now = () => (Date.now() - pane.t0) / 1000;

	const screen = () => parseScreen(pane.last());
	const text = () => plainRows(screen()).join('\n');
	// The size the pane was given, which clicks are measured against too.
	const marks = { size: { cols: pane.size.cols, rows: pane.size.rows } };
	const mark = (name, extra = {}) => {
		marks[name] = { t: now(), ...extra };
		console.log('mark', name, JSON.stringify(marks[name]));
	};

	async function waitFor(test, ms, what) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (test(text())) return;
			await sleep(100);
		}
		throw new Error(`timed out waiting for ${what}`);
	}

	/**
	 * Waits until the screen has changed since `since` (seconds into the take) and then not changed
	 * for `quiet` ms: what the last action started is done and nothing moves.
	 */
	async function settle(quiet, ms, since = now()) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const lastChange = frames.at(-1)?.t ?? 0;
			if (lastChange > since && Date.now() - (pane.t0 + lastChange * 1000) > quiet) return;
			await sleep(100);
		}
		throw new Error('the screen never settled');
	}
	/** Waits until the screen has not changed for `quiet` ms, whatever changed it before. */
	const still = (quiet = 600) => settle(quiet, 10000, 0);

	async function type(words) {
		for (const ch of words) {
			send(ch);
			await sleep(45 + Math.random() * 55);
		}
	}

	/** Clicks the middle of a phrase, as a mouse would: press and release over its middle cell. */
	async function click(name, found) {
		const row = found.row, col = Math.floor((found.col + found.end) / 2);
		mark(name, { row, col, link: found.link });
		pane.mouse(0, row, col);
		await sleep(70);
		pane.mouse(0, row, col, true);
	}

	/** Presses `keys` and marks it as `name`, with the letters the press put on screen once it settles. */
	async function press(name, keys) {
		mark(name);
		send(keys);
		await settle(800, 10000);
		marks[name].letters = lettersOn(screen());
		console.log('letters', name, JSON.stringify(marks[name].letters));
		return marks[name].letters;
	}

	/**
	 * Answers the question whether to trust the folder if it shows, and waits for an empty prompt.
	 * The launch take's script answered it; no recorded take shows it, so its wording is unchecked.
	 */
	async function ready() {
		// The folder-trust question also draws a `❯`; wait until either it or the composer is whole.
		await waitFor((t) => /Enter to confirm/.test(t) || /─\n❯/.test(t), 60000, 'the first screen');
		// The question takes keys only a moment after it draws, so answer until it is gone.
		for (let tries = 0; /Enter to confirm/.test(text()) && tries < 10; tries++) {
			await sleep(1000);
			send('\x1b[B');
			await sleep(300);
			send('\r');
			await sleep(1500);
		}
		await waitFor((t) => /─\n❯/.test(t) && !/Enter to confirm/.test(t), 60000, 'the prompt');
		await sleep(1500);
		mark('ready');
	}

	/** Types `question`, sends it and waits for the reply, marking `asked<suffix>` and `replied<suffix>`. */
	async function ask(question, suffix = '') {
		await type(question);
		await sleep(600);
		mark(`asked${suffix}`);
		const before = turnsDone(text());
		send('\r');
		await waitFor((t) => turnsDone(t) > before, 240000, `the reply to "${question}"`);
		await sleep(800);
		mark(`replied${suffix}`);
	}

	async function finish() {
		await pane.close();
		writeFileSync(`${out}/frames.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n'));
		writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 2));
		putSettingsBack();
		console.log('frames', frames.length, 'seconds', frames.at(-1)?.t);
	}

	return {
		mark, type, click, press, settle, still, ready, ask, finish, text, screen, send, waitFor,
		links: (pattern) => linksOn(screen(), pattern), pressables: () => pressablesOn(screen()),
	};
}

// Checks the `trialGuide` setting in live sessions: of two sessions started with the setting, the one
// whose id the trial picks sends the file's text as its guide and the other sends the plugin's own,
// read back from what each session's transcript records of its request, with bench/live.ts. Run it
// from a folder Claude Code already trusts: the check does not answer the trust question. The
// transcripts stay where Claude Code wrote them.
//   node film/e2e/trial.mjs <package> <outDir>
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_DIR } from '../recorder.mjs';
import { turnsDone } from '../screen.mjs';
import { sleep, startCheck } from './live.mjs';

const [PLUGIN, OUT] = process.argv.slice(2).map((path) => resolve(path));
const { GUIDE, takesTrialGuide } = await import(`${PLUGIN}/hooks/guide.ts`);
const LIVE = new URL('../../bench/live.ts', import.meta.url).pathname;
// A guide that differs from the plugin's by one word, so it is told from it and writes as it does.
const TRIAL = GUIDE.replace('- Stretches nest:', '- Stretches may nest:');
if (TRIAL === GUIDE) throw new Error("the guide on trial must differ from the plugin's");
mkdirSync(OUT, { recursive: true });
const trialFile = `${OUT}/trial-guide.txt`;
writeFileSync(trialFile, `${TRIAL}\n`);

/** A new session id the trial picks, or one it does not. */
function idThat(isPicked) {
	for (;;) {
		const id = randomUUID();
		if (takesTrialGuide(id) === isPicked) return id;
	}
}
const picked = idThat(true), unpicked = idThat(false);
// As of Claude Code 2.1.302 a --plugin-dir session keeps the plugin's options under `cc-stretch@inline`.
const live = startCheck({ plugin: PLUGIN, out: OUT, settings: { pluginConfigs: { 'cc-stretch@inline': { options: { trialGuide: trialFile } } } } });
const { report, step, submit, text, waitFor } = live;
Object.assign(report, { picked, unpicked });

/** The transcript Claude Code wrote for session `id`, under whichever project folder it filed it. */
function transcriptOf(id) {
	const projects = `${CONFIG_DIR}/projects`;
	return readdirSync(projects).map((folder) => `${projects}/${folder}/${id}.jsonl`).find(existsSync);
}
/** What bench/live.ts prints for `transcripts`, with the guide on trial named `candidate`. */
const counts = (...transcripts) => execFileSync('bun', [LIVE, '--guide', `candidate=${trialFile}`, ...transcripts], { encoding: 'utf8' });

let error;
try {
	for (const [name, id] of [['picked', picked], ['unpicked', unpicked]]) {
		live.open({ args: ['--session-id', id] });
		await step(`${name}-reply`, `The session the trial ${name === 'picked' ? 'picks' : 'does not pick'} answers a prompt`, async () => {
			if (!(await live.ready())) return false;
			await submit('Say hello in three words.');
		}, () => turnsDone(text()) > 0, 240000);
		await sleep(1500);
		await live.close();
	}

	let seen = '';
	await step('guides', "The picked session's request carried the guide on trial, the other the plugin's", async () => {
		const [a, b] = [transcriptOf(picked), transcriptOf(unpicked)];
		if (a === undefined || b === undefined) return false;
		report.counts = { picked: counts(a), unpicked: counts(b), both: counts(a, b) };
		seen = report.counts.both;
	}, () => /^\| \| candidate \|$/m.test(report.counts.picked) && /^\| \| shipped \|$/m.test(report.counts.unpicked) && /^\| replies, in sessions \| 1, in 1 \| 1, in 1 \|$/m.test(seen));
	writeFileSync(`${OUT}/counts.txt`, seen);
} catch (caught) {
	error = caught;
} finally {
	await live.finish(error);
}

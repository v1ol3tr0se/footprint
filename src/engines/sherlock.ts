import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import type { Found } from "../core/types.ts";
import type { Engine, Outcome } from "./index.ts";
import { run, STOP, which } from "./process.ts";
import { Verifier } from "./verifier.ts";

const CHECKING = /^\[\*\] Checking username (.+) on:/;
const CLAIMED = /^\[\+\] (.+?): (https?:\/\/\S+)/;
const MISSED = /^\[-\] (.+?): (.*?) ?$/;
const ANSWERS = new Set(["Not Found!", "Illegal Username Format For This Site!"]);
const IDLE_S = 300;
const ROUNDS = 3;
const MANIFEST =
	"https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json";

/** Fetch sherlock's site list once, so every run shares it and footprint knows which sites a stalled run never reached. */
async function manifest(dir: string, noNsfw: boolean): Promise<[args: string[], sites: string[]]> {
	try {
		const res = await fetch(MANIFEST, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) return [[], []];
		const data = (await res.json()) as Record<string, { isNSFW?: boolean }>;
		delete data.$schema;
		const path = join(dir, "data.json");
		writeFileSync(path, JSON.stringify(data));
		return [["--json", path], Object.keys(data).filter((s) => !(noNsfw && data[s].isNSFW))];
	} catch {
		return [[], []];
	}
}

/**
 * Every site prints a line (--print-all), so a site that timed out, hit a bot wall or wouldn't connect
 * gets asked again with a longer timeout, up to three rounds while each one still gets answers. A run that stalls is
 * killed and the sites it never reached are asked again, except the one it hung on. Sites upstream excludes for false
 * positives are checked too, the Verifier already drops those.
 */
export async function runSherlock(users: string[], tmp: string, noNsfw: boolean, idle = IDLE_S): Promise<Outcome> {
	const outDir = join(tmp, "sherlock");
	mkdirSync(outDir);
	const [data, all] = await manifest(outDir, noNsfw);
	const argv = (timeout: number) => [
		"sherlock",
		"--no-color",
		"--ignore-exclusions",
		"--timeout",
		String(timeout),
		"--no-txt",
		...data,
		...(noNsfw ? [] : ["--nsfw"]),
	];
	const check = new Verifier("sherlock", argv(60), "--print-all", tmp, new Set(), Math.min(idle, 120));
	const found: Found = new Map();
	const unanswered = new Map<string, Set<string>>();
	const hung = new Set<string>();
	let heard = new Set<string>();
	let started = false;
	let cur: string | undefined;

	const onLine = (ln: string) => {
		const checking = CHECKING.exec(ln);
		if (checking) {
			started = true;
			cur = checking[1];
			found.set(cur, found.get(cur) ?? []);
			unanswered.set(cur, unanswered.get(cur) ?? new Set());
			return;
		}
		if (!cur) return;
		const claimed = CLAIMED.exec(ln);
		const missed = MISSED.exec(ln);
		const site = claimed?.[1] ?? missed?.[1];
		if (site) heard.add(site);
		if (claimed) {
			unanswered.get(cur)?.delete(claimed[1]);
			found.get(cur)?.push(hit(claimed[1], claimed[2], "sherlock"));
			check.claim(cur, claimed[1], claimed[1], claimed[2]);
		} else if (missed) {
			if (ANSWERS.has(missed[2])) unanswered.get(cur)?.delete(missed[1]);
			else unanswered.get(cur)?.add(missed[1]);
		}
	};

	const sherlock = async (u: string, asked: string[], args: string[]) => {
		heard = new Set();
		started = false;
		const [, problem] = await run("sherlock", [...args, "--print-all", "-fo", outDir, "--", u], {
			onLine,
			idle,
			cwd: outDir,
		});
		const missing = asked.filter((s) => !heard.has(s));
		if (problem && missing.length) {
			const sites = unanswered.get(u) ?? new Set();
			unanswered.set(u, sites);
			for (const s of missing) sites.add(s);
			if (started) hung.add(missing[0]);
		}
		return problem ? `${problem} for ${u}` : null;
	};
	const notes: string[] = [];
	check.start();
	try {
		for (const u of users) {
			if (STOP.isSet()) break;
			const problem = await sherlock(u, all, argv(20));
			if (problem) notes.push(problem);
		}
		for (let round = 0, progress = true; round < ROUNDS && progress && !STOP.isSet(); round++) {
			progress = false;
			for (const [u, sites] of unanswered) {
				const asked = [...sites].filter((s) => !hung.has(s));
				if (!asked.length || STOP.isSet()) continue;
				const before = sites.size;
				const stuck = hung.size;
				const problem = await sherlock(u, asked, [...argv(60), ...asked.flatMap((s) => ["--site", s])]);
				if (problem) notes.push(problem);
				progress ||= sites.size < before || hung.size > stuck;
			}
		}
	} finally {
		await check.finish();
	}
	for (const [u, sites] of unanswered) {
		if (sites.size) {
			notes.push(
				`sherlock · ${u}: ${sites.size} sites didn't answer (timed out, bot wall, no connection or hung): ${[...sites].join(", ")}`,
			);
		}
	}
	notes.push(...check.notes());
	if (!all.length)
		notes.push("sherlock: couldn't fetch its site list, so a run that stalls can't say which sites it missed");
	return [new Map([...found].map(([u, hits]) => [u, hits.filter((h) => check.passed(u, h.site))])), notes];
}

export const sherlock: Engine = {
	name: "sherlock",
	covers: ["username"],
	plan: ({ users, tmp, noNsfw }) => {
		if (!users.length || !which("sherlock")) return {};
		return { run: () => runSherlock(users, tmp, noNsfw) };
	},
};

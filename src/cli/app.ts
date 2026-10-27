import { accessSync, chmodSync, closeSync, constants, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canon } from "../core/hit.ts";
import { link, merge } from "../core/merge.ts";
import { NSFW } from "../core/risk.ts";
import type { Found, Kind, Section } from "../core/types.ts";
import { ENGINES, type Outcome, type Scan } from "../engines/index.ts";
import { STOP, strerror } from "../engines/process.ts";
import { fileName, photos, render, reportName } from "../output/html.ts";
import { BANNER, paint, say, show, summary } from "../output/terminal.ts";
import { type Args, Exit, parseArgs } from "./args.ts";
import type { Ask } from "./prompt.ts";

const QUIET =
	/rate-limited or errored|sites didn't answer|sites blocked the check|domain doesn't exist|made-up name|changed their answer|couldn't double-check/;

const REPORTS = join(import.meta.dirname, "../..", "reports");

function claimDir(dir: string) {
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		accessSync(dir, constants.W_OK);
	} catch (e) {
		throw new Exit(1, `footprint: can't write into ${dir}: ${strerror(e)}`);
	}
}

function claimOutput(path: string) {
	try {
		mkdirSync(dirname(path), { recursive: true });
		closeSync(openSync(path, "a"));
		chmodSync(path, 0o600);
	} catch (e) {
		throw new Exit(1, `footprint: can't write ${path}: ${strerror(e)}`);
	}
}

/** Wait for every engine; ctrl-c keeps whatever already finished, a second one quits. */
async function collect(jobs: Map<string, () => Promise<Outcome>>, notes: string[], cleanup: () => void) {
	let interrupted = false;
	const onInt = () => {
		if (interrupted) {
			cleanup();
			process.exit(130);
		}
		interrupted = true;
		STOP.set();
		notes.push("the run was interrupted, results are partial");
		say("interrupted, waiting for the tools to stop");
	};
	process.on("SIGINT", onInt);
	const results = await Promise.allSettled([...jobs.values()].map((job) => job()));
	process.off("SIGINT", onInt);
	const found = new Map<string, Found>();
	[...jobs.keys()].forEach((name, i) => {
		const r = results[i];
		if (r.status === "fulfilled") {
			found.set(name, r.value[0]);
			notes.push(...r.value[1]);
		} else {
			found.set(name, new Map());
			notes.push(`${name} output couldn't be read: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
		}
	});
	return found;
}

async function scan(args: Args, notes: string[]) {
	let tmp: string;
	try {
		tmp = mkdtempSync(join(tmpdir(), "footprint-"));
	} catch {
		tmp = mkdtempSync("/tmp/footprint-");
	}
	const cleanup = () => rmSync(tmp, { recursive: true, force: true });
	try {
		const s: Scan = {
			users: args.user,
			emails: args.email,
			noNsfw: args.noNsfw,
			blackbirdHome: args.blackbirdHome,
			tmp,
		};
		const jobs = new Map<string, () => Promise<Outcome>>();
		for (const engine of ENGINES) {
			const plan = engine.plan(s);
			if (plan.run) jobs.set(engine.name, plan.run);
			else if (plan.note) notes.push(plan.note);
		}
		if (!jobs.size) throw new Exit(1, `footprint: nothing can run here: ${notes.join("; ")}`);
		return await collect(jobs, notes, cleanup);
	} finally {
		cleanup();
	}
}

function sectionsFor(args: Args, found: Map<string, Found>) {
	const targets = [...args.user, ...args.email];
	const kinds: [Kind, string[]][] = [
		["username", args.user],
		["email", args.email],
	];
	const sections: Section[] = [];
	let missed = false;
	for (const [kind, ts] of kinds) {
		const tools = ENGINES.filter((e) => e.covers.includes(kind)).map((e) => e.name);
		for (const t of ts) {
			const lists = tools.flatMap((n) => {
				const hits = found.get(n)?.get(t);
				return hits ? [[n, hits] as const] : [];
			});
			missed ||= lists.length < tools.filter((n) => found.has(n)).length;
			for (const [, hits] of lists) for (const h of hits) [h.site, h.url] = canon(h.site, h.url, t);
			let hits = merge(lists.map(([, hits]) => link(hits, t, targets)));
			if (args.noNsfw) hits = hits.filter((h) => ![...h.tags].some((x) => NSFW.has(x)));
			sections.push({ title: t, kind, checked: lists.map(([n]) => n), hits });
		}
	}
	return { sections, missed };
}

export async function main(argv: string[], ask?: Ask): Promise<number> {
	show(paint("32", BANNER));
	const args = await parseArgs(argv, ask);
	if (args.htmlPath) claimOutput(args.htmlPath);
	else if (args.html) claimDir(REPORTS);
	STOP.clear();
	const notes: string[] = [];
	const found = await scan(args, notes);
	const { sections, missed } = sectionsFor(args, found);
	summary(sections);
	for (const n of notes) if (!QUIET.test(n)) say(n);
	if (args.html) {
		const name = reportName(sections);
		const out = args.htmlPath ?? join(REPORTS, fileName(name));
		if (!args.htmlPath) claimOutput(out);
		const pics = await photos(sections, (n) =>
			show(paint("2", `fetching ${n} profile ${n === 1 ? "photo" : "photos"}`)),
		);
		render(args.name ?? name, sections, out, pics);
		show(`wrote ${out}`);
	}
	return missed ? 1 : 0;
}

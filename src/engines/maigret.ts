import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import { flat, parseJson } from "../core/pyvalue.ts";
import type { Found, Hit } from "../core/types.ts";
import type { Engine, Outcome } from "./index.ts";
import { isFile, run, which } from "./process.ts";
import { siteName, Verifier } from "./verifier.ts";

type Report = Record<
	string,
	{
		url_user?: string;
		is_similar?: boolean;
		status?: { status?: string; ids?: Record<string, unknown>; tags?: string[] };
	}
>;

const DATABASE = /^\[\+\] Using sites database: (.+) \(\d+ sites\)/;
const CHECKING = /^\[\*\] Checking username (.+) on:/;
const CLAIMED = /^\[\+\] (.+?): (https?:\/\/\S+)/;
const BLOCK = /Checking username (.+?) on:(.*?)(?=Checking username |$)/gs;
const ERRORS = /Too many errors of type "(.+?)" \(([\d.]+)%\)/g;

export function parseMaigret(path: string): Hit[] {
	const hits: Hit[] = [];
	for (const [site, d] of Object.entries(parseJson(readFileSync(path, "utf8")) as Report)) {
		const st = d.status || {};
		if (st.status !== "Claimed" || d.is_similar) continue;
		const ids = new Map(
			Object.entries(st.ids || {}).flatMap(([k, v]): [string, string][] => {
				const s = flat(v);
				return k !== "username" && !k.startsWith("_") && s ? [[k, s]] : [];
			}),
		);
		hits.push(hit(site, d.url_user || "", "maigret", ids, st.tags || []));
	}
	return hits;
}

function readSiteNames(path: string, into: Set<string>) {
	try {
		for (const n of Object.keys(JSON.parse(readFileSync(path, "utf8")).sites)) into.add(n);
	} catch {
		return;
	}
}

export async function runMaigret(users: string[], tmp: string, noNsfw: boolean): Promise<Outcome> {
	const argv = ["maigret", "--no-recursion", "-J", "simple", "--no-color", "--no-progressbar", "--timeout", "20"];
	if (noNsfw) argv.push("--exclude-tags", "porn,erotic,webcam");
	const names = new Set<string>();
	const check = new Verifier("maigret", argv, "--print-not-found", tmp, names);
	let cur: string | undefined;

	const onLine = (ln: string) => {
		const db = DATABASE.exec(ln);
		if (db) return readSiteNames(db[1], names);
		const checking = CHECKING.exec(ln);
		if (checking) {
			cur = checking[1];
			return;
		}
		const claimed = cur && CLAIMED.exec(ln);
		if (cur && claimed) check.claim(cur, siteName(claimed[1], names), claimed[1], claimed[2]);
	};

	check.start();
	try {
		return await scan(users, tmp, argv, onLine, check);
	} finally {
		await check.finish();
	}
}

async function scan(users: string[], tmp: string, argv: string[], onLine: (ln: string) => void, check: Verifier) {
	const [out, problem] = await run("maigret", [...argv, "-a", "-fo", tmp, "--", ...users], { onLine, cwd: tmp });
	const notes = problem ? [problem] : [];
	for (const [, u, block] of out.matchAll(BLOCK)) {
		for (const [, err, pct] of block.matchAll(ERRORS)) {
			if (err !== "Unsupported username format") {
				notes.push(`maigret · ${u}: ${pct}% of sites failed (${err.toLowerCase()})`);
			}
		}
	}
	const found: Found = new Map();
	for (const u of users) {
		const f = join(tmp, `report_${u.replaceAll("/", "_")}_simple.json`);
		if (isFile(f)) found.set(u, parseMaigret(f));
		else if (!problem) notes.push(`maigret skipped ${u}${u.includes("#") ? ", it can't search names with #" : ""}`);
	}
	for (const [u, hits] of found) {
		for (const h of hits) if (!check.has(u, h.site)) check.claim(u, h.site, h.site, h.url);
	}
	await check.finish();
	notes.push(...check.notes());
	const passed: Found = new Map([...found].map(([u, hits]) => [u, hits.filter((h) => check.passed(u, h.site))]));
	return [passed, notes] satisfies Outcome;
}

export const maigret: Engine = {
	name: "maigret",
	covers: ["username"],
	plan: ({ users, tmp, noNsfw }) => {
		if (!users.length) return {};
		if (!which("maigret")) return { note: "maigret isn't on PATH, skipped" };
		return { run: () => runMaigret(users, tmp, noNsfw) };
	},
};

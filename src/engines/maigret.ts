import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import { flat, parseJson } from "../core/pyvalue.ts";
import { alnum, cmp } from "../core/text.ts";
import type { Found, Hit } from "../core/types.ts";
import type { Engine, Outcome } from "./index.ts";
import { isFile, run, STOP, which } from "./process.ts";
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

const ERRORED = /^\[\?\] (.+?): (?!https?:\/\/)(.*)$/;
const ROUNDS = 3;
const TEMPORARY = new Set([
	"Rate limited",
	"Request timeout",
	"Unknown",
	"Request failed",
	"Connecting failure",
	"Connecting failure (DNS)",
	"Webgate unavailable",
	"HTTP",
	"Proxy",
	"Interrupted",
	"Connection lost",
	"Payload",
	"None",
]);

/**
 * maigret retries failed requests itself (--retries) and prints every site that still errored (--print-errors).
 * Temporary errors (maigret's own list) get asked again by name with a longer timeout, up to three rounds while each
 * one still gets answers; captchas, bot walls and logins won't change on a retry, they're listed apart.
 */
export async function runMaigret(users: string[], tmp: string, noNsfw: boolean): Promise<Outcome> {
	const argv = (timeout: number) => [
		"maigret",
		"--no-recursion",
		"-J",
		"simple",
		"--no-color",
		"--no-progressbar",
		"--retries",
		"2",
		"--timeout",
		String(timeout),
		...(noNsfw ? ["--exclude-tags", "porn,erotic,webcam"] : []),
	];
	const names = new Set<string>();
	const check = new Verifier("maigret", argv(60), "--print-not-found", tmp, names);
	const errored = new Map<string, Set<string>>();
	const blocked = new Map<string, Set<string>>();
	let cur: string | undefined;

	const onLine = (ln: string) => {
		const db = DATABASE.exec(ln);
		if (db) return readSiteNames(db[1], names);
		const checking = CHECKING.exec(ln);
		if (checking) {
			cur = checking[1];
			errored.set(cur, new Set());
			return;
		}
		if (!cur) return;
		const claimed = CLAIMED.exec(ln);
		if (claimed) {
			errored.get(cur)?.delete(siteName(claimed[1], names));
			check.claim(cur, siteName(claimed[1], names), claimed[1], claimed[2]);
		}
		const failed = ERRORED.exec(ln);
		if (!failed || failed[2].startsWith("Unsupported username format")) return;
		const site = siteName(failed[1], names);
		if (TEMPORARY.has(failed[2].replace(/ error(: .*)?$/, ""))) return void errored.get(cur)?.add(site);
		blocked.set(cur, (blocked.get(cur) ?? new Set()).add(site));
	};

	check.start();
	try {
		return await scan(users, tmp, argv, onLine, check, errored, blocked);
	} finally {
		await check.finish();
	}
}

async function scan(
	users: string[],
	tmp: string,
	argv: (timeout: number) => string[],
	onLine: (ln: string) => void,
	check: Verifier,
	errored: Map<string, Set<string>>,
	blocked: Map<string, Set<string>>,
) {
	const [, problem] = await run("maigret", [...argv(20), "--print-errors", "-a", "-fo", tmp, "--", ...users], {
		onLine,
		cwd: tmp,
	});
	const notes = problem ? [problem] : [];
	const found: Found = new Map();
	const add = (u: string, f: string) => {
		const have = found.get(u) ?? [];
		const sites = new Set(have.map((h) => h.site));
		found.set(u, [...have, ...parseMaigret(f).filter((h) => !sites.has(h.site))]);
	};
	for (const u of users) {
		const f = join(tmp, `report_${u.replaceAll("/", "_")}_simple.json`);
		if (isFile(f)) add(u, f);
		else if (!problem) notes.push(`maigret skipped ${u}${u.includes("#") ? ", it can't search names with #" : ""}`);
	}
	for (let round = 1, progress = true; round <= ROUNDS && progress && !STOP.isSet(); round++) {
		progress = false;
		for (const u of found.keys()) {
			const sites = [...(errored.get(u) ?? [])];
			if (!sites.length || STOP.isSet()) continue;
			const dir = join(tmp, `maigret-retry${round}-${alnum(u)}`);
			mkdirSync(dir, { recursive: true });
			const asked = sites.flatMap((s) => ["--site", s]);
			const [, again] = await run("maigret", [...argv(60), "--print-errors", "-a", ...asked, "-fo", dir, "--", u], {
				onLine,
				cwd: dir,
			});
			if (again) {
				notes.push(again);
				errored.set(u, new Set(sites));
				continue;
			}
			const f = join(dir, `report_${u.replaceAll("/", "_")}_simple.json`);
			if (isFile(f)) add(u, f);
			progress ||= (errored.get(u)?.size ?? 0) < sites.length;
		}
	}
	for (const [u, sites] of blocked) {
		notes.push(
			`maigret · ${u}: ${sites.size} sites blocked the check (captcha, bot wall, login or access denied; another IP or no VPN may get through): ${[...sites].sort(cmp).join(", ")}`,
		);
	}
	for (const [u, sites] of errored) {
		if (sites.size) {
			notes.push(
				`maigret · ${u}: ${sites.size} sites didn't answer (timed out or errored, even when asked again): ${[...sites].sort(cmp).join(", ")}`,
			);
		}
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

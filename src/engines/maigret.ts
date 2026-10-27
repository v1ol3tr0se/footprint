import { lookup } from "node:dns/promises";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import { flat, parseJson } from "../core/pyvalue.ts";
import { alnum, cmp } from "../core/text.ts";
import type { Found, Hit } from "../core/types.ts";
import type { Engine, Outcome } from "./index.ts";
import { isFile, run, STOP, which } from "./process.ts";
import { CHECKING, CLAIMED, siteName, Verifier } from "./verifier.ts";

type Report = Record<
	string,
	{
		url_user?: string;
		is_similar?: boolean;
		status?: { status?: string; ids?: Record<string, unknown>; tags?: string[] };
	}
>;

const DATABASE = /^\[\+\] Using sites database: (.+) \(\d+ sites\)/;

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

function readSites(path: string, names: Set<string>, hosts: Map<string, string>) {
	try {
		const sites = JSON.parse(readFileSync(path, "utf8")).sites as Record<string, { urlMain?: string }>;
		for (const [n, s] of Object.entries(sites)) {
			names.add(n);
			if (URL.canParse(s.urlMain ?? "")) hosts.set(n, new URL(s.urlMain ?? "").hostname);
		}
	} catch {
		return;
	}
}

/** Sites whose domain no longer exists, asking again won't help; only trusted when some other domain did resolve, so a dropped connection doesn't bury everything. */
async function gone(sites: string[], hosts: Map<string, string>) {
	const asked = sites.filter((s) => hosts.has(s));
	const answers = await Promise.all(
		asked.map((s) =>
			lookup(hosts.get(s) ?? "").then(
				() => "ok",
				(e: NodeJS.ErrnoException) => e.code,
			),
		),
	);
	return answers.includes("ok") ? asked.filter((_, i) => answers[i] === "ENOTFOUND") : [];
}

const ROUNDS = 2;
const ANSWERS = new Set(["Claimed", "Available", "Illegal"]);
const IGNORED = new Set(["Skipped", "Check is disabled", "Unsupported identifier type"]);
const BLOCKING = new Set([
	"Captcha",
	"Bot protection",
	"Request blocked",
	"Access denied",
	"Censorship",
	"Login required",
]);

function parseCsv(text: string) {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted && c === '"' && text[i + 1] === '"') {
			cell += c;
			i++;
		} else if (c === '"') quoted = !quoted;
		else if (quoted || (c !== "," && c !== "\n" && c !== "\r")) cell += c;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\n") {
			rows.push([...row, cell]);
			row = [];
			cell = "";
		}
	}
	if (cell || row.length) rows.push([...row, cell]);
	return rows;
}

/** Each site's last word from maigret's csv report: Claimed, Available, Illegal, or the error left after its own retries; it also has the checks that timed out without printing anything. */
function readStates(path: string) {
	if (!isFile(path)) return undefined;
	const [head = [], ...rows] = parseCsv(readFileSync(path, "utf8"));
	const [name, exists, reason] = ["name", "exists", "error_reason"].map((k) => head.indexOf(k));
	return new Map(rows.map((r) => [r[name], r[exists] === "Unknown" ? r[reason] : r[exists]]));
}

/**
 * maigret retries failed requests itself (--retries) and its csv report says how every site ended up. Sites that
 * errored get asked again by name with a longer timeout, one try per round, up to two rounds while each one still gets
 * answers; captchas, bot walls, logins and domains that no longer exist won't change on a retry, they're listed apart.
 */
export async function runMaigret(users: string[], tmp: string, noNsfw: boolean): Promise<Outcome> {
	const argv = (timeout: number, retries = 2) => [
		"maigret",
		"--no-recursion",
		"-J",
		"simple",
		"-C",
		"--no-color",
		"--no-progressbar",
		"--retries",
		String(retries),
		"--timeout",
		String(timeout),
		...(noNsfw ? ["--exclude-tags", "porn,erotic,webcam"] : []),
	];
	const names = new Set<string>();
	const hosts = new Map<string, string>();
	const check = new Verifier("maigret", argv(60, 0), "--print-not-found", tmp, names);
	const errored = new Map<string, Set<string>>();
	const blocked = new Map<string, Set<string>>();
	const claims = new Map<string, Map<string, string>>();
	const found: Found = new Map();
	const notes: string[] = [];
	let cur: string | undefined;

	const onLine = (ln: string) => {
		const db = DATABASE.exec(ln);
		if (db) return readSites(db[1], names, hosts);
		const checking = CHECKING.exec(ln);
		if (checking) cur = checking[1];
		const claimed = cur && CLAIMED.exec(ln);
		if (!cur || !claimed) return;
		const site = siteName(claimed[1], names);
		claims.set(cur, (claims.get(cur) ?? new Map()).set(site, claimed[2]));
		check.claim(cur, site, claimed[1], claimed[2]);
	};

	const settle = (u: string, dir: string, asked?: Set<string>) => {
		const file = (kind: string) => join(dir, `report_${u.replaceAll("/", "_")}${kind}`);
		if (isFile(file("_simple.json"))) {
			const have = found.get(u) ?? [];
			const sites = new Set(have.map((h) => h.site));
			found.set(u, [...have, ...parseMaigret(file("_simple.json")).filter((h) => !sites.has(h.site))]);
		}
		const states = readStates(file(".csv"));
		if (!states) return false;
		if (!found.has(u)) found.set(u, []);
		const err = errored.get(u) ?? new Set();
		const blk = blocked.get(u) ?? new Set();
		errored.set(u, err);
		blocked.set(u, blk);
		for (const [site, state] of states) {
			if (asked && !asked.has(site)) continue;
			err.delete(site);
			blk.delete(site);
			const type = state.replace(/ error(: [\s\S]*)?$/, "");
			if (!ANSWERS.has(state) && !IGNORED.has(type)) (BLOCKING.has(type) ? blk : err).add(site);
		}
		return true;
	};

	check.start();
	try {
		const [, problem] = await run("maigret", [...argv(20), "-a", "-fo", tmp, "--", ...users], { onLine, cwd: tmp });
		if (problem) notes.push(problem);
		for (const u of users) {
			if (!settle(u, tmp) && !problem) {
				notes.push(`maigret skipped ${u}${u.includes("#") ? ", it can't search names with #" : ""}`);
			}
		}
		const dead = new Set(await gone([...new Set([...errored.values()].flatMap((s) => [...s]))], hosts));
		for (const sites of errored.values()) for (const s of dead) sites.delete(s);
		for (let round = 1, progress = true; round <= ROUNDS && progress && !STOP.isSet(); round++) {
			progress = false;
			for (const [u, err] of errored) {
				const sites = [...err];
				if (!sites.length || STOP.isSet()) continue;
				const dir = join(tmp, `maigret-retry${round}-${alnum(u)}`);
				mkdirSync(dir, { recursive: true });
				const asked = sites.flatMap((s) => ["--site", s]);
				const [, again] = await run("maigret", [...argv(60, 0), "-a", ...asked, "-fo", dir, "--", u], {
					onLine,
					cwd: dir,
				});
				if (again) notes.push(again);
				settle(u, dir, new Set(sites));
				progress ||= err.size < sites.length;
			}
		}
		if (dead.size) {
			notes.push(
				`maigret: ${dead.size} sites are gone, their domain doesn't exist anymore: ${[...dead].sort(cmp).join(", ")}`,
			);
		}
		for (const [u, sites] of blocked) {
			if (sites.size) {
				notes.push(
					`maigret · ${u}: ${sites.size} sites blocked the check (captcha, bot wall, login or access denied; they turn away automated checks, open them by hand): ${[...sites].sort(cmp).join(", ")}`,
				);
			}
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
	} finally {
		await check.finish();
	}
	notes.push(...check.notes());
	for (const [u, sites] of claims) {
		const have = found.get(u) ?? [];
		const known = new Set(have.map((h) => h.site));
		found.set(u, [...have, ...[...sites].filter(([s]) => !known.has(s)).map(([s, url]) => hit(s, url, "maigret"))]);
	}
	const passed: Found = new Map([...found].map(([u, hits]) => [u, hits.filter((h) => check.passed(u, h.site))]));
	return [passed, notes];
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

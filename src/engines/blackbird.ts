import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import { flat, parseJson } from "../core/pyvalue.ts";
import { cmp } from "../core/text.ts";
import type { Found, Hit } from "../core/types.ts";
import { live } from "../output/terminal.ts";
import type { Engine, Outcome } from "./index.ts";
import { isFile, run, STOP } from "./process.ts";

type Result = {
	name: string;
	url?: string;
	category?: string;
	metadata?: { name: string; value?: unknown }[] | null;
};

const FOUND = /^\s*✔️?\s+\[(.+?)\] ?(\S*)/u;
const FAILED = / - ERROR - (Error in Async HTTP Request|Coudn't check) /;

/** links maps site names to profile urls; email hits get none, their probe urls carry the address. */
export function parseBlackbird(path: string, links?: Map<string, string>): Hit[] {
	return (parseJson(readFileSync(path, "utf8")) as Result[]).map((h) => {
		const meta = new Map(
			(h.metadata || []).flatMap((m): [string, string][] => {
				const s = flat(m.value);
				return s ? [[m.name, s]] : [];
			}),
		);
		const url = links === undefined ? "" : links.get(h.name) || h.url || "";
		return hit(h.name, url, "blackbird", meta, [h.category || ""]);
	});
}

function stamp() {
	const d = new Date();
	return `${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}_${d.getFullYear()}`;
}

function readFrom(path: string, start: number) {
	const fd = openSync(path, "r");
	try {
		const buf = Buffer.alloc(Math.max(0, fstatSync(fd).size - start));
		readSync(fd, buf, 0, buf.length, start);
		return buf.toString("utf8");
	} finally {
		closeSync(fd);
	}
}

function prettyUrls(sites: string) {
	if (!existsSync(sites)) return new Map<string, string>();
	const data = JSON.parse(readFileSync(sites, "utf8")) as { sites: { name: string; uri_pretty?: string }[] };
	return new Map(data.sites.flatMap((s): [string, string][] => (s.uri_pretty ? [[s.name, s.uri_pretty]] : [])));
}

function checkUrls(file: string) {
	if (!existsSync(file)) return new Map<string, string>();
	const data = JSON.parse(readFileSync(file, "utf8")) as { sites: { name: string; uri_check?: string }[] };
	return new Map(data.sites.flatMap((s): [string, string][] => (s.uri_check ? [[s.uri_check, s.name]] : [])));
}

const FAILED_URL = /(https?:\/\/\S+) \| /;
const PASSES = 3;

/** Every failed check is logged with its url; blackbird can't pick sites by name, so it reruns whole (up to three passes, 60 s timeout after the first) while checks still fail, keeping every hit, and only a site that failed every pass counts as unchecked. */
export async function runBlackbird(users: string[], emails: string[], home: string, noNsfw: boolean): Promise<Outcome> {
	const py = join(home, ".venv/bin/python");
	const sites = join(home, "data/wmn-data.json");
	const base = [existsSync(py) ? py : "python3", "blackbird.py", "--json"];
	if (existsSync(sites)) base.push("--no-update");
	if (noNsfw) base.push("--no-nsfw");
	if (users.length) base.push("-u", ...users);
	if (emails.length) base.push("-e", ...emails);
	const pretty = prettyUrls(sites);
	const checks = checkUrls(sites);
	const targets = [...users, ...emails];
	let i = 0;

	const onLine = (ln: string) => {
		if (i >= targets.length) return;
		const t = targets[i];
		const m = FOUND.exec(ln);
		if (m) live(t, m[1], i >= users.length ? "" : (pretty.get(m[1]) ?? "").replaceAll("{account}", () => t) || m[2]);
		else if (ln.includes("Check completed in")) i++;
	};

	const label = (url: string) => {
		for (const [uri, name] of checks) {
			if (targets.some((t) => uri.replaceAll("{account}", () => t) === url)) return name;
		}
		return URL.canParse(url) ? new URL(url).host : url;
	};

	const log = join(home, "logs/blackbird.log");
	const jobs: [string, Map<string, string> | undefined][] = [
		...users.map((u): [string, Map<string, string>] => [
			u,
			new Map([...pretty].map(([n, p]) => [n, p.replaceAll("{account}", () => u)])),
		]),
		...emails.map((e): [string, undefined] => [e, undefined]),
	];
	const found: Found = new Map();
	const notes: string[] = [];
	let failing: Set<string> | undefined;

	for (let pass = 0; pass < PASSES && (failing === undefined || failing.size) && !STOP.isSet(); pass++) {
		i = 0;
		const seen = existsSync(log) ? statSync(log).size : 0;
		const t0 = Date.now();
		const stamps = new Set([stamp()]);
		const argv = pass ? [...base, "--timeout", "60"] : base;
		const [, problem] = await run("blackbird", argv, { onLine, cwd: home });
		stamps.add(stamp());
		if (problem) notes.push(problem);
		const failed = new Set(
			existsSync(log)
				? readFrom(log, seen)
						.split(/\r\n|\r|\n/)
						.filter((ln) => FAILED.test(ln))
						.flatMap((ln) => FAILED_URL.exec(ln)?.[1] ?? [])
				: [],
		);
		failing = failing ? new Set([...failing].filter((u) => failed.has(u))) : failed;
		for (const [t, links] of jobs) {
			const f = [...stamps]
				.map((s) => join(home, "results", `${t}_${s}_blackbird`, `${t}_${s}_blackbird.json`))
				.find((f) => isFile(f) && statSync(f).mtimeMs >= t0);
			const have = found.get(t) ?? [];
			const names = new Set(have.map((h) => h.site));
			if (f) found.set(t, [...have, ...parseBlackbird(f, links).filter((h) => !names.has(h.site))]);
			else if (!problem) found.set(t, have);
		}
		if (problem) break;
	}
	if (failing?.size) {
		const names = [...new Set([...failing].map(label))].sort(cmp);
		notes.push(
			`blackbird: ${names.length} site checks failed every time (timeouts or connection errors): ${names.join(", ")}`,
		);
	}
	return [found, notes];
}

export const blackbird: Engine = {
	name: "blackbird",
	covers: ["username", "email"],
	plan: ({ users, emails, blackbirdHome, noNsfw }) =>
		isFile(join(blackbirdHome, "blackbird.py"))
			? { run: () => runBlackbird(users, emails, blackbirdHome, noNsfw) }
			: { note: `no blackbird clone at ${blackbirdHome}, skipped` },
};

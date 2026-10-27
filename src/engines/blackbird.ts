import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import { flat, parseJson } from "../core/pyvalue.ts";
import type { Found, Hit } from "../core/types.ts";
import { live } from "../output/terminal.ts";
import type { Engine, Outcome } from "./index.ts";
import { isFile, run } from "./process.ts";

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

export async function runBlackbird(users: string[], emails: string[], home: string, noNsfw: boolean): Promise<Outcome> {
	const py = join(home, ".venv/bin/python");
	const sites = join(home, "data/wmn-data.json");
	const argv = [existsSync(py) ? py : "python3", "blackbird.py", "--json"];
	if (existsSync(sites)) argv.push("--no-update");
	if (noNsfw) argv.push("--no-nsfw");
	if (users.length) argv.push("-u", ...users);
	if (emails.length) argv.push("-e", ...emails);
	const pretty = prettyUrls(sites);
	const targets = [...users, ...emails];
	let i = 0;

	const onLine = (ln: string) => {
		if (i >= targets.length) return;
		const t = targets[i];
		const m = FOUND.exec(ln);
		if (m) live(t, m[1], i >= users.length ? "" : (pretty.get(m[1]) ?? "").replaceAll("{account}", () => t) || m[2]);
		else if (ln.includes("Check completed in")) i++;
	};

	const log = join(home, "logs/blackbird.log");
	const seen = existsSync(log) ? statSync(log).size : 0;
	const t0 = Date.now();
	const stamps = new Set([stamp()]);
	const [, problem] = await run("blackbird", argv, { onLine, cwd: home });
	stamps.add(stamp());
	const notes = problem ? [problem] : [];
	if (existsSync(log)) {
		const failed = readFrom(log, seen)
			.split(/\r\n|\r|\n/)
			.filter((ln) => FAILED.test(ln)).length;
		if (failed) notes.push(`blackbird: ${failed} site checks failed (timeouts or connection errors, see ${log})`);
	}

	const fresh = (t: string) =>
		[...stamps]
			.map((s) => join(home, "results", `${t}_${s}_blackbird`, `${t}_${s}_blackbird.json`))
			.find((f) => isFile(f) && statSync(f).mtimeMs >= t0);

	const found: Found = new Map();
	const jobs: [string, Map<string, string> | undefined][] = [
		...users.map((u): [string, Map<string, string>] => [
			u,
			new Map([...pretty].map(([n, p]) => [n, p.replaceAll("{account}", () => u)])),
		]),
		...emails.map((e): [string, undefined] => [e, undefined]),
	];
	for (const [t, links] of jobs) {
		const f = fresh(t);
		if (f) found.set(t, parseBlackbird(f, links));
		else if (!problem) found.set(t, []);
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

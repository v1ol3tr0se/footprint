import { createHash } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	existsSync,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
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

type Site = {
	name: string;
	uri_check?: string;
	uri_pretty?: string;
	e_code?: number;
	m_code?: number;
	input_operation?: string | null;
};
type List = { sites: Site[] };
type Check = { targets: Set<string>; sites: Site[] };

function readList(file: string): List {
	return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as List) : { sites: [] };
}

const FAILED_URL = /(https?:\/\/.+?) \| /;
const STATUS = /Async HTTP Request completed \[\w+ - (\d+)\] (https?:\/\/.+)$/;
const BLOCKED = new Set([401, 403, 407, 408, 425, 429]);
const PASSES = 3;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Every failed check is logged with its url, and -v prints every answer's status code: blackbird calls a bot wall, a
 * rate limit or a server error 'not found', footprint counts it as no answer. Up to two more passes (60 s timeout, fewer
 * requests at once) ask only the sites and targets that didn't answer, from a scratch dir holding a trimmed copy of
 * blackbird's site lists, since it reads data/ and logs/ from its working dir; only a site that never answered counts
 * as unchecked.
 */
export async function runBlackbird(
	users: string[],
	emails: string[],
	home: string,
	noNsfw: boolean,
	tmp: string,
): Promise<Outcome> {
	const py = resolve(home, ".venv/bin/python");
	const data = join(home, "data");
	const wmn = readList(join(data, "wmn-data.json"));
	const mail = readList(join(data, "email-data.json"));
	const pretty = new Map(wmn.sites.flatMap((s): [string, string][] => (s.uri_pretty ? [[s.name, s.uri_pretty]] : [])));
	const checks = new Map<string, Check>();
	const expect = (t: string, s: Site, account: string) => {
		if (!s.uri_check) return;
		const url = s.uri_check.replaceAll("{account}", () => account);
		const c = checks.get(url) ?? { targets: new Set(), sites: [] };
		c.targets.add(t);
		if (!c.sites.includes(s)) c.sites.push(s);
		checks.set(url, c);
	};
	for (const u of users) for (const s of wmn.sites) expect(u, s, u);
	for (const e of emails) for (const s of mail.sites) expect(e, s, s.input_operation === "hash-sha256" ? sha256(e) : e);

	let order: string[] = [];
	let nUsers = 0;
	let i = 0;
	let unanswered = new Set<string>();
	const onLine = (ln: string) => {
		const st = STATUS.exec(ln);
		const c = st && checks.get(st[2].trim());
		const code = Number(st?.[1]);
		if (c && !c.sites.some((s) => code === s.e_code || code === s.m_code) && (BLOCKED.has(code) || code >= 500)) {
			unanswered.add(st[2].trim());
		}
		if (i >= order.length) return;
		const t = order[i];
		const m = FOUND.exec(ln);
		if (m) live(t, m[1], i >= nUsers ? "" : (pretty.get(m[1]) ?? "").replaceAll("{account}", () => t) || m[2]);
		else if (ln.includes("Check completed in")) i++;
	};

	const links = new Map(
		users.map((u) => [u, new Map([...pretty].map(([n, p]) => [n, p.replaceAll("{account}", () => u)]))]),
	);
	const found: Found = new Map();
	const notes: string[] = [];
	let failing = new Set<string>();

	for (let pass = 0; pass < PASSES && !STOP.isSet(); pass++) {
		const rerun = [...failing].filter((u) => checks.has(u));
		if (pass && !rerun.length) break;
		const asked = new Set(rerun.flatMap((u) => [...(checks.get(u)?.targets ?? [])]));
		const us = pass ? users.filter((u) => asked.has(u)) : users;
		const es = pass ? emails.filter((e) => asked.has(e)) : emails;
		let cwd = home;
		if (pass) {
			cwd = join(tmp, `blackbird-pass${pass}`);
			mkdirSync(join(cwd, "data"), { recursive: true });
			const names = new Set(rerun.flatMap((u) => (checks.get(u)?.sites ?? []).map((s) => s.name)));
			for (const [file, list] of [
				["wmn-data.json", wmn],
				["email-data.json", mail],
			] as const) {
				writeFileSync(
					join(cwd, "data", file),
					JSON.stringify({ ...list, sites: list.sites.filter((s) => names.has(s.name)) }),
				);
			}
			if (existsSync(join(data, "wmn-metadata.json")))
				copyFileSync(join(data, "wmn-metadata.json"), join(cwd, "data/wmn-metadata.json"));
		}
		const argv = [existsSync(py) ? py : "python3", resolve(home, "blackbird.py"), "--json", "-v"];
		if (pass || wmn.sites.length) argv.push("--no-update");
		if (noNsfw) argv.push("--no-nsfw");
		if (us.length) argv.push("-u", ...us);
		if (es.length) argv.push("-e", ...es);
		if (pass) argv.push("--timeout", "60", "--max-concurrent-requests", "10");
		order = [...us, ...es];
		nUsers = us.length;
		i = 0;
		unanswered = new Set();
		const log = join(cwd, "logs/blackbird.log");
		const seen = existsSync(log) ? statSync(log).size : 0;
		const t0 = Date.now();
		const stamps = new Set([stamp()]);
		const [, problem] = await run("blackbird", argv, { onLine, cwd });
		stamps.add(stamp());
		if (problem) notes.push(problem);
		const failed = new Set([
			...unanswered,
			...(existsSync(log)
				? readFrom(log, seen)
						.split(/\r\n|\r|\n/)
						.filter((ln) => FAILED.test(ln))
						.flatMap((ln) => FAILED_URL.exec(ln)?.[1] ?? [])
				: []),
		]);
		for (const t of order) {
			const f = [...stamps]
				.map((s) => join(home, "results", `${t}_${s}_blackbird`, `${t}_${s}_blackbird.json`))
				.find((f) => isFile(f) && statSync(f).mtimeMs >= t0);
			const have = found.get(t) ?? [];
			const names = new Set(have.map((h) => h.site));
			if (f) found.set(t, [...have, ...parseBlackbird(f, links.get(t)).filter((h) => !names.has(h.site))]);
			else if (!problem) found.set(t, have);
		}
		if (problem && pass) break;
		failing = pass ? new Set([...failing].filter((u) => failed.has(u) || !checks.has(u))) : failed;
		if (problem) break;
	}
	const missed = new Map<string, Set<string>>();
	for (const url of failing) {
		const c = checks.get(url);
		for (const t of c?.targets ?? [...users, ...emails]) {
			const names = missed.get(t) ?? new Set();
			for (const n of c ? c.sites.map((s) => s.name) : [URL.canParse(url) ? new URL(url).host : url]) names.add(n);
			missed.set(t, names);
		}
	}
	for (const [t, names] of missed) {
		notes.push(
			`blackbird · ${t}: ${names.size} sites didn't answer in any pass (timeouts, connection errors, bot walls or rate limits): ${[...names].sort(cmp).join(", ")}`,
		);
	}
	return [found, notes];
}

export const blackbird: Engine = {
	name: "blackbird",
	covers: ["username", "email"],
	plan: ({ users, emails, blackbirdHome, noNsfw, tmp }) =>
		isFile(join(blackbirdHome, "blackbird.py"))
			? { run: () => runBlackbird(users, emails, blackbirdHome, noNsfw, tmp) }
			: { note: `no blackbird clone at ${blackbirdHome}, skipped` },
};

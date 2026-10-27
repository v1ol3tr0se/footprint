import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cmp } from "../core/text.ts";
import { live } from "../output/terminal.ts";
import { run, STOP } from "./process.ts";

export type Claim = [user: string, site: string, shown: string, url: string];

/** maigret prints mirrors as 'GitHubGist [GitHub]' but some real names have brackets too, like 'OP.GG [PUBG]'. */
export const siteName = (shown: string, names: Set<string>) =>
	names.has(shown) ? shown : shown.replace(/ \[.*\]$/, "");

class Queue<T> {
	private items: T[] = [];
	private waiting: ((x: T) => void) | undefined;

	put(x: T) {
		const w = this.waiting;
		this.waiting = undefined;
		if (w) w(x);
		else this.items.push(x);
	}

	get(ms?: number): Promise<T | undefined> {
		if (this.items.length) return Promise.resolve(this.items.shift());
		return new Promise((resolve) => {
			const timer =
				ms === undefined
					? undefined
					: setTimeout(() => {
							this.waiting = undefined;
							resolve(undefined);
						}, ms);
			this.waiting = (x) => {
				clearTimeout(timer);
				resolve(x);
			};
		});
	}
}

const FOUND = /^\[\+\] (.+?): https?:\/\//gim;
const GONE = /^\[-\] (.+?): Not found!/gim;
const BLOCK = /Checking username (.+?) on:(.*?)(?=\[\*\] Checking username |$)/gs;
const BATCH_MS = 3000;
const RETRY_MS = 3000;
const LIMIT_S = 120;

const fake = () => Array.from({ length: 12 }, () => String.fromCharCode(97 + randomInt(26))).join("");

/**
 * Re-asks every site a tool claims, for the real name and two made-up ones, before it's shown.
 *
 * A hit counts only if the site finds the name again and gives a clear 'not found' for both fakes.
 * Bot walls, login redirects and dead forums 'find' anyone; flaky ones fail or change their answer.
 */
export class Verifier {
	readonly fakes = [fake(), fake()];
	private readonly queue = new Queue<Claim | null>();
	private readonly ok = new Map<string, Set<string>>();
	private readonly seen = new Set<string>();
	private readonly bad = new Set<string>();
	private readonly flaky = new Set<string>();
	private readonly unchecked = new Set<string>();
	private readonly tool: string;
	private readonly argv: string[];
	private readonly listing: string;
	private readonly tmp: string;
	private readonly names: Set<string>;
	private rounds = 0;
	private loop: Promise<void> | undefined;
	private finished: Promise<void> | undefined;

	constructor(tool: string, argv: string[], listing: string, tmp: string, names: Set<string>) {
		this.tool = tool;
		this.argv = argv;
		this.listing = listing;
		this.tmp = tmp;
		this.names = names;
	}

	start() {
		this.loop = this.drain();
	}

	claim(user: string, site: string, shown: string, url: string) {
		this.queue.put([user, site, shown, url]);
	}

	finish() {
		if (!this.finished) {
			this.queue.put(null);
			this.finished = this.loop ?? Promise.resolve();
		}
		return this.finished;
	}

	has(user: string, site: string) {
		return this.seen.has(`${user}\0${site}`);
	}

	passed(user: string, site: string) {
		return this.ok.get(user)?.has(site) ?? false;
	}

	notes() {
		const out: string[] = [];
		const list = (s: Set<string>) => [...s].sort(cmp).join(", ");
		if (this.bad.size) {
			out.push(`${this.tool}: left out ${this.bad.size} sites that also 'found' a made-up name: ${list(this.bad)}`);
		}
		if (this.flaky.size) {
			out.push(
				`${this.tool}: left out ${this.flaky.size} sites that failed or changed their answer when asked again: ${list(this.flaky)}`,
			);
		}
		if (this.unchecked.size) {
			out.push(
				`${this.tool}: couldn't double-check ${this.unchecked.size} sites, so they're left out: ${list(this.unchecked)}`,
			);
		}
		return out;
	}

	private async drain() {
		for (;;) {
			const batch = await this.batch();
			const items = batch.filter((b): b is Claim => {
				if (!b || this.has(b[0], b[1])) return false;
				this.seen.add(`${b[0]}\0${b[1]}`);
				return true;
			});
			for (const user of new Set(items.map((b) => b[0]))) {
				const mine = items.filter((b) => b[0] === user);
				try {
					await this.check(user, mine);
				} catch {
					for (const b of mine) this.unchecked.add(b[1]);
				}
			}
			if (batch.at(-1) === null) return;
		}
	}

	private async batch() {
		const batch = [await this.queue.get()];
		const deadline = performance.now() + BATCH_MS;
		while (batch.at(-1) !== null) {
			const left = deadline - performance.now();
			if (left <= 0) break;
			const next = await this.queue.get(left);
			if (next === undefined) break;
			batch.push(next);
		}
		return batch;
	}

	private async check(user: string, items: Claim[], retry = true): Promise<void> {
		this.rounds++;
		const out = join(this.tmp, `${this.tool}-check${this.rounds}`);
		mkdirSync(out);
		const sites = [...new Set(items.map((b) => b[1]))].sort(cmp);
		const argv = [
			...this.argv,
			this.listing,
			...sites.flatMap((s) => ["--site", s]),
			"-fo",
			out,
			"--",
			user,
			...this.fakes,
		];
		const [text, problem] = await run(this.tool, argv, { limit: LIMIT_S, cwd: this.tmp });
		const blocks = new Map([...text.matchAll(BLOCK)].map((m) => [m[1], m[2]]));
		if (problem || ![user, ...this.fakes].every((n) => blocks.has(n))) {
			for (const s of sites) this.unchecked.add(s);
			return;
		}
		const listed = (name: string, re: RegExp) =>
			new Set([...(blocks.get(name) ?? "").matchAll(re)].map((m) => siteName(m[1], this.names)));
		const again = listed(user, FOUND);
		const bad = new Set(this.fakes.flatMap((f) => [...listed(f, FOUND)]));
		const gone = this.fakes.map((f) => listed(f, GONE));
		const absent = new Set(sites.filter((s) => gone.every((g) => g.has(s))));
		for (const s of sites) if (bad.has(s)) this.bad.add(s);
		const unsure = sites.filter((s) => !bad.has(s) && !(again.has(s) && absent.has(s)));
		for (const [, site, shown, url] of items) {
			if (!again.has(site) || !absent.has(site)) continue;
			const ok = this.ok.get(user) ?? new Set();
			this.ok.set(user, ok.add(site));
			live(user, shown, url);
		}
		if (unsure.length && retry && !(await STOP.wait(RETRY_MS))) {
			await this.check(
				user,
				items.filter((b) => unsure.includes(b[1])),
				false,
			);
		} else {
			for (const s of unsure) this.flaky.add(s);
		}
	}
}

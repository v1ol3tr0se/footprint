import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cmp } from "../core/text.ts";
import { live } from "../output/terminal.ts";
import { run, STOP } from "./process.ts";

type Claim = [user: string, site: string, shown: string, url: string];

/** maigret and sherlock print the same two lines: the name a run moved on to, and a site that claims it. */
export const CHECKING = /^\[\*\] Checking username (.+) on:/;
export const CLAIMED = /^\[\+\] (.+?): (https?:\/\/\S+)/;

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
const LINE = /^\[[+-]\] (.+?): /gm;
const BLOCK = /Checking username (.+?) on:(.*?)(?=\[\*\] Checking username |$)/gs;
const BATCH_MS = 3000;
const RETRY_MS = 3000;
const IDLE_S = 120;
const LIMIT_S = 240;
const TRIES = 3;

const pick = (from: string) => from[randomInt(from.length)];
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "123456789";

/** A made-up name with the real one's shape (letters, digits and separators in the same places, no 0 since some sites refuse it) so sites with a username format accept it; short names get 12 plain letters, or 12 digits if they're all digits, a random 3-letter name is probably taken. */
export function fake(like: string) {
	if (/^[0-9]+$/.test(like) && like.length < 8) return Array.from({ length: 12 }, () => pick(DIGITS)).join("");
	if ([...like].length < 8 || !/[a-z0-9]/i.test(like)) return Array.from({ length: 12 }, () => pick(LOWER)).join("");
	return [...like]
		.map((c) => (/[a-z]/.test(c) ? pick(LOWER) : /[A-Z]/.test(c) ? pick(UPPER) : /[0-9]/.test(c) ? pick(DIGITS) : c))
		.join("");
}

/**
 * Re-asks every site a tool claims, for the real name and two made-up ones, before it's shown.
 *
 * A hit counts only if the site finds the name again and gives a clear 'not found' for both fakes.
 * Bot walls, login redirects and dead forums 'find' anyone; flaky ones fail or change their answer.
 */
export class Verifier {
	private readonly made = new Map<string, string[]>();
	private readonly queue = new Queue<Claim | null>();
	private readonly ok = new Map<string, Set<string>>();
	private readonly seen = new Set<string>();
	private readonly bad = new Map<string, Set<string>>();
	private readonly flaky = new Map<string, Set<string>>();
	private readonly unchecked = new Map<string, Set<string>>();
	private readonly tool: string;
	private readonly argv: string[];
	private readonly listing: string;
	private readonly tmp: string;
	private readonly names: Set<string>;
	private readonly idle: number;
	private rounds = 0;
	private loop: Promise<void> | undefined;
	private finished: Promise<void> | undefined;

	constructor(tool: string, argv: string[], listing: string, tmp: string, names: Set<string>, idle = IDLE_S) {
		this.idle = idle;
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

	fakes(user: string) {
		let names = this.made.get(user);
		while (!names || new Set([user, ...names]).size < 3) names = [fake(user), fake(user)];
		this.made.set(user, names);
		return names;
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
		for (const u of new Set([...this.bad.keys(), ...this.flaky.keys(), ...this.unchecked.keys()])) {
			const [bad, flaky, unchecked] = [this.bad, this.flaky, this.unchecked].map((m) => m.get(u));
			const at = `${this.tool} · ${u}`;
			if (bad) out.push(`${at}: left out ${bad.size} sites that also 'found' a made-up name: ${list(bad)}`);
			if (flaky) {
				out.push(
					`${at}: left out ${flaky.size} sites that failed or changed their answer when asked again: ${list(flaky)}`,
				);
			}
			if (unchecked)
				out.push(`${at}: couldn't double-check ${unchecked.size} sites, so they're left out: ${list(unchecked)}`);
		}
		return out;
	}

	private mark(into: Map<string, Set<string>>, user: string, site: string) {
		into.set(user, (into.get(user) ?? new Set()).add(site));
	}

	/** sherlock prints sites in the order it was given them, so in the block that got cut off the first site with no line is the one it hung on. */
	private stuck(blocks: Map<string, string>, names: string[], sites: string[]) {
		const last = names.findLast((n) => blocks.has(n));
		if (this.tool !== "sherlock" || last === undefined) return undefined;
		const printed = new Set([...(blocks.get(last) ?? "").matchAll(LINE)].map((m) => siteName(m[1], this.names)));
		return sites.find((s) => !printed.has(s));
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
					for (const b of mine) this.mark(this.unchecked, user, b[1]);
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

	private async check(user: string, items: Claim[], tries = TRIES): Promise<void> {
		this.rounds++;
		const out = join(this.tmp, `${this.tool}-check${this.rounds}`);
		mkdirSync(out);
		const sites = [...new Set(items.map((b) => b[1]))].sort(cmp);
		const fakes = this.fakes(user);
		const argv = [...this.argv, this.listing, ...sites.flatMap((s) => ["--site", s]), "-fo", out, "--", user, ...fakes];
		const [text, problem] = await run(this.tool, argv, { idle: this.idle, limit: LIMIT_S, cwd: this.tmp });
		const blocks = new Map([...text.matchAll(BLOCK)].map((m) => [m[1], m[2]]));
		if (problem || ![user, ...fakes].every((n) => blocks.has(n))) {
			const stuck = problem?.includes("went quiet") ? this.stuck(blocks, [user, ...fakes], sites) : undefined;
			if (stuck) {
				this.mark(this.unchecked, user, stuck);
				const rest = items.filter((b) => b[1] !== stuck);
				return rest.length ? this.check(user, rest, tries) : undefined;
			}
			if (tries > 1 && !(await STOP.wait(RETRY_MS))) return this.check(user, items, tries - 1);
			for (const s of sites) this.mark(this.unchecked, user, s);
			return;
		}
		const listed = (name: string, re: RegExp) =>
			new Set([...(blocks.get(name) ?? "").matchAll(re)].map((m) => siteName(m[1], this.names)));
		const again = listed(user, FOUND);
		const bad = new Set(fakes.flatMap((f) => [...listed(f, FOUND)]));
		const gone = fakes.map((f) => listed(f, GONE));
		const absent = new Set(sites.filter((s) => gone.every((g) => g.has(s))));
		for (const s of sites) if (bad.has(s)) this.mark(this.bad, user, s);
		const unsure = sites.filter((s) => !bad.has(s) && !(again.has(s) && absent.has(s)));
		for (const [, site, shown, url] of items) {
			if (!again.has(site) || !absent.has(site)) continue;
			const ok = this.ok.get(user) ?? new Set();
			this.ok.set(user, ok.add(site));
			live(user, shown, url);
		}
		if (unsure.length && tries > 1 && !(await STOP.wait(RETRY_MS))) {
			await this.check(
				user,
				items.filter((b) => unsure.includes(b[1])),
				tries - 1,
			);
		} else {
			for (const s of unsure) this.mark(this.flaky, user, s);
		}
	}
}

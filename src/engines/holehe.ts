import { hit } from "../core/hit.ts";
import { cut } from "../core/text.ts";
import type { Found, Hit } from "../core/types.ts";
import { live } from "../output/terminal.ts";
import type { Engine, Outcome } from "./index.ts";
import { run, which } from "./process.ts";

const LINE = /^\[([+x!])\] ([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?: (.*))?$/;
const NSFW = new Set(["pornhub", "redtube", "xnxx", "xvideos", "babeshows"]);
const SHOWN_UNCHECKED = 8;

function details(rest: string) {
	const meta = new Map<string, string>();
	const parts = rest
		.replace(/^[ /]+|[ /]+$/g, "")
		.split(" / ")
		.map((p) => p.trim())
		.filter(Boolean);
	for (const part of parts) {
		if (part.startsWith("FullName ")) meta.set("fullname", part.slice("FullName ".length));
		else if (part.startsWith("Date, time of the creation ")) {
			meta.set("created", part.slice("Date, time of the creation ".length));
		} else if (part.startsWith("http")) meta.set("profile", part);
		else if (part.includes("@")) meta.set("recovery email", part);
		else if ("+0123456789".includes(part[0])) meta.set("phone", part);
		else if (!meta.has("detail")) meta.set("detail", part);
	}
	return meta;
}

/** Return [hits, domains it couldn't check] from holehe's plain output. */
export function parseHolehe(text: string): [Hit[], string[]] {
	const hits: Hit[] = [];
	const unchecked: string[] = [];
	for (const line of text.split(/\r\n|\r|\n/)) {
		const m = LINE.exec(line.trim());
		if (!m) continue;
		const [, mark, domain, rest] = m;
		if (mark !== "+") {
			unchecked.push(domain);
			continue;
		}
		const tags = NSFW.has(domain.split(".")[0]) ? ["porn"] : [];
		const bare = domain.replace(/^en\./, "");
		const site = bare.includes(".") ? bare.slice(0, bare.lastIndexOf(".")) : bare;
		hits.push(hit(site, `https://${domain}`, "holehe", details(rest ?? ""), tags));
	}
	return [hits, unchecked];
}

async function runHolehe(emails: string[]): Promise<Outcome> {
	const found: Found = new Map();
	const notes: string[] = [];
	for (const e of emails) {
		const onLine = (ln: string) => {
			const m = LINE.exec(ln.trim());
			if (m?.[1] === "+") live(e, m[2], `https://${m[2]}`);
		};
		const [out, problem] = await run("holehe", ["holehe", "--no-color", "--no-clear", "--", e], { onLine });
		if (problem || !/^\d+ websites checked/m.test(out)) {
			const last =
				out
					.split("\n")
					.map((ln) => ln.trim())
					.findLast(Boolean) ?? "no output";
			notes.push(problem ?? `holehe didn't finish ${e}: ${cut(last, 200)}`);
			continue;
		}
		const [hits, unchecked] = parseHolehe(out);
		found.set(e, hits);
		if (unchecked.length) {
			const more = unchecked.length > SHOWN_UNCHECKED ? ` +${unchecked.length - SHOWN_UNCHECKED} more` : "";
			const listed = unchecked.slice(0, SHOWN_UNCHECKED).join(", ");
			notes.push(`holehe · ${e}: ${unchecked.length} sites rate-limited or errored: ${listed}${more}`);
		}
	}
	return [found, notes];
}

export const holehe: Engine = {
	name: "holehe",
	covers: ["email"],
	plan: ({ emails }) => {
		if (!emails.length) return {};
		if (!which("holehe")) return { note: "holehe isn't on PATH, skipped" };
		return { run: () => runHolehe(emails) };
	},
};

import { createHash } from "node:crypto";
import { key } from "./hit.ts";
import { NSFW_SITES, RANK, risk } from "./risk.ts";
import { cmp, normUrl } from "./text.ts";
import type { Hit, Ranked } from "./types.ts";

/** Fold hits for one target into a deduped, risk-ranked list. */
export function merge(lists: Iterable<Hit[]>): Ranked[] {
	const out = new Map<string, Ranked>();
	const byUrl = new Map<string, string>();
	for (const hits of lists) {
		for (const h of hits) {
			const u = normUrl(h.url);
			let k = (u && byUrl.get(u)) || key(h.site);
			if (out.get(k)?.srcs.includes(h.src) && !(u && byUrl.get(u) === k)) k = `${k}\0${h.site}`;
			if (u && !byUrl.has(u)) byUrl.set(u, k);
			let cur = out.get(k);
			if (!cur) {
				cur = { ...h, srcs: [], meta: new Map(), tags: new Set(), level: "low", advice: "" };
				out.set(k, cur);
			}
			if (!cur.srcs.includes(h.src)) cur.srcs.push(h.src);
			cur.url ||= h.url;
			for (const [m, v] of h.meta) {
				const had = cur.meta.get(m);
				if (m === "links to" && had !== undefined) {
					cur.meta.set(m, [...new Set([...had.split(", "), ...v.split(", ")])].sort(cmp).join(", "));
				} else if (!cur.meta.has(m)) {
					cur.meta.set(m, v);
				}
			}
			for (const t of h.tags) cur.tags.add(t);
			if (NSFW_SITES.has(key(h.site))) cur.tags.add("porn");
		}
	}
	const ranked = [...out.values()];
	for (const h of ranked) [h.level, h.advice] = risk(h);
	return ranked.sort((a, b) => RANK[a.level] - RANK[b.level] || cmp(a.site.toLowerCase(), b.site.toLowerCase()));
}

/** Mark hits whose details name another target, or the md5 gravatar uses for an email. */
export function link<T extends Hit>(hits: T[], target: string, targets: string[]): T[] {
	const others = new Map(
		targets.filter((t) => t.toLowerCase() !== target.toLowerCase()).map((t) => [t.toLowerCase(), t]),
	);
	for (const [k, t] of [...others]) {
		if (k.includes("@")) others.set(createHash("md5").update(k).digest("hex"), t);
	}
	for (const h of hits) {
		const words = [...h.meta.values()]
			.flatMap((v) => v.toLowerCase().split(/[^\p{L}\p{N}_.@+-]+/u))
			.map((w) => w.replace(/^[@.]+|[@.]+$/g, ""));
		const names = [...new Set(words.flatMap((w) => others.get(w) ?? []))].sort(cmp);
		if (names.length) h.meta.set("links to", names.join(", "));
	}
	return hits;
}

import { alnum } from "./text.ts";
import type { Hit } from "./types.ts";

const ALIAS: Record<string, string> = { x: "twitter" };

export function hit(
	site: string,
	url: string,
	src: string,
	meta: Record<string, string> | Map<string, string> = {},
	tags: Iterable<string> = [],
): Hit {
	return {
		site,
		url,
		src,
		meta: new Map(meta instanceof Map ? meta : Object.entries(meta)),
		tags: new Set([...tags].filter(Boolean).map((t) => t.toLowerCase())),
	};
}

export function key(site: string) {
	const k = alnum(site.toLowerCase().replaceAll("(user)", "").replaceAll("user2", ""));
	return ALIAS[k] ?? k;
}

/** Fandom wikis share one global account, so every *.fandom.com hit is the same community.fandom.com profile. */
export function canon(site: string, url: string, target: string): [string, string] {
	if (/^https?:\/\/[^/]+\.fandom\.com\//.test(url)) {
		return ["FandomCommunityCentral", `https://community.fandom.com/wiki/User:${target}`];
	}
	return [site, url];
}

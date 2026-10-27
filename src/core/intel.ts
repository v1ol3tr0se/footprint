import { alnum, squash } from "./text.ts";
import type { Hit } from "./types.ts";

const INTEL: [string, Set<string>][] = [
	["names", new Set(["name", "fullname", "displayname", "realname", "firstname", "lastname"])],
	["locations", new Set(["location", "country", "city"])],
	["created", new Set(["createdat", "created", "joined", "joindate", "registered"])],
	["linked", new Set(["links", "website", "urls", "accounts", "bloglink", "blogurl", "profile", "linksto"])],
	["emails", new Set(["email", "emails", "recoveryemail", "businessemail"])],
	["phones", new Set(["phone"])],
	["bios", new Set(["bio", "about", "aboutme", "description"])],
];

const labelFor = (n: string) =>
	INTEL.find(([, keys]) => keys.has(n))?.[0] ?? (n.endsWith("username") && n !== "username" ? "linked" : undefined);

/** Every value the hits show for one intel label, once per mention, skipping the target itself. */
export function mentions(hits: Hit[], target: string, label: string): string[] {
	return hits.flatMap((h) =>
		[...h.meta].flatMap(([k, raw]) => {
			const v = squash(raw);
			return labelFor(alnum(k)) === label && v && v.toLowerCase().replace(/^@+/, "") !== target.toLowerCase() ? v : [];
		}),
	);
}

/** Pull the identifying details every tool scraped into one profile. */
export function intel(hits: Hit[], target: string): Record<string, string[]> {
	const found = new Map(INTEL.map(([label]) => [label, new Map<string, string>()]));
	for (const h of hits) {
		for (const [k, raw] of h.meta) {
			const label = labelFor(alnum(k));
			const v = squash(raw);
			const seen = label && found.get(label);
			if (seen && v.toLowerCase().replace(/^@+/, "") !== target.toLowerCase() && !seen.has(v.toLowerCase())) {
				seen.set(v.toLowerCase(), v);
			}
		}
	}
	return Object.fromEntries(
		[...found].filter(([, vals]) => vals.size).map(([label, vals]) => [label, [...vals.values()]]),
	);
}

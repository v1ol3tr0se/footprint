import { writeFileSync } from "node:fs";
import { LEVELS } from "../core/risk.ts";
import { alnum, cut } from "../core/text.ts";
import type { Level, Ranked, Section } from "../core/types.ts";

const CSS = `:root{--bg:#faf8fc;--fg:#1d1a22;--mut:#6b6475;--card:#fff;--line:#e6e0ee;--hi:#c2185b;--mid:#a36100;--lo:#5b6b7a;--acc:#7b4bb7}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#141118;--fg:#ece6f3;--mut:#a59cb2;--card:#1e1a24;--line:#2e2836;--hi:#ff6b9d;--mid:#ffb547;--lo:#93a4b5;--acc:#b98cf0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.4rem;margin:0 0 4px;overflow-wrap:anywhere}.sub{color:var(--mut);margin:0 0 20px}h2{font-size:1.05rem;margin:28px 0 10px;overflow-wrap:anywhere}.kind{color:var(--mut);font-weight:400;font-size:.85rem}
.hits{list-style:none;padding:0;margin:0;display:grid;gap:8px}.hits li{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--lo);border-radius:10px;padding:10px 12px}
.hits li.hi{border-left-color:var(--hi)}.hits li.mid{border-left-color:var(--mid)}.top{display:flex;justify-content:space-between;gap:8px}.site{font-size:1rem;margin:0;overflow-wrap:anywhere}
.tag{font-size:.75rem;text-transform:uppercase;color:var(--mut)}li.hi .tag{color:var(--hi)}li.mid .tag{color:var(--mid)}
a{color:var(--acc);font-size:.82rem;overflow-wrap:anywhere}.meta{font-size:.82rem;color:var(--mut);overflow-wrap:anywhere}.note{margin-top:4px;font-size:.88rem}.none{color:var(--mut)}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px;overflow-wrap:anywhere}.box ul{margin:6px 0 0;padding-left:20px}.warn{border-left:4px solid var(--mid)}
@media print{.hits li,.box{break-inside:avoid}}`;

const INTRO =
	'<b>how to read it:</b> "high" is a payment handle, an nsfw or dating site, an infostealer hit, ' +
	'or a page that names another target in this report. "medium" shows a name, avatar or contact ' +
	"detail, or is a big social account. a hit can belong to someone else with the same handle, " +
	"so open it before drawing conclusions.";

const CLASS: Record<Level, string> = { high: "hi", medium: "mid", low: "lo" };
const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const two = (n: number) => String(n).padStart(2, "0");

function item(h: Ranked) {
	const url = /^https?:\/\//.test(h.url)
		? `<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.url)}</a>`
		: "";
	const meta = [...h.meta].map(([k, v]) => `<div class="meta"><b>${esc(k)}:</b> ${esc(v)}</div>`).join("");
	return (
		`<li class="${CLASS[h.level]}"><div class="top"><h3 class="site">${esc(h.site)}</h3>` +
		`<span class="tag">${h.level}</span></div>${url}${meta}` +
		`<div class="note">${esc(h.advice)}</div></li>`
	);
}

function section({ title, kind, checked, hits }: Section) {
	const body = hits.length
		? `<ul class="hits">${hits.map(item).join("")}</ul>`
		: `<p class="none">${checked.length ? "nothing found" : "not checked, see the notes up top"}</p>`;
	return `<section><h2>${esc(title)} <span class="kind">${kind} · ${hits.length}</span></h2>${body}</section>`;
}

/** The username searched for, the one with the most hits when there are several, or for emails the username their hits mention most. */
export function reportName(sections: Section[]) {
	const users = sections.filter((s) => s.kind === "username");
	if (users.length) return users.reduce((best, s) => (s.hits.length > best.hits.length ? s : best)).title;
	const counts = new Map<string, number>();
	for (const s of sections) {
		for (const h of s.hits) {
			for (const [k, v] of h.meta) {
				const name = v.trim().replace(/^@+/, "");
				if (alnum(k).endsWith("username") && name) counts.set(name, (counts.get(name) ?? 0) + 1);
			}
		}
	}
	const [top] = [...counts].sort((a, b) => b[1] - a[1]);
	return top?.[0] ?? sections[0]?.title.split("@")[0] ?? "footprint";
}

const MAX_NAME = 120;

export const fileName = (name: string) =>
	`${cut(name.replace(/[^\p{L}\p{N}_.@+-]+/gu, "_").replace(/^\.+/, ""), MAX_NAME) || "footprint"}.html`;

export function render(name: string, sections: Section[], notes: string[], out: string) {
	const hits = sections.flatMap((s) => s.hits);
	const counts = LEVELS.map((lvl) => `${hits.filter((h) => h.level === lvl).length} ${lvl}`).join(" · ");
	const warn = notes.length
		? `<div class="box warn"><b>not everything got checked:</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`
		: "";
	const d = new Date();
	const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
	const page =
		'<!doctype html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width,initial-scale=1">' +
		`<title>footprint · ${esc(name)}</title><style>${CSS}</style></head><body><main>` +
		`<h1>footprint · ${esc(name)}</h1>` +
		`<p class="sub">${hits.length} hits · ${counts} · ${when}</p>` +
		`${warn}<div class="box">${INTRO}</div>${sections.map(section).join("")}</main></body></html>`;
	writeFileSync(out, page);
	return hits.length;
}

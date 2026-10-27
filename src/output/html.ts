import { writeFileSync } from "node:fs";
import { LEVELS } from "../core/risk.ts";
import { alnum, cut, profile } from "../core/text.ts";
import type { Level, Ranked, Section } from "../core/types.ts";

const CSS = `:root{--bg:#eff1f5;--surf:#e6e9ef;--raise:#dce0e8;--top:#bcc0cc;--fg:#4c4f69;--sub:#5c5f77;--mut:#6c6f85;--acc:#8839ef;--on-acc:#eff1f5;--hi:#d20f39;--mid:#df8e1d;--on-hi:#eff1f5;--on-mid:#4c4f69;--mono:"JetBrainsMono Nerd Font","JetBrains Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#11111b;--surf:#181825;--raise:#1e1e2e;--top:#313244;--fg:#cdd6f4;--sub:#bac2de;--mut:#a6adc8;--acc:#cba6f7;--on-acc:#11111b;--hi:#f38ba8;--mid:#f9e2af;--on-hi:#11111b;--on-mid:#11111b}}
*{box-sizing:border-box}html{scrollbar-color:var(--top) var(--bg);scrollbar-width:thin}::selection{background:var(--acc);color:var(--on-acc)}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 var(--mono)}main{max-width:880px;margin:0 auto;padding:20px 16px 56px;display:grid;gap:12px}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.crumb{display:flex;align-items:center;gap:6px;margin:0 2px;color:var(--mut);font-size:.8rem;overflow-wrap:anywhere}.crumb b{color:var(--acc)}.crumb svg{width:13px;height:13px}.crumb time{margin-left:auto;font-variant-numeric:tabular-nums}
.card{background:var(--surf);border-radius:12px}
.head{display:flex;align-items:center;gap:16px;padding:16px;flex-wrap:wrap}
.avatar{width:60px;height:60px;border-radius:15px;background:var(--acc);color:var(--on-acc);display:grid;place-items:center;font-size:1.7rem;font-weight:800;text-transform:uppercase;flex:none}
.who{flex:1 1 200px;min-width:0}h1{margin:0;font-size:1.3rem;line-height:1.25;overflow-wrap:anywhere}.sub{margin:2px 0 0;color:var(--mut);font-size:.82rem}
.counts{display:flex;gap:8px}.count{display:flex;align-items:center;gap:10px;background:var(--raise);border-radius:12px;padding:6px 12px 6px 6px}
.count b{font-size:1.1rem;font-variant-numeric:tabular-nums;line-height:1}.count div span{display:block;color:var(--mut);font-size:.72rem}
.chip{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;background:var(--top);color:var(--sub)}
.chip.high{background:var(--hi);color:var(--on-hi)}.chip.medium{background:var(--mid);color:var(--on-mid)}.chip.acc{background:var(--acc);color:var(--on-acc)}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;font-weight:700}
summary::-webkit-details-marker{display:none}summary:hover{background:var(--raise)}
summary:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.chev{margin-left:auto;color:var(--mut)}details[open]>summary .chev{transform:rotate(90deg)}
.n{color:var(--mut);font-weight:400;font-variant-numeric:tabular-nums}
.kind{background:var(--top);color:var(--sub);border-radius:999px;padding:1px 9px;font-size:.7rem;font-weight:400}
h2{margin:0;font-size:1rem;overflow-wrap:anywhere;min-width:0}
.notes{padding:0 16px 16px 56px;margin:0;color:var(--sub);font-size:.84rem;overflow-wrap:anywhere}.notes li+li{margin-top:6px}
.legend{display:grid;gap:12px;padding:2px 16px 16px;font-size:.84rem;color:var(--sub)}.legend div{display:flex;gap:12px;align-items:center}.legend b{color:var(--fg)}
.hits{list-style:none;margin:0;padding:0 6px 6px;display:grid;gap:2px}
.hits li{display:flex;gap:12px;padding:10px 8px;border-radius:10px}.hits li:hover{background:var(--raise)}
.body{flex:1;min-width:0}.top{display:flex;align-items:baseline;gap:10px}
h3{margin:0;font-size:.95rem;overflow-wrap:anywhere}
.lvl{margin-left:auto;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}li.high .lvl{color:var(--hi)}li.medium .lvl{color:var(--mid)}
a{color:var(--acc);font-size:.8rem;text-decoration-thickness:1px;text-underline-offset:3px;overflow-wrap:anywhere}
dl{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:1px 12px;margin:6px 0 0;font-size:.8rem}dt{color:var(--mut)}dd{margin:0;overflow-wrap:anywhere}
.note{margin:6px 0 0;color:var(--sub);font-size:.82rem}.note::first-letter{text-transform:uppercase}
.none{margin:0;padding:0 16px 16px 56px;color:var(--mut)}
@media (max-width:560px){.counts{width:100%}.count{flex:1}.notes,.none{padding-left:16px}}
@media print{details>summary .chev{display:none}.hits li{break-inside:avoid}}`;

const ICON: Record<string, string> = {
	high: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
	medium: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	low: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
	warn: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
	help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
	chev: '<path d="m9 18 6-6-6-6"/>',
};

const svg = (name: string, cls = "") =>
	`<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
const chip = (name: string, cls = name) => `<span class="chip ${cls}">${svg(name)}</span>`;

const LEGEND: Record<Level, string> = {
	high: "a payment handle, an nsfw or dating site, an infostealer hit, or a page that names another target in this report",
	medium: "shows a name, avatar or contact detail, or it's a big social account",
	low: "the handle exists there, nothing else about you shows",
};

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const two = (n: number) => String(n).padStart(2, "0");

function item(h: Ranked, target: string) {
	const url = /^https?:\/\//.test(profile(h.url, target))
		? `<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.url)}</a>`
		: "";
	const meta = h.meta.size
		? `<dl>${[...h.meta].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
		: "";
	return (
		`<li class="${h.level}">${chip(h.level)}<div class="body"><div class="top"><h3>${esc(h.site)}</h3>` +
		`<span class="lvl">${h.level}</span></div>${url}${meta}<p class="note">${esc(h.advice)}</p></div></li>`
	);
}

function section({ title, kind, checked, hits }: Section) {
	const body = hits.length
		? `<ul class="hits">${hits.map((h) => item(h, title)).join("")}</ul>`
		: `<p class="none">${checked.length ? "Nothing found" : "Not checked, see the notes up top"}</p>`;
	const lead = hits[0]?.level ?? "low";
	return (
		`<details class="card" open><summary>${chip(lead)}<h2>${esc(title)}</h2>` +
		`<span class="kind">${kind}</span><span class="n">${hits.length}</span>${svg("chev", "chev")}</summary>${body}</details>`
	);
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
	const counts = LEVELS.map(
		(lvl) =>
			`<div class="count">${chip(lvl)}<div><b>${hits.filter((h) => h.level === lvl).length}</b><span>${lvl}</span></div></div>`,
	).join("");
	const warn = notes.length
		? `<details class="card"><summary>${chip("warn", "medium")}Not everything got checked<span class="n">${notes.length}</span>${svg("chev", "chev")}</summary>` +
			`<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>`
		: "";
	const legend =
		`<details class="card"><summary>${chip("help", "acc")}How to read it${svg("chev", "chev")}</summary><div class="legend">` +
		LEVELS.map((lvl) => `<div>${chip(lvl)}<span><b>${lvl}</b> · ${LEGEND[lvl]}</span></div>`).join("") +
		"<div><span>A hit can belong to someone else with the same handle, so open it before drawing conclusions.</span></div></div></details>";
	const d = new Date();
	const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
	const page =
		'<!doctype html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width,initial-scale=1">' +
		`<title>footprint · ${esc(name)}</title><style>${CSS}</style></head><body><main>` +
		`<nav class="crumb"><b>footprint</b>${svg("chev")}<span>${esc(name)}</span><time>${when}</time></nav>` +
		`<header class="card head"><div class="avatar">${esc([...name][0] ?? "f")}</div>` +
		`<div class="who"><h1>${esc(name)}</h1><p class="sub">${hits.length} hits across ${sections.length} ${sections.length === 1 ? "target" : "targets"}</p></div>` +
		`<div class="counts">${counts}</div></header>` +
		`${warn}${legend}${sections.map(section).join("")}</main></body></html>`;
	writeFileSync(out, page);
	return hits.length;
}

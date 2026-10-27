import { writeFileSync } from "node:fs";
import { mentions } from "../core/intel.ts";
import { LEVELS, RANK } from "../core/risk.ts";
import { alnum, cut, profile } from "../core/text.ts";
import type { Level, Ranked, Section } from "../core/types.ts";

const CSS = `:root{--bg:#eff1f5;--surf:#e6e9ef;--raise:#dce0e8;--top:#bcc0cc;--fg:#4c4f69;--sub:#5c5f77;--mut:#5f6278;--acc:#7c2fe0;--on-acc:#eff1f5;--hi:#d20f39;--hi-fg:#c00d34;--mid:#df8e1d;--mid-fg:#8f5605;--on-hi:#eff1f5;--on-mid:#4c4f69;--shade:#4c4f6926;--mono:"JetBrainsMono Nerd Font","JetBrains Mono",ui-monospace,monospace;--ease:cubic-bezier(.2,0,0,1);--ease-in:cubic-bezier(.34,1.5,.2,1);--ease-pop:cubic-bezier(.61,1,.88,1);--dur:170ms;--dur-in:184ms;--rise:56px}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#11111b;--surf:#181825;--raise:#1e1e2e;--top:#313244;--fg:#cdd6f4;--sub:#bac2de;--mut:#a6adc8;--acc:#cba6f7;--on-acc:#11111b;--hi:#f38ba8;--hi-fg:#f38ba8;--mid:#f9e2af;--mid-fg:#f9e2af;--on-hi:#11111b;--on-mid:#11111b;--shade:#000000a6}}
*{box-sizing:border-box}html{scrollbar-color:var(--top) var(--bg);scrollbar-width:thin;-webkit-text-size-adjust:100%}::selection{background:var(--acc);color:var(--on-acc)}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 var(--mono)}
main{max-width:1760px;margin:0 auto;padding:clamp(16px,2.5vw,40px) clamp(16px,3vw,48px) 64px;display:grid;gap:14px}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.card{background:var(--surf);border-radius:16px}
.head{display:flex;flex-wrap:wrap;align-items:center;gap:24px 48px;padding:20px}
.id{display:flex;align-items:center;gap:20px;flex:999 1 440px;min-width:0}
.avatar{position:relative;width:88px;height:88px;border-radius:22px;overflow:hidden;background:var(--acc);color:var(--on-acc);display:grid;place-items:center;font-size:2.3rem;font-weight:800;text-transform:uppercase;flex:none}
.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:fade var(--dur-in) var(--ease-pop) both}
.ident{margin:0;display:grid;gap:3px;flex:1;min-width:0}.ident div{display:grid;grid-template-columns:10ch minmax(0,1fr);gap:0 12px;align-items:baseline}
.ident dt{color:var(--mut);font-size:.8rem}.ident dd{margin:0;overflow-wrap:anywhere;color:var(--sub)}.ident dd span{display:inline-block;max-width:100%;vertical-align:top}
h1{margin:0;font-size:1.45rem;line-height:1.3;color:var(--fg);text-wrap:balance}
.stats{flex:1 1 460px;display:grid;gap:8px}
.total{margin:0 2px;text-align:center;color:var(--mut);font-size:.82rem;font-variant-numeric:tabular-nums}.total b{color:var(--fg)}
.counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.count{display:flex;align-items:center;gap:12px;min-width:0;background:var(--raise);border-radius:14px;padding:10px 12px}
.count b{display:block;font-size:1.25rem;line-height:1.15;font-variant-numeric:tabular-nums}.count div span{display:block;color:var(--mut);font-size:.74rem}
.chip{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:none;background:var(--top);color:var(--sub)}
.chip.high{background:var(--hi);color:var(--on-hi)}.chip.medium{background:var(--mid);color:var(--on-mid)}.chip.acc{background:var(--acc);color:var(--on-acc)}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;font-weight:700;transition:background-color var(--dur) var(--ease)}
summary::-webkit-details-marker{display:none}summary:hover{background:var(--raise)}
summary:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.chev{margin-left:auto;color:var(--mut);transition:transform var(--dur) var(--ease)}details[open]:not(.closing)>summary .chev{transform:rotate(90deg)}
.moving>.fold{overflow:hidden}
.n{color:var(--mut);font-weight:400;font-variant-numeric:tabular-nums}
.kind{background:var(--top);color:var(--sub);border-radius:999px;padding:1px 9px;font-size:.7rem;font-weight:400}
h2{margin:0;font-size:1rem;overflow-wrap:anywhere;min-width:0}
.legend{display:grid;gap:12px;padding:4px 16px 18px;font-size:.84rem;color:var(--sub);max-width:120ch}.legend div{display:flex;gap:12px;align-items:center}.legend b{color:var(--fg)}
.hits{list-style:none;margin:0;padding:2px 8px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:4px 12px;align-items:start}
.hits li{display:flex;gap:12px;min-width:0;padding:12px 10px;border-radius:14px;transition:transform var(--dur) var(--ease),background-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.hits li:hover{background:var(--raise);transform:translateY(-2px);box-shadow:0 10px 24px -14px var(--shade)}
.body{flex:1;min-width:0}.top{display:flex;align-items:baseline;gap:10px}
h3{margin:0;font-size:.95rem;overflow-wrap:anywhere}
.lvl{margin-left:auto;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}li.high .lvl{color:var(--hi-fg)}li.medium .lvl{color:var(--mid-fg)}
a{color:var(--acc);font-size:.8rem;text-decoration-thickness:1px;text-underline-offset:3px;overflow-wrap:anywhere}
dl.meta{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:1px 12px;margin:6px 0 0;font-size:.8rem}dl.meta dt{color:var(--mut);overflow-wrap:anywhere}dl.meta dd{margin:0;overflow-wrap:anywhere}
.note{margin:6px 0 0;color:var(--sub);font-size:.82rem}.note::first-letter{text-transform:uppercase}
.none{margin:0;padding:0 16px 18px 60px;color:var(--mut)}
.card,.hits li{animation:rise var(--dur-in) var(--ease-in) backwards;animation-delay:calc(var(--i,0) * 32ms)}
@keyframes rise{from{opacity:0;transform:translateY(var(--rise))}}
@keyframes fade{from{opacity:0}}
@media (max-width:520px){.head{padding:16px}.id{gap:16px;flex-basis:100%;align-items:flex-start}.avatar{width:64px;height:64px;border-radius:18px;font-size:1.7rem}.ident div{grid-template-columns:minmax(0,1fr)}.ident div+div{margin-top:4px}h1{font-size:1.25rem}
.count{flex-direction:column;align-items:flex-start;gap:8px;padding:10px}.hits{padding-inline:4px}.none{padding-left:16px}}
@media (prefers-reduced-motion:reduce){:root{--rise:0px}.hits li:hover{transform:none}}
@media print{.chev{display:none}.hits li{break-inside:avoid}.card,.hits li,.avatar img{animation:none}}`;

const JS = `const still=matchMedia("(prefers-reduced-motion: reduce)");
for(const d of document.querySelectorAll("details")){const fold=d.lastElementChild;let run=null;
d.firstElementChild.addEventListener("click",e=>{if(still.matches)return;e.preventDefault();
const opening=!d.open||d.classList.contains("closing");const from=d.open?fold.getBoundingClientRect().height:0;const fade=d.open?getComputedStyle(fold).opacity:0;
run?.cancel();d.open=true;d.classList.add("moving");d.classList.toggle("closing",!opening);
run=fold.animate({height:[from+"px",(opening?fold.scrollHeight:0)+"px"],opacity:[fade,opening?1:0]},opening?{duration:340,easing:"cubic-bezier(.2,0,0,1)"}:{duration:220,easing:"cubic-bezier(.3,0,.8,.15)"});
run.onfinish=()=>{run=null;d.classList.remove("moving","closing");if(!opening)d.open=false}})}
const pics=document.getElementById("photos");
if(pics){const imgs=[...pics.content.querySelectorAll("img")];const srcs=imgs.map(i=>i.getAttribute("src"));const votes=imgs.map(i=>Number(i.dataset.n)||1);
const hash=src=>new Promise(ok=>{const im=new Image();im.onerror=()=>ok(null);im.onload=()=>{try{const c=document.createElement("canvas");c.width=72;c.height=64;
const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#808080";x.fillRect(0,0,72,64);x.imageSmoothingQuality="high";x.drawImage(im,0,0,72,64);
const p=x.getImageData(0,0,72,64).data;const g=new Float32Array(72),rgb=new Float32Array(216);for(let j=0;j<p.length;j+=4){const n=j/4,c=(n/576|0)*9+((n%72)>>3);g[c]+=p[j]*.299+p[j+1]*.587+p[j+2]*.114;for(let k=0;k<3;k++)rgb[c*3+k]+=p[j+k]/64}
const d=[];for(let y=0;y<8;y++)for(let k=0;k<8;k++)d.push((g[y*9+k+1]-g[y*9+k])/64);ok({d,rgb})}catch{ok(null)}};im.src=src});
const near=(a,b)=>{let same=0,gap=0;a.d.forEach((v,i)=>{if(Math.abs(v)>2&&Math.abs(b.d[i])>2&&(v>0)===(b.d[i]>0))same++});a.rgb.forEach((v,i)=>{gap+=Math.abs(v-b.rgb[i])});return same>=12&&gap<=8*216};
Promise.all(srcs.map(hash)).then(hs=>{const score=hs.map(h=>h?hs.reduce((n,o,j)=>o&&near(h,o)?n+votes[j]:n,0):-1);
const best=score.reduce((b,s,i)=>s>score[b]?i:b,0);if(score[best]<0)return;const im=new Image();im.alt="";im.src=srcs[best];
im.decode().then(()=>document.querySelector(".avatar").append(im),()=>{})})}`;

const ICON: Record<string, string> = {
	high: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
	medium: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	low: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const MAX_STAGGER = 10;

const anchor = (url: string) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;

/** Escaped text with every http(s) url in it turned into a link, trailing punctuation left outside. */
function linkify(text: string) {
	let out = "";
	let last = 0;
	for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
		const url = m[0].replace(/[.,;:!?)\]}]+$/, "");
		out += esc(text.slice(last, m.index)) + anchor(url);
		last = m.index + url.length;
	}
	return out + esc(text.slice(last));
}

function item(h: Ranked, { title, kind }: Section, i: number) {
	const link = kind === "email" ? h.url : profile(h.url, title);
	const url = /^https?:\/\//.test(link) ? anchor(link) : "";
	const meta = h.meta.size
		? `<dl class="meta">${[...h.meta].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${linkify(v)}</dd>`).join("")}</dl>`
		: "";
	return (
		`<li class="${h.level}" style="--i:${i}">${chip(h.level)}<div class="body"><div class="top"><h3>${esc(h.site)}</h3>` +
		`<span class="lvl">${h.level}</span></div>${url}${meta}<p class="note">${esc(h.advice)}</p></div></li>`
	);
}

function section(s: Section, i: number) {
	const { title, kind, checked, hits } = s;
	const body = hits.length
		? `<ul class="hits">${hits.map((h, j) => item(h, s, i + 1 + Math.min(j, MAX_STAGGER))).join("")}</ul>`
		: `<p class="none">${checked.length ? "Nothing found" : "Not checked"}</p>`;
	const lead = hits[0]?.level ?? "low";
	return (
		`<details class="card" open style="--i:${i}"><summary>${chip(lead)}<h2>${esc(title)}</h2>` +
		`<span class="kind">${kind}</span><span class="n">${hits.length}</span>${svg("chev", "chev")}</summary>` +
		`<div class="fold">${body}</div></details>`
	);
}

const handle = (s: string) => s.trim().replace(/^@+/, "");

/** Every username the hits' details carry, like github_username, one entry per mention. */
function handles(sections: Section[]) {
	return sections.flatMap((s) =>
		s.hits.flatMap((h) =>
			[...h.meta].flatMap(([k, v]) => (alnum(k).endsWith("username") && handle(v) ? handle(v) : [])),
		),
	);
}

/** The username searched for, the one with the most hits when there are several, or for emails the username their hits mention most. */
export function reportName(sections: Section[]) {
	const users = sections.filter((s) => s.kind === "username");
	if (users.length) return users.reduce((best, s) => (s.hits.length > best.hits.length ? s : best)).title;
	const counts = new Map<string, number>();
	for (const name of handles(sections)) counts.set(name, (counts.get(name) ?? 0) + 1);
	const [top] = [...counts].sort((a, b) => b[1] - a[1]);
	return top?.[0] ?? sections[0]?.title.split("@")[0] ?? "footprint";
}

/** Each value once, the most mentioned first, ties in the order they first showed up. */
function byCount(xs: [value: string, weight: number][]) {
	const counts = new Map<string, [value: string, n: number]>();
	for (const [x, w] of xs) {
		const seen = counts.get(x.toLowerCase());
		counts.set(x.toLowerCase(), [seen?.[0] ?? x, (seen?.[1] ?? 0) + w]);
	}
	return [...counts.values()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

/** Who the report is about: the names the hits show, then the usernames, then the emails, each sorted by how often it shows up. */
export function identity(sections: Section[]): [label: string, values: string[]][] {
	const found = (label: string) =>
		sections.flatMap((s) => mentions(s.hits, s.title, label)).map((v): [string, number] => [v, 1]);
	const titles = (kind: string) =>
		sections.filter((s) => s.kind === kind).map((s): [string, number] => [s.title, Math.max(1, s.hits.length)]);
	const rows: [string, string[]][] = [
		["names", byCount(found("names"))],
		["usernames", byCount([...titles("username"), ...handles(sections).map((h): [string, number] => [h, 1])])],
		["emails", byCount([...titles("email"), ...found("emails").filter(([e]) => !e.includes("*"))])],
	];
	return rows.filter(([, values]) => values.length);
}

const PHOTO_KEY = /^(image|avatar|photo|picture|thumbnail|profileimage|profilepic|profilepicture|pfp)(url)?$/;
const MAX_PHOTOS = 12;
const PHOTO_BYTES = 1 << 20;
const PHOTO_TIMEOUT = 5_000;

/** One image as a data: URI, or nothing when it isn't a small raster image that arrives in time. */
async function photo(url: string): Promise<string[]> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT) });
		const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
		if (!res.ok || !res.body || !/^image\/[a-z0-9.+-]+$/.test(type) || type.includes("svg")) return [];
		if (Number(res.headers.get("content-length") ?? 0) > PHOTO_BYTES) return [];
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of res.body) {
			size += chunk.length;
			if (size > PHOTO_BYTES) return [];
			chunks.push(chunk);
		}
		return size ? [`data:${type};base64,${Buffer.concat(chunks).toString("base64")}`] : [];
	} catch {
		return [];
	}
}

/** The profile photos the hits point at as data: URIs, one per hit that shows it, highest risk first; each url is fetched once and anything that fails is left out. `fetching` hears how many urls are about to be fetched, when there are any. */
export async function photos(sections: Section[], fetching?: (n: number) => void) {
	const hits = sections.flatMap((s) => s.hits).sort((a, b) => RANK[a.level] - RANK[b.level]);
	const wanted = hits.flatMap((h) => [
		...new Set([...h.meta].filter(([k, v]) => PHOTO_KEY.test(alnum(k)) && /^https?:\/\//.test(v)).map(([, v]) => v)),
	]);
	const urls = [...new Set(wanted)].slice(0, MAX_PHOTOS);
	if (urls.length) fetching?.(urls.length);
	const got = new Map(await Promise.all(urls.map(async (url) => [url, await photo(url)] as const)));
	return wanted.flatMap((url) => got.get(url) ?? []);
}

const MAX_NAME = 120;

export const fileName = (name: string) =>
	`${cut(name.replace(/[^\p{L}\p{N}_.@+-]+/gu, "_").replace(/^\.+/, ""), MAX_NAME) || "footprint"}.html`;

export function render(name: string, sections: Section[], out: string, pics: string[] = []) {
	const hits = sections.flatMap((s) => s.hits);
	const rows = identity(sections);
	const ident = rows
		.map(([label, values], i) => {
			const text = values
				.map(
					(v, j) => `<span>${esc(v).replace(/[.@](?=[^@]*@)|@/g, "<wbr>$&")}${j < values.length - 1 ? "," : ""}</span>`,
				)
				.join(" ");
			return `<div><dt>${label}</dt><dd>${i ? text : `<h1>${text}</h1>`}</dd></div>`;
		})
		.join("");
	const letter = esc([...(rows[0]?.[1][0] ?? name)][0] ?? "f");
	const votes = new Map<string, number>();
	for (const p of pics) votes.set(p, (votes.get(p) ?? 0) + 1);
	const photoList = votes.size
		? `<template id="photos">${[...votes].map(([p, n]) => `<img src="${esc(p)}" data-n="${n}" alt="">`).join("")}</template>`
		: "";
	const counts = LEVELS.map(
		(lvl) =>
			`<div class="count">${chip(lvl)}<div><b>${hits.filter((h) => h.level === lvl).length}</b><span>${lvl}</span></div></div>`,
	).join("");
	const legend =
		`<details class="card" style="--i:1"><summary>${chip("help", "acc")}How to read it${svg("chev", "chev")}</summary><div class="fold"><div class="legend">` +
		LEVELS.map((lvl) => `<div>${chip(lvl)}<span><b>${lvl}</b> · ${LEGEND[lvl]}</span></div>`).join("") +
		"<div><span>A hit can belong to someone else with the same handle, so open it before drawing conclusions.</span></div></div></div></details>";
	const page =
		'<!doctype html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width,initial-scale=1">' +
		`<title>footprint · ${esc(name)}</title><style>${CSS}</style></head><body><main>` +
		`<header class="card head"><div class="id"><div class="avatar" aria-hidden="true">${letter}</div><dl class="ident">${ident}</dl></div>` +
		`<div class="stats"><p class="total"><b>${hits.length}</b> hits across <b>${sections.length}</b> ${sections.length === 1 ? "target" : "targets"}</p>` +
		`<div class="counts">${counts}</div></div></header>` +
		`${legend}${sections.map((s, i) => section(s, i + 2)).join("")}</main>${photoList}<script>${JS}</script></body></html>`;
	writeFileSync(out, page);
	return hits.length;
}

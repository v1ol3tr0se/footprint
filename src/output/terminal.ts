import { canon, key } from "../core/hit.ts";
import { intel } from "../core/intel.ts";
import { cut, normUrl, pad, squash } from "../core/text.ts";
import type { Level, Section } from "../core/types.ts";

const closed = new Set<NodeJS.WriteStream>();

for (const stream of [process.stdout, process.stderr]) {
	stream.on("error", (e: NodeJS.ErrnoException) => {
		if (e.code !== "EPIPE") throw e;
		closed.add(stream);
	});
}

const write = (stream: NodeJS.WriteStream, s: string) => {
	if (!closed.has(stream)) stream.write(s);
};

/** Where output goes; a reader that went away (like `| head`) is ignored so the scan still finishes and writes its report. */
export const io = {
	out: (s: string) => write(process.stdout, s),
	err: (s: string) => write(process.stderr, s),
};

export const shown = new Set<string>();

export const BANNER = `
  █████▒▒█████   ▒█████  ▄▄▄█████▓ ██▓███   ██▀███   ██▓ ███▄    █ ▄▄▄█████▓
▓██   ▒▒██▒  ██▒▒██▒  ██▒▓  ██▒ ▓▒▓██░  ██▒▓██ ▒ ██▒▓██▒ ██ ▀█   █ ▓  ██▒ ▓▒
▒████ ░▒██░  ██▒▒██░  ██▒▒ ▓██░ ▒░▓██░ ██▓▒▓██ ░▄█ ▒▒██▒▓██  ▀█ ██▒▒ ▓██░ ▒░
░▓█▒  ░▒██   ██░▒██   ██░░ ▓██▓ ░ ▒██▄█▓▒ ▒▒██▀▀█▄  ░██░▓██▒  ▐▌██▒░ ▓██▓ ░
░▒█░   ░ ████▓▒░░ ████▓▒░  ▒██▒ ░ ▒██▒ ░  ░░██▓ ▒██▒░██░▒██░   ▓██░  ▒██▒ ░
 ▒ ░   ░ ▒░▒░▒░ ░ ▒░▒░▒░   ▒ ░░   ▒▓▒░ ░  ░░ ▒▓ ░▒▓░░▓  ░ ▒░   ▒ ▒   ▒ ░░
 ░       ░ ▒ ▒░   ░ ▒ ▒░     ░    ░▒ ░       ░▒ ░ ▒░ ▒ ░░ ░░   ░ ▒░    ░
 ░ ░   ░ ░ ░ ▒  ░ ░ ░ ▒    ░      ░░         ░░   ░  ▒ ░   ░   ░ ░   ░
           ░ ░      ░ ░                       ░      ░           ░
`;

const LEVEL_COLOR: Record<Level, string> = { high: "1;35", medium: "1;33", low: "2" };

export const paint = (code: string, text: string) =>
	process.stdout.isTTY && !("NO_COLOR" in process.env) ? `\x1b[${code}m${text}\x1b[0m` : text;

export const show = (line: string) => io.out(`${line}\n`);

export const say = (msg: string) => io.err(`footprint: ${msg}\n`);

/** Print a hit as it's found, once per site even when several tools report it. */
export function live(target: string, site: string, url = "") {
	const [name, link] = canon(site, url, target);
	const keys = [`${target}\0${key(name)}`, `${target}\0${normUrl(link) || name}`];
	if (keys.some((k) => shown.has(k))) return;
	for (const k of keys) shown.add(k);
	show(`  ${paint("32", "✔")} ${paint("1", name)}  ${paint("36", link)}`.trimEnd());
}

export function summary(sections: Section[]) {
	for (const { title, kind, checked, hits } of sections) {
		show(`\n${paint("1;32", title)}  ${paint("2", `${kind} · ${hits.length} accounts`)}`);
		if (!hits.length) {
			show(paint("2", checked.length ? "  nothing found" : "  not checked"));
			continue;
		}
		const info = Object.entries(intel(hits, title));
		if (info.length) {
			show("");
			for (const [label, vals] of info) show(`  ${paint("2", pad(label, 10))} ${cut(vals.join(", "), 300)}`);
		}
		show("");
		const width = Math.min(Math.max(...hits.map((h) => [...h.site].length)), 24);
		for (const h of hits) {
			const tag = paint(LEVEL_COLOR[h.level], pad(h.level.toUpperCase(), 6));
			show(`  ${tag}  ${paint("1", pad(cut(h.site, 24), width))}  ${paint("36", h.url)}`.trimEnd());
			const items = [...h.meta];
			items.forEach(([k, v], i) => {
				const branch = i === items.length - 1 ? "└─" : "├─";
				show(paint("2", `          ${branch} ${k}: `) + cut(squash(v), 120));
			});
		}
	}
}

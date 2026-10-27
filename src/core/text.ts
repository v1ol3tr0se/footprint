export const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const normUrl = (url: string) => url.toLowerCase().replace(/^https?:\/\/(www\.)?|\/+$/g, "");

/** A bare homepage like https://adobe.com says nothing about the account, so it counts as no link; https://target.deviantart.com still does. */
export function profile(url: string, target: string) {
	const host = /^https?:\/\/([^/?#]+)\/?$/.exec(url)?.[1];
	return host && !host.toLowerCase().includes(target.toLowerCase()) ? "" : url;
}

export const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** Compare by code point, the way python sorts strings (plain < compares UTF-16 units). */
export function cmp(a: string, b: string) {
	const x = [...a];
	const y = [...b];
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
		if (d) return d < 0 ? -1 : 1;
	}
	return x.length - y.length;
}

export const cut = (s: string, n: number) => [...s].slice(0, n).join("");

export const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));

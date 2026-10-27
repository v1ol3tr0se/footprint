const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
const HEX: Record<string, number> = { x: 2, u: 4, U: 8 };
const WORDS: Record<string, unknown> = { True: true, False: false, None: null };
const NUMBER = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?/;
const SPECIAL = /(?<=(?:^|[:,[])\s*)(NaN|-?Infinity)(?=\s*(?:[,\]}]|$))/g;

/** A number python would print as a float, so 5.0 stays "5.0" instead of becoming "5". */
export class PyFloat {
	readonly value: number;

	constructor(value: number) {
		this.value = value;
	}
}

function number(src: string): unknown {
	if (/[.eE]/.test(src)) return new PyFloat(Number(src));
	const n = Number(src);
	return Number.isSafeInteger(n) ? n : BigInt(src);
}

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
const revive: Reviver = (_key, value, context) =>
	typeof value === "number" && context?.source ? number(context.source) : value;

/** JSON.parse that keeps big ints exact, remembers which numbers were floats, and reads python's NaN/Infinity. */
export function parseJson(text: string): unknown {
	const parse = (s: string) => JSON.parse(s, revive as Parameters<typeof JSON.parse>[1]);
	try {
		return parse(text);
	} catch (e) {
		const fixed = text.replace(SPECIAL, (m) => `"${m === "NaN" ? "nan" : m.replace("Infinity", "inf")}"`);
		if (fixed === text) throw e;
		return parse(fixed);
	}
}

/** Read a python list literal like "['a', 'b']", the way maigret stores list fields; undefined if it isn't one. */
export function pyList(s: string): unknown[] | undefined {
	let i = 0;
	const ws = () => {
		while (/[ \t\f\r\n]/.test(s[i] ?? "")) i++;
	};
	const str = (quote: string) => {
		let out = "";
		for (i++; s[i] !== quote; ) {
			if (i >= s.length) throw new SyntaxError("unterminated string");
			if (s[i] !== "\\") {
				out += s[i++];
				continue;
			}
			const e = s[++i];
			i++;
			const n = HEX[e];
			if (n) {
				const hex = s.slice(i, i + n);
				if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(hex)) throw new SyntaxError("bad escape");
				out += String.fromCodePoint(Number.parseInt(hex, 16));
				i += n;
			} else {
				out += ESCAPES[e] ?? `\\${e}`;
			}
		}
		i++;
		return out;
	};
	const value = (): unknown => {
		ws();
		const c = s[i];
		if (c === "'" || c === '"') return str(c);
		if (c === "[") {
			const xs: unknown[] = [];
			for (i++, ws(); s[i] !== "]"; ws()) {
				xs.push(value());
				ws();
				if (s[i] === ",") i++;
				else if (s[i] !== "]") throw new SyntaxError("expected , or ]");
			}
			i++;
			return xs;
		}
		const word = /^(True|False|None)\b/.exec(s.slice(i));
		if (word) {
			i += word[0].length;
			return WORDS[word[0]];
		}
		const m = NUMBER.exec(s.slice(i));
		if (!m || (!/[.eE]/.test(m[0]) && /^[-+]?0\d/.test(m[0]))) throw new SyntaxError("not a literal");
		i += m[0].length;
		return number(m[0]);
	};
	try {
		const v = value();
		ws();
		return i === s.length && Array.isArray(v) ? v : undefined;
	} catch {
		return undefined;
	}
}

function float(n: number) {
	if (Number.isNaN(n)) return "nan";
	if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
	if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
	const [mantissa, e] = n.toExponential().split("e");
	const exp = Number(e);
	if (exp < -4 || exp >= 16) return `${mantissa}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
	const s = String(n);
	return s.includes(".") ? s : `${s}.0`;
}

function quote(s: string) {
	const q = s.includes("'") && !s.includes('"') ? '"' : "'";
	const body = s.replace(/[\\'"]|[^\x20-\x7e\xa0-\u{10ffff}]/gu, (c) => {
		if (c === "\\") return "\\\\";
		if (c === "\n") return "\\n";
		if (c === "\r") return "\\r";
		if (c === "\t") return "\\t";
		if (c === "'" || c === '"') return c === q ? `\\${c}` : c;
		const n = c.codePointAt(0) ?? 0;
		return n < 0x100 ? `\\x${n.toString(16).padStart(2, "0")}` : `\\u${n.toString(16).padStart(4, "0")}`;
	});
	return `${q}${body}${q}`;
}

/** Python's repr(), for values inside a list or dict. */
function repr(v: unknown): string {
	if (typeof v === "string") return quote(v);
	if (v == null) return "None";
	if (typeof v === "boolean") return v ? "True" : "False";
	if (v instanceof PyFloat) return float(v.value);
	if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
	if (typeof v === "object") {
		return `{${Object.entries(v)
			.map(([k, x]) => `${quote(k)}: ${repr(x)}`)
			.join(", ")}}`;
	}
	return String(v);
}

/** Python's str(). */
const str = (v: unknown) => (typeof v === "string" ? v : repr(v));

function truthy(v: unknown) {
	if (v == null || v === false || v === 0 || v === 0n || v === "") return false;
	if (v instanceof PyFloat) return v.value !== 0;
	if (typeof v === "object") return Object.keys(v).length > 0;
	return true;
}

/** Turn a scraped field into one line the way python's str() would: lists become "a, b", empty values become "". */
export function flat(v: unknown): string {
	const val = typeof v === "string" && v.startsWith("[") ? (pyList(v) ?? v) : v;
	if (Array.isArray(val)) return val.filter(truthy).map(str).join(", ");
	return truthy(val) ? str(val) : "";
}

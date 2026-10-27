import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { show } from "../output/terminal.ts";
import { type Ask, ask as askStdin, doneAsking } from "./prompt.ts";

export class Exit extends Error {
	readonly code: number;

	constructor(code: number, message = "") {
		super(message);
		this.code = code;
	}
}

export type Args = {
	user: string[];
	email: string[];
	name: string | null;
	html: boolean;
	htmlPath: string | null;
	blackbirdHome: string;
	noNsfw: boolean;
	interactive: boolean;
};

const USAGE =
	"usage: footprint [-u USER ...] [-e EMAIL ...] [-n NAME] [--html [PATH]] [--blackbird-home DIR] [--no-nsfw] [-i]";

export const HELP = `${USAGE}

aggregate osint tools into one self-audit report

  -u, --user USER ...     usernames to check
  -e, --email EMAIL ...   emails to check
  -n, --name NAME         title for the html report (default the report's name)
  --html, -html [PATH]    also write the html report (default reports/<most found username>.html)
  --blackbird-home DIR    blackbird clone to run, it writes into its own results/
  --no-nsfw               leave nsfw sites out
  -i, --interactive       ask for everything instead
  -h, --help              show this and quit
`;

export const expand = (p: string) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

const fail = (msg: string): never => {
	throw new Exit(2, `${USAGE}\nfootprint: error: ${msg}`);
};

function unique(xs: string[]) {
	const seen = new Map<string, string>();
	for (const x of xs) if (x && !seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x);
	return [...seen.values()];
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** argparse's rule: "-", negative numbers and anything with a space are values, not flags. */
const isFlag = (s: string) => s.startsWith("-") && s !== "-" && !/^-\d+$|^-\d*\.\d+$/.test(s) && !s.includes(" ");

const tidy = (p: string) => normalize(expand(p)).replace(/(.)\/+$/, "$1");

function read(argv: string[]): Args {
	const a: Args = {
		user: [],
		email: [],
		name: null,
		html: false,
		htmlPath: null,
		blackbirdHome: join(homedir(), "Tools/OSINT/blackbird"),
		noNsfw: false,
		interactive: false,
	};
	const extra: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const eq = arg.startsWith("--") || arg.startsWith("-html=") ? arg.indexOf("=") : -1;
		const flag = eq < 0 ? arg : arg.slice(0, eq);
		const inline = eq < 0 ? undefined : arg.slice(eq + 1);
		const hasValue = () => i + 1 < argv.length && !isFlag(argv[i + 1]);
		const one = () => inline ?? (hasValue() ? argv[++i] : fail(`argument ${flag}: expected one argument`));
		const many = () => {
			if (inline !== undefined) return [inline];
			const vals: string[] = [];
			while (hasValue()) vals.push(argv[++i]);
			return vals.length ? vals : fail(`argument ${flag}: expected at least one argument`);
		};
		const bare = () => inline === undefined || fail(`argument ${flag}: ignored explicit argument '${inline}'`);
		switch (flag) {
			case "-u":
			case "--user":
				a.user.push(...many());
				break;
			case "-e":
			case "--email":
				a.email.push(...many());
				break;
			case "-n":
			case "--name":
				a.name = one();
				break;
			case "-html":
			case "--html":
				a.htmlPath = inline ?? (hasValue() ? argv[++i] : null);
				a.html = a.htmlPath !== "";
				break;
			case "--blackbird-home":
				a.blackbirdHome = resolve(expand(one()));
				break;
			case "--no-nsfw":
				a.noNsfw = bare();
				break;
			case "-i":
			case "--interactive":
				a.interactive = bare();
				break;
			case "-h":
			case "--help":
				show(HELP.trimEnd());
				throw new Exit(0);
			case "--":
				extra.push(...argv.slice(i + 1));
				i = argv.length;
				break;
			default:
				extra.push(arg);
		}
	}
	if (extra.length) fail(`unrecognized arguments: ${extra.join(" ")}`);
	return a;
}

async function interview(a: Args, ask: Ask) {
	a.user.push(...words(await ask("usernames")));
	a.email.push(...words(await ask("emails")));
	if (!a.html && /^[ys]/.test((await ask("html report? y/N")).toLowerCase())) {
		a.html = true;
		a.htmlPath = (await ask("save it as (enter for reports/)")) || null;
	}
	doneAsking();
	show("");
}

export async function parseArgs(argv: string[], ask: Ask = askStdin): Promise<Args> {
	const a = read(argv);
	if (a.interactive) await interview(a, ask);
	a.user = unique(a.user.map((u) => u.trim().replace(/^@+/, "")));
	a.email = unique(a.email.map((e) => e.trim()));
	a.htmlPath = a.htmlPath ? tidy(a.htmlPath) : null;
	if (!a.user.length && !a.email.length) fail("give at least one --user or --email");
	const notEmail = a.email.filter((e) => !e.includes("@"));
	if (notEmail.length) fail(`not an email: ${notEmail.join(", ")}`);
	const dashed = [...a.user, ...a.email].filter((t) => t.startsWith("-"));
	if (dashed.length) fail(`targets can't start with '-': ${dashed.join(", ")}`);
	return a;
}

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hit } from "../core/hit.ts";
import type { Found } from "../core/types.ts";
import type { Engine, Outcome } from "./index.ts";
import { run, which } from "./process.ts";
import { Verifier } from "./verifier.ts";

const CHECKING = /^\[\*\] Checking username (.+) on:/;
const CLAIMED = /^\[\+\] (.+?): (https?:\/\/\S+)/;

export async function runSherlock(users: string[], tmp: string, noNsfw: boolean): Promise<Outcome> {
	const argv = ["sherlock", "--no-color", "--timeout", "20", "--csv", "--no-txt", ...(noNsfw ? [] : ["--nsfw"])];
	const check = new Verifier("sherlock", argv, "--print-all", tmp, new Set());
	const found: Found = new Map();
	let cur: string | undefined;

	const onLine = (ln: string) => {
		const checking = CHECKING.exec(ln);
		if (checking) {
			cur = checking[1];
			found.set(cur, []);
			return;
		}
		const claimed = cur && CLAIMED.exec(ln);
		if (cur && claimed) {
			found.get(cur)?.push(hit(claimed[1], claimed[2], "sherlock"));
			check.claim(cur, claimed[1], claimed[1], claimed[2]);
		}
	};

	const outDir = join(tmp, "sherlock");
	mkdirSync(outDir);
	check.start();
	let problem: string | null;
	try {
		[, problem] = await run("sherlock", [...argv, "-fo", outDir, "--", ...users], { onLine, limit: 600, cwd: outDir });
	} finally {
		await check.finish();
	}
	const notes = [...(problem ? [problem] : []), ...check.notes()];
	return [new Map([...found].map(([u, hits]) => [u, hits.filter((h) => check.passed(u, h.site))])), notes];
}

export const sherlock: Engine = {
	name: "sherlock",
	covers: ["username"],
	plan: ({ users, tmp, noNsfw }) => {
		if (!users.length || !which("sherlock")) return {};
		return { run: () => runSherlock(users, tmp, noNsfw) };
	},
};

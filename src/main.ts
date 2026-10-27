#!/usr/bin/env node
/**
 * footprint — one self-audit report out of the osint tools you already run.
 *
 * give it your own usernames and emails. it runs whichever of maigret, sherlock, blackbird
 * and holehe it can find, side by side, merges what they find, ranks each hit by
 * how much it exposes you, and writes a single themed html report that also says
 * what couldn't be checked. meant for auditing your own exposure, not profiling
 * anyone else.
 */
import { main } from "./cli/app.ts";
import { Exit } from "./cli/args.ts";

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (e) {
	if (!(e instanceof Exit)) throw e;
	if (e.message) process.stderr.write(`${e.message}\n`);
	process.exitCode = e.code;
}

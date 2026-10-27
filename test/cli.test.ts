import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli/app.ts";
import { Exit, parseArgs } from "../src/cli/args.ts";
import { capture, fakeBlackbird, path, tempDir } from "./helpers.ts";

const MAIN = join(import.meta.dirname, "../src/main.ts");

const exits = (code: number, message?: RegExp) => (e: unknown) =>
	e instanceof Exit && e.code === code && (!message || message.test(e.message));

test("parse args extends, dedupes and validates", async () => {
	const a = await parseArgs(["-u", "@eve", "-u", "Eve", "bob", "-e", "me@x.com", "ME@x.com"]);
	assert.deepEqual(a.user, ["eve", "bob"]);
	assert.deepEqual(a.email, ["me@x.com"]);
	await assert.rejects(parseArgs(["-e", "nope"]), exits(2, /not an email: nope/));
	await assert.rejects(parseArgs(["--user=-x"]), exits(2, /can't start with '-'/));
	await assert.rejects(parseArgs([]), exits(2, /at least one/));
	await assert.rejects(parseArgs(["-u"]), exits(2, /expected at least one argument/));
	await assert.rejects(parseArgs(["-u", "a", "stray", "-n"]), exits(2, /expected one argument/));
	await assert.rejects(parseArgs(["-u", "a", "--wat"]), exits(2, /unrecognized arguments: --wat/));
	await assert.rejects(parseArgs(["-u", "a", "--", "b"]), exits(2, /unrecognized arguments: b/));
	assert.ok(isAbsolute((await parseArgs(["-u", "a", "--blackbird-home", "bb"])).blackbirdHome));
});

test("html takes an optional path in every spelling", async () => {
	const html = async (...argv: string[]) => {
		const a = await parseArgs(["-u", "a", ...argv]);
		return [a.html, a.htmlPath];
	};
	assert.deepEqual(await html(), [false, null]);
	assert.deepEqual(await html("--html"), [true, null]);
	assert.deepEqual(await html("-html", "-n", "x"), [true, null]);
	assert.deepEqual(await html("-html", "me.html"), [true, "me.html"]);
	assert.deepEqual(await html("--html=out/r.html"), [true, "out/r.html"]);
	assert.deepEqual(await html("-html=r.html"), [true, "r.html"]);
});

test("interactive asks for what is missing", async () => {
	const answers = ["@eve bob", "me@x.com", "s", ""];
	using _out = capture();
	const a = await parseArgs(["-i"], async (_label, fallback = "") => answers.shift() || fallback);
	assert.deepEqual(a.user, ["eve", "bob"]);
	assert.deepEqual(a.email, ["me@x.com"]);
	assert.equal(a.html, true);
	assert.equal(a.htmlPath, null);
});

test("unwritable output fails before scanning", async () => {
	using tmp = tempDir();
	using _out = capture();
	await assert.rejects(main(["-u", "x", "--html", tmp.path]), exits(1, /can't write/));
});

test("failed tools say not checked and exit nonzero", async () => {
	using tmp = tempDir();
	const home = fakeBlackbird(tmp.path);
	const out = join(tmp.path, "r.html");
	using _path = path(tmp.path, { replace: true });
	using _out = capture();
	const code = await main(["-u", "fail", "--html", out, "--blackbird-home", home]);
	const page = readFileSync(out, "utf8");
	assert.equal(code, 1);
	assert.equal(statSync(out).mode & 0o777, 0o600);
	assert.match(page, /maigret isn&#x27;t on PATH/);
	assert.match(page, /blackbird exited with 1/);
	assert.match(page, /not checked/);
});

test("the binary exits 0 on help and 2 on bad arguments", () => {
	const help = spawnSync(process.execPath, [MAIN, "--help"], { encoding: "utf8" });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /usage: footprint/);
	const bad = spawnSync(process.execPath, [MAIN, "-e", "nope"], { encoding: "utf8" });
	assert.equal(bad.status, 2);
	assert.match(bad.stderr, /footprint: error: not an email: nope/);
});

test("arguments follow argparse's edge cases", async () => {
	using _out = capture();
	assert.equal((await parseArgs(["-u", "a", "-n", "-1"])).name, "-1");
	assert.equal((await parseArgs(["-u", "a", "-n", "-my report"])).name, "-my report");
	const empty = await parseArgs(["-u", "a", "--html="]);
	assert.deepEqual([empty.html, empty.htmlPath], [false, null]);
	assert.equal((await parseArgs(["-u", "a", "--html", "./out//r.html/"])).htmlPath, "out/r.html");
	await assert.rejects(parseArgs(["-u", "a", "--wat", "--help"]), exits(0));
	await assert.rejects(parseArgs(["-u", "a", "x", "--", "y"]), exits(2, /unrecognized arguments: y$/));
});

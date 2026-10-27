import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseBlackbird, runBlackbird } from "../src/engines/blackbird.ts";
import { parseHolehe } from "../src/engines/holehe.ts";
import { parseMaigret, runMaigret } from "../src/engines/maigret.ts";
import { run, STOP, which } from "../src/engines/process.ts";
import { runSherlock } from "../src/engines/sherlock.ts";
import { capture, fakeBin, fakeBlackbird, path, tempDir } from "./helpers.ts";

const stamp = () => {
	const d = new Date();
	return `${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}_${d.getFullYear()}`;
};

test("holehe parsing keeps recovery hits and counts what it missed", () => {
	const out = [
		"[+] Email used, [-] Email not used, [x] Rate limit, [!] Error",
		"[+] twitter.com",
		"[+] adobe.com ex****@g****.com / +1 ***-**12",
		"[+] adobe.com  / +1 ***-**34",
		"[+] mail.ru a***@mail.ru, b***@ya.ru",
		"[+] samsung.com / 1234**56**78",
		"[+] en.gravatar.com / FullName Jane Doe / https://gravatar.com/janedoe",
		"[+] protonmail.ch / Date, time of the creation 2019-01-02 03:04:05",
		"[+] xvideos.com",
		"[-] github.com",
		"[x] instagram.com",
		"[!] office365.com Error message: boom",
		"123 websites checked in 10.2 seconds",
	].join("\n");
	const [hits, unchecked] = parseHolehe(out);
	const by = new Map(hits.map((h) => [h.site, h]));
	assert.deepEqual([...by.keys()], ["twitter", "adobe", "mail", "samsung", "gravatar", "protonmail", "xvideos"]);
	assert.equal(hits.length, 8);
	assert.deepEqual(
		hits[1].meta,
		new Map([
			["recovery email", "ex****@g****.com"],
			["phone", "+1 ***-**12"],
		]),
	);
	assert.deepEqual(hits[2].meta, new Map([["phone", "+1 ***-**34"]]));
	assert.deepEqual(by.get("samsung")?.meta, new Map([["phone", "1234**56**78"]]));
	assert.deepEqual(
		by.get("gravatar")?.meta,
		new Map([
			["fullname", "Jane Doe"],
			["profile", "https://gravatar.com/janedoe"],
		]),
	);
	assert.equal(by.get("gravatar")?.url, "https://en.gravatar.com");
	assert.deepEqual(by.get("xvideos")?.tags, new Set(["porn"]));
	assert.deepEqual(unchecked, ["instagram.com", "office365.com"]);
});

test("parse maigret skips similar and internal keys", () => {
	using tmp = tempDir();
	const report = {
		GitHub: {
			url_user: "https://github.com/x",
			status: {
				status: "Claimed",
				tags: ["coding"],
				ids: {
					username: "x",
					fullname: "X",
					_extractor: "GitHub API",
					links: "['https://a.example', 'https://b.example']",
					empty: "[]",
				},
			},
		},
		StackOverflow: { is_similar: true, status: { status: "Claimed" } },
		Reddit: { status: { status: "Available" } },
	};
	const f = join(tmp.path, "r.json");
	writeFileSync(f, JSON.stringify(report));
	const [h, ...rest] = parseMaigret(f);
	assert.equal(rest.length, 0);
	assert.deepEqual(
		h.meta,
		new Map([
			["fullname", "X"],
			["links", "https://a.example, https://b.example"],
		]),
	);
	assert.deepEqual(h.tags, new Set(["coding"]));
});

test("parse blackbird flattens arrays and hides email probe urls", () => {
	using tmp = tempDir();
	const data = [
		{
			name: "Gravatar",
			url: "https://api.example/?email=me@x.com",
			category: "social",
			metadata: [
				{ name: "URLs", type: "Array", value: ["https://a.example", false] },
				{ name: "Name", value: null },
			],
		},
	];
	const f = join(tmp.path, "r.json");
	writeFileSync(f, JSON.stringify(data));
	const [h] = parseBlackbird(f);
	const [u] = parseBlackbird(f, new Map([["Gravatar", "https://gravatar.com/me"]]));
	assert.deepEqual(h.meta, new Map([["URLs", "https://a.example"]]));
	assert.equal(h.url, "");
	assert.equal(u.url, "https://gravatar.com/me");
});

test("a tool killed by a signal stops the rest", async () => {
	try {
		assert.equal((await run("sh", ["sh", "-c", "kill -INT $$"]))[1], "sh exited with -2");
		assert.deepEqual(await run("true", ["true"]), ["", "true skipped, the run was stopped"]);
	} finally {
		STOP.clear();
	}
});

test("a tool that isn't there says it didn't start", async () => {
	const [, problem] = await run("nope", ["footprint-no-such-tool"]);
	assert.equal(problem, "nope didn't start: no such file or directory");
});

test("blackbird ignores stale and prefix-matching results", async () => {
	using tmp = tempDir();
	const home = fakeBlackbird(tmp.path);
	const old = join(home, "results", `empty_${stamp()}_blackbird`);
	mkdirSync(old, { recursive: true });
	const stale = join(old, `empty_${stamp()}_blackbird.json`);
	writeFileSync(stale, JSON.stringify([{ name: "Stale", url: "" }]));
	const hourAgo = Date.now() / 1000 - 3600;
	utimesSync(stale, hourAgo, hourAgo);
	using out = capture();
	const [found, notes] = await runBlackbird(["empty", "empty_twin"], [], home, false);
	assert.deepEqual(found.get("empty"), []);
	assert.deepEqual(notes, []);
	assert.deepEqual(
		found.get("empty_twin")?.map((h) => h.url),
		["https://github.com/empty_twin"],
	);
	assert.match(out.out(), /GitHub \(User\) {2}https:\/\/github\.com\/empty_twin\n/);
});

test("maigret hits that also find a made-up name are dropped", async () => {
	using tmp = tempDir();
	using _path = path(fakeBin(tmp.path, "maigret"));
	using out = capture();
	const [found, notes] = await runMaigret(["eve"], tmp.path, false);
	assert.deepEqual(
		found.get("eve")?.map((h) => h.site),
		["Real"],
	);
	assert.match(notes[0], /made-up name: SaysYes/);
	assert.match(notes[1], /asked again: Erratic, Flaky/);
	assert.match(out.out(), /Real/);
	assert.doesNotMatch(out.out(), /SaysYes|Flaky|Erratic/);
});

test("sherlock hits go through the same check", async () => {
	using tmp = tempDir();
	using _path = path(fakeBin(tmp.path, "sherlock"));
	using out = capture();
	const [found, notes] = await runSherlock(["eve"], tmp.path, false);
	assert.deepEqual(
		found.get("eve")?.map((h) => [h.site, h.src]),
		[["Real", "sherlock"]],
	);
	assert.equal(notes[0], "sherlock: left out 1 sites that also 'found' a made-up name: SaysYes");
	assert.match(out.out(), /Real/);
	assert.doesNotMatch(out.out(), /SaysYes/);
});

test("which ignores empty PATH entries and the current directory", () => {
	using _p = path("", { replace: true });
	assert.equal(which("sh"), false);
	delete process.env.PATH;
	assert.equal(which("sh"), true);
});

test("blackbird profile urls keep $ in usernames as is", async () => {
	using tmp = tempDir();
	const home = fakeBlackbird(tmp.path);
	using out = capture();
	const [found] = await runBlackbird(["ca$$h", "a$&b"], [], home, false);
	assert.deepEqual(
		["ca$$h", "a$&b"].map((u) => found.get(u)?.[0]?.url),
		["https://github.com/ca$$h", "https://github.com/a$&b"],
	);
	assert.match(out.out(), /github\.com\/ca\$\$h/);
});

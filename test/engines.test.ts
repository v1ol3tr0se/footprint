import assert from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseBlackbird, runBlackbird } from "../src/engines/blackbird.ts";
import { parseHolehe } from "../src/engines/holehe.ts";
import { parseMaigret, runMaigret } from "../src/engines/maigret.ts";
import { run, STOP, which } from "../src/engines/process.ts";
import { runSherlock } from "../src/engines/sherlock.ts";
import { fake } from "../src/engines/verifier.ts";
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
	const [found, notes] = await runBlackbird(["empty", "empty_twin"], [], home, false, tmp.path);
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
		["Real", "Wobbly"],
	);
	assert.equal(notes[0], "maigret: 1 sites are gone, their domain doesn't exist anymore: Dead");
	assert.match(notes[1], /^maigret · eve: 1 sites blocked the check .*: Walled$/);
	assert.equal(notes[2], "maigret · eve: 1 sites didn't answer (timed out or errored, even when asked again): Silent");
	assert.match(notes[3], /made-up name: SaysYes/);
	assert.match(notes[4], /asked again: Erratic, Flaky/);
	assert.equal(notes.length, 5);
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
		[
			["Real", "sherlock"],
			["Slow", "sherlock"],
		],
	);
	assert.equal(notes[0], "sherlock · eve: 1 sites didn't answer (timed out, bot wall, no connection or hung): Down");
	assert.equal(notes[1], "sherlock · eve: left out 1 sites that also 'found' a made-up name: SaysYes");
	assert.match(out.out(), /Real/);
	assert.match(out.out(), /Slow/);
	assert.doesNotMatch(out.out(), /SaysYes/);
});

test("a tool is only stopped once it goes quiet", async () => {
	const [out, problem] = await run("sh", ["sh", "-c", "for i in $(seq 12); do echo $i; sleep 0.1; done"], { idle: 1 });
	assert.equal(problem, null);
	assert.equal(out.split("\n").length, 13);
	const [quiet, stuck] = await run("sh", ["sh", "-c", "echo hi; exec sleep 5"], { idle: 1 });
	assert.equal(quiet, "hi\n");
	assert.match(stuck ?? "", /^sh went quiet for .+, stopped it, some sites weren't checked$/);
	assert.equal(STOP.isSet(), false);
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
	const [found] = await runBlackbird(["ca$$h", "a$&b"], [], home, false, tmp.path);
	assert.deepEqual(
		["ca$$h", "a$&b"].map((u) => found.get(u)?.[0]?.url),
		["https://github.com/ca$$h", "https://github.com/a$&b"],
	);
	assert.match(out.out(), /github\.com\/ca\$\$h/);
});

test("made-up names keep the handle's shape", () => {
	const f = fake("Eve_r0se.dev");
	assert.match(f, /^[A-Z][a-z]{2}_[a-z]\d[a-z]{2}\.[a-z]{3}$/);
	assert.notEqual(f, "Eve_r0se.dev");
	assert.match(fake("eve"), /^[a-z]{12}$/);
	assert.match(fake("1234567"), /^[1-9]{12}$/);
	assert.match(fake("rose0000"), /^[a-z]{4}[1-9]{4}$/);
	assert.match(fake("________"), /^[a-z]{12}$/);
});

test("a sherlock run that hangs gets the sites it never reached asked again", async () => {
	using tmp = tempDir();
	using _path = path(fakeBin(tmp.path, "sherlock"));
	using _out = capture();
	const before = globalThis.fetch;
	globalThis.fetch = async () => Response.json({ $schema: "x", Before: {}, Hang: {}, After: {} });
	try {
		const [, notes] = await runSherlock(["stuck"], tmp.path, false, 1);
		assert.match(notes[0], /^sherlock went quiet for .+ for stuck$/);
		assert.match(notes[1], /^sherlock · stuck: 1 sites didn't answer .*: Hang$/);
	} finally {
		globalThis.fetch = before;
	}
});

test("blackbird reruns while sites don't answer and lists the ones that never did", async () => {
	using tmp = tempDir();
	const home = fakeBlackbird(tmp.path);
	using _out = capture();
	const [found, notes] = await runBlackbird(["patchy"], [], home, false, tmp.path);
	assert.deepEqual(
		found.get("patchy")?.map((h) => h.site),
		["GitHub (User)"],
	);
	assert.deepEqual(notes, [
		"blackbird · patchy: 2 sites didn't answer in any pass (timeouts, connection errors, bot walls or rate limits): Down, Walled",
	]);
	const asked = (pass: number) =>
		JSON.parse(readFileSync(join(tmp.path, `blackbird-pass${pass}`, "data/wmn-data.json"), "utf8")).sites.map(
			(s: { name: string }) => s.name,
		);
	assert.deepEqual(asked(1), ["GitHub (User)", "Down", "Walled", "Limited"]);
	assert.deepEqual(asked(2), ["Down", "Walled"]);
});

test("blackbird asks again about email checks that got rate-limited", async () => {
	using tmp = tempDir();
	const home = fakeBlackbird(tmp.path);
	using _out = capture();
	const [, notes] = await runBlackbird([], ["me@x.example"], home, false, tmp.path);
	assert.deepEqual(notes, []);
	const asked = JSON.parse(readFileSync(join(tmp.path, "blackbird-pass1/data/email-data.json"), "utf8")).sites;
	assert.deepEqual(
		asked.map((s: { name: string }) => s.name),
		["Gravatar"],
	);
});

test("a sherlock retry that hangs on its first site still asks the rest again", async () => {
	using tmp = tempDir();
	using _path = path(fakeBin(tmp.path, "sherlock"));
	using _out = capture();
	const [, notes] = await runSherlock(["drip"], tmp.path, false, 1);
	assert.ok(notes.includes("sherlock · drip: 1 sites didn't answer (timed out, bot wall, no connection or hung): A"));
});

test("a double-check that hangs on one site sets that site aside and checks the rest", async () => {
	using tmp = tempDir();
	using _path = path(fakeBin(tmp.path, "sherlock"));
	using _out = capture();
	const [found, notes] = await runSherlock(["sticky"], tmp.path, false, 1);
	assert.deepEqual(
		found.get("sticky")?.map((h) => h.site),
		["Real"],
	);
	assert.ok(notes.includes("sherlock · sticky: couldn't double-check 1 sites, so they're left out: Sticky"));
});

test("a tool that ignores the stop gets killed shortly after", async () => {
	try {
		const running = run("sh", ["sh", "-c", "trap '' INT TERM; sleep 30"]);
		setTimeout(STOP.set, 100);
		const t0 = performance.now();
		const [, problem] = await running;
		assert.ok(performance.now() - t0 < 10_000);
		assert.equal(problem, "sh exited with -9");
	} finally {
		STOP.clear();
	}
});

test("a tool that keeps talking past its limit is stopped", async () => {
	const [, problem] = await run("sh", ["sh", "-c", "while :; do echo x; sleep 0.1; done"], { idle: 5, limit: 1 });
	assert.equal(problem, "sh took over 1 s, stopped it");
	assert.equal(STOP.isSet(), false);
});

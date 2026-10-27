import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canon, hit } from "../src/core/hit.ts";
import { intel } from "../src/core/intel.ts";
import { link, merge } from "../src/core/merge.ts";
import { flat, parseJson, pyList } from "../src/core/pyvalue.ts";
import { cmp } from "../src/core/text.ts";
import { parseHolehe } from "../src/engines/holehe.ts";
import { live } from "../src/output/terminal.ts";
import { capture } from "./helpers.ts";

test("merge dedupes across tools and prefers the profile url", () => {
	const mg = [hit("GitHub", "https://github.com/x", "maigret", { fullname: "X" })];
	const bb = [hit("GitHub (User)", "https://api.github.com/users/x", "blackbird")];
	const [m, ...rest] = merge([mg, bb]);
	assert.equal(rest.length, 0);
	assert.deepEqual(m.srcs, ["maigret", "blackbird"]);
	assert.equal(m.url, "https://github.com/x");
	assert.equal(m.meta.get("fullname"), "X");
});

test("same-tool variants stay separate and x is twitter", () => {
	const hits = merge([
		[
			hit("GitHub (User)", "u", "blackbird"),
			hit("GitHub (Gists)", "g", "blackbird"),
			hit("Discord (Invite)", "i", "blackbird"),
			hit("X", "x", "blackbird"),
		],
		[hit("Discord", "d", "maigret"), hit("Twitter", "t", "maigret")],
	]);
	assert.equal(hits.length, 5);
	assert.deepEqual(
		hits.filter((h) => h.site === "X").map((h) => h.srcs),
		[["blackbird", "maigret"]],
	);
	const same = merge([
		[
			hit("freelance.ua", "https://freelance.ua/u", "maigret"),
			hit("Free-lance.ua", "https://free-lance.ua/u", "maigret"),
		],
		[hit("Revolut", "https://revolut.me/eve/", "blackbird")],
		[hit("Revolut.me", "https://www.revolut.me/eve", "maigret")],
	]);
	assert.deepEqual(same.map((h) => h.site).sort(), ["Free-lance.ua", "Revolut", "freelance.ua"]);
});

test("risk levels", () => {
	const hits = merge([
		[
			hit("Roblox", "", "maigret"),
			hit("PayPal.Me", "", "blackbird"),
			hit("Hudson Rock", "", "maigret"),
			hit("BDSMLR", "", "blackbird", {}, ["xx NSFW xx"]),
			hit("CashMe", "", "maigret", {}, ["fintech"]),
			hit("www.patreondevelopers.com", "", "maigret"),
			hit("SomeForum", "", "maigret", { Username: "x" }),
			hit("OtherForum", "", "maigret", { avatar: "a" }),
			hit("GitLab", "", "maigret", { fullname: "X" }),
			hit("X", "", "blackbird"),
			hit("Fansly", "", "maigret", {}, ["social"]),
			hit("Buy Me a Coffee", "", "blackbird"),
		],
	]);
	assert.deepEqual(Object.fromEntries(hits.map((h) => [h.site, h.level])), {
		Roblox: "low",
		"PayPal.Me": "high",
		"Hudson Rock": "high",
		BDSMLR: "high",
		CashMe: "high",
		"www.patreondevelopers.com": "low",
		SomeForum: "low",
		OtherForum: "medium",
		GitLab: "medium",
		X: "medium",
		Fansly: "high",
		"Buy Me a Coffee": "high",
	});
	assert.equal(merge([[hit("HudsonRock", "", "blackbird")]])[0].level, "high");
});

test("email hits from blackbird and holehe merge", () => {
	const [hh] = parseHolehe("[+] twitter.com");
	const [m, ...rest] = merge([[hit("Twitter", "", "blackbird")], hh]);
	assert.equal(rest.length, 0);
	assert.deepEqual(m.srcs, ["blackbird", "holehe"]);
	assert.equal(m.url, "https://twitter.com");
});

test("link flags hits that name another target", () => {
	const md5 = createHash("md5").update("alt@mail.com").digest("hex");
	const targets = ["main", "alt", "alt@mail.com"];
	const hits = [
		hit("Keybase", "", "maigret", { github_username: "Alt" }),
		hit("Trello", "", "maigret", { gravatar_email_md5_hash: md5 }),
		hit("Forum", "", "maigret", { bio: "alphabet main" }),
		hit("Site", "", "maigret", { bio: "see @alt." }),
	];
	link(hits, "main", targets);
	assert.deepEqual(
		hits.map((h) => h.meta.get("links to")),
		["alt", "alt@mail.com", undefined, "alt"],
	);
	assert.equal(merge([hits])[0].level, "high");
	const a = link([hit("Gravatar", "", "maigret", { hash: md5 })], "main", targets);
	const b = link([hit("Gravatar", "", "blackbird", { Name: "alt" })], "main", targets);
	assert.equal(merge([a, b])[0].meta.get("links to"), "alt, alt@mail.com");
});

test("fandom wikis fold into one account", () => {
	const hits = (
		[
			["Armchairgm", "https://armchairgm.fandom.com/wiki/User:eve"],
			["BleachFandom", "https://bleach.fandom.com/ru/wiki/%D0%A3:eve"],
			["FandomCommunityCentral", "https://community.fandom.com/wiki/User:eve"],
		] as const
	).map(([s, u]) => hit(...canon(s, u, "eve"), "maigret"));
	const [m, ...rest] = merge([hits]);
	assert.equal(rest.length, 0);
	assert.deepEqual([m.site, m.url], ["FandomCommunityCentral", "https://community.fandom.com/wiki/User:eve"]);
	using out = capture();
	live("eve", "BleachFandom", "https://bleach.fandom.com/ru/wiki/x");
	live("eve", "Armchairgm", "https://armchairgm.fandom.com/wiki/User:eve");
	assert.equal(out.out().split("✔").length - 1, 1);
	assert.match(out.out(), /FandomCommunityCentral {2}https:\/\/community\.fandom\.com\/wiki\/User:eve/);
});

test("live skips hits that only have a homepage or no link", () => {
	using out = capture();
	live("a@b.com", "adobe.com", "https://adobe.com");
	live("a@b.com", "Twitter");
	live("eve", "DeviantART", "https://eve.deviantart.com");
	live("eve", "Replit.com", "https://replit.com/@eve");
	live("eve", "Replit", "https://replit.com/@eve/");
	assert.equal(out.out().split("✔").length - 1, 2);
	assert.doesNotMatch(out.out(), /adobe|Twitter/);
});

test("intel pulls identity details together", () => {
	const hits = [
		hit("GitHub", "", "maigret", {
			fullname: "Robin",
			location: "MX",
			twitter_username: "robin_alt",
			bio: "hi\n there",
		}),
		hit("Keybase", "", "maigret", { Name: "robin", github_username: "Me", image: "x" }),
	];
	assert.deepEqual(intel(hits, "me"), {
		names: ["Robin"],
		locations: ["MX"],
		linked: ["robin_alt"],
		bios: ["hi there"],
	});
});

test("flat reads python list literals the way maigret writes them", () => {
	assert.equal(flat("['https://a.example', 'https://b.example']"), "https://a.example, https://b.example");
	assert.equal(flat("[]"), "");
	assert.equal(flat(["x", false, null, 0, "", "y"]), "x, y");
	assert.equal(flat("[not, a list"), "[not, a list");
	assert.equal(flat(null), "");
	assert.equal(flat(true), "True");
	assert.deepEqual(pyList(`["it's", 'a \\'b\\'', 1, True, None, ['n']]`), ["it's", "a 'b'", 1, true, null, ["n"]]);
	assert.equal(pyList("[1][0]"), undefined);
});

test("flat prints values the way python's str() does", () => {
	const cases: [unknown, string][] = [
		["[76561198012345679]", "76561198012345679"],
		["[['a', 'b'], 'c']", "['a', 'b'], c"],
		["[True, [None, False]]", "True, [None, False]"],
		["[1.0, 2.5]", "1.0, 2.5"],
		["[1e-07, 1e+16]", "1e-07, 1e+16"],
		["[1.5e3]", "1500.0"],
		["[01]", "[01]"],
		["['\\x4g']", "['\\x4g']"],
		[`["it's", 'q"']`, `it's, q"`],
	];
	for (const [input, want] of cases) assert.equal(flat(input), want, String(input));
	const json: [string, string][] = [
		["1234567890123456789", "1234567890123456789"],
		["5.0", "5.0"],
		["1e2", "100.0"],
		["{}", ""],
		['{"k": "v", "n": [1, 2.0]}', "{'k': 'v', 'n': [1, 2.0]}"],
		["[{}]", ""],
		["NaN", "nan"],
		['["a\\nb"]', "a\nb"],
	];
	for (const [input, want] of json) assert.equal(flat(parseJson(input)), want, input);
});

test("sorting follows code points like python", () => {
	const names = ["\u{1F600}", "～", "b", "B"];
	assert.deepEqual([...names].sort(cmp), ["B", "b", "～", "\u{1F600}"]);
});

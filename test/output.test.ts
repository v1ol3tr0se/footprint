import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hit } from "../src/core/hit.ts";
import { merge } from "../src/core/merge.ts";
import { fileName, identity, photos, render, reportName } from "../src/output/html.ts";
import { tempDir } from "./helpers.ts";

test("render escapes and marks unchecked sections", () => {
	const evil = '"><img src=x onerror=alert(1)>';
	const hits = merge([[hit(evil, "javascript:alert(1)", "maigret", { [evil]: evil })]]);
	using tmp = tempDir();
	const out = join(tmp.path, "r.html");
	const sections = [
		{ title: evil, kind: "username" as const, checked: ["maigret"], hits },
		{ title: "b", kind: "username" as const, checked: ["maigret"], hits: [] },
		{ title: "c", kind: "email" as const, checked: [], hits: [] },
	];
	assert.equal(render(evil, sections, out, [`data:image/png;base64,${evil}`]), 1);
	const page = readFileSync(out, "utf8");
	assert.doesNotMatch(page, /<img src=x|javascript:/);
	assert.match(page, /<p class="none">Nothing found<\/p>/);
	assert.match(page, /Not checked/);
	assert.doesNotMatch(page, /<ul><\/ul>|<ul class="hits"><p/);
	assert.match(page, /<b>0<\/b><span>high<\/span>.*<b>1<\/b><span>low<\/span>/);
	assert.match(page, /<b>1<\/b> hits across <b>3<\/b> targets<\/p><div class="counts">/);
	assert.doesNotMatch(page, /Not everything got checked|<nav|<time/);
});

test("the header lists names, then usernames, then emails, and email hits link the site", () => {
	const ranked = (...hits: Parameters<typeof hit>[]) => merge([hits.map((h) => hit(...h))]);
	const sections = [
		{
			title: "v1olet",
			kind: "username" as const,
			checked: ["maigret"],
			hits: ranked(
				["GitHub", "https://github.com/v1olet", "maigret", { fullname: "Eve", twitter_username: "@vi_alt" }],
				["YouTube", "https://youtube.com/@v1olet", "maigret", { fullname: "Violet", username: "V1olet" }],
			),
		},
		{
			title: "me@x.com",
			kind: "email" as const,
			checked: ["holehe"],
			hits: ranked([
				"spotify",
				"https://spotify.com",
				"holehe",
				{ "recovery email": "m****@g****.com", fullname: "eve" },
			]),
		},
	];
	assert.deepEqual(identity(sections), [
		["names", ["Eve", "Violet"]],
		["usernames", ["v1olet", "vi_alt"]],
		["emails", ["me@x.com"]],
	]);
	using tmp = tempDir();
	const out = join(tmp.path, "r.html");
	render("v1olet", sections, out);
	const page = readFileSync(out, "utf8");
	assert.match(
		page,
		/<dt>names<\/dt><dd><h1><span>Eve,<\/span> <span>Violet<\/span><\/h1>.*<dt>usernames<\/dt><dd><span>v1olet,<\/span> <span>vi_alt<\/span><\/dd>.*<dt>emails<\/dt><dd><span>me<wbr>@x\.com<\/span><\/dd>/,
	);
	assert.match(page, /<h3>spotify<\/h3>.*<a href="https:\/\/spotify.com"/);
	assert.match(page, /<div class="avatar" aria-hidden="true">E<\/div>/);
	assert.doesNotMatch(page, /id="photos"/);
});

test("identity puts the names, usernames and emails that show up most first", () => {
	const ranked = (...hits: Parameters<typeof hit>[]) => merge([hits.map((h) => hit(...h))]);
	const sections = [
		{
			title: "rose",
			kind: "username" as const,
			checked: ["maigret"],
			hits: ranked(
				["A", "https://a.example/rose", "maigret", { fullname: "Robin R" }],
				["B", "https://b.example/rose", "maigret", { fullname: "Robin", github_username: "rr" }],
				["C", "https://c.example/rose", "maigret", { name: "robin", twitter_username: "rr" }],
			),
		},
		{
			title: "r@x.com",
			kind: "email" as const,
			checked: ["holehe"],
			hits: ranked(["spotify", "https://spotify.com", "holehe", { email: "other@x.com" }]),
		},
		{
			title: "robin_b",
			kind: "username" as const,
			checked: ["maigret"],
			hits: ranked(["D", "https://d.example/robin_b", "maigret", {}]),
		},
	];
	assert.deepEqual(identity(sections), [
		["names", ["Robin", "Robin R"]],
		["usernames", ["rose", "rr", "robin_b"]],
		["emails", ["r@x.com", "other@x.com"]],
	]);
});

test("photos fetches each image once, one per hit showing it, highest risk first, and drops what isn't a small image", async () => {
	const img = (meta: Record<string, string>, tags: string[] = []) => hit("s", "", "maigret", meta, tags);
	const sections = [
		{
			title: "violet",
			kind: "username" as const,
			checked: ["maigret"],
			hits: merge([
				[
					img({ image: "https://a.example/low.png" }),
					img({ avatar_url: "https://a.example/svg", image_bg: "https://a.example/banner.png" }),
					img({ photo: "https://a.example/html" }),
					img({ picture: "https://a.example/huge" }),
					img({ thumbnail: "https://a.example/broken" }),
					img({ pfp: "not a url" }),
					img({ profile_image: "https://a.example/endless" }),
				].map((h, i) => ({ ...h, site: `site${i}` })),
				[{ ...img({ image: "https://a.example/high.jpg" }, ["porn"]), site: "zz" }],
				[{ ...img({ avatar: "https://a.example/low.png" }), site: "dup" }],
			]),
		},
	];
	const asked: string[] = [];
	const announced: number[] = [];
	let streamed = 0;
	let cancelled = false;
	const before = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		asked.push(url);
		const body = (type: string, bytes = 3, headers: Record<string, string> = {}) =>
			new Response(new Uint8Array(bytes), { headers: { "content-type": type, ...headers } });
		if (url.endsWith("broken")) throw new Error("offline");
		if (url.endsWith("svg")) return body("image/svg+xml");
		if (url.endsWith("html")) return body("text/html");
		if (url.endsWith("huge")) return body("image/png", 3, { "content-length": String(2 << 20) });
		if (url.endsWith("endless")) {
			const endless = new ReadableStream({
				pull: (c) => {
					streamed += 64 << 10;
					c.enqueue(new Uint8Array(64 << 10));
				},
				cancel: () => {
					cancelled = true;
				},
			});
			return new Response(endless, { headers: { "content-type": "image/png" } });
		}
		return body(url.endsWith(".jpg") ? "image/jpeg; charset=binary" : "image/png");
	};
	try {
		assert.deepEqual(await photos([], (n) => announced.push(n)), []);
		assert.deepEqual(await photos(sections, (n) => announced.push(n)), [
			"data:image/jpeg;base64,AAAA",
			"data:image/png;base64,AAAA",
			"data:image/png;base64,AAAA",
		]);
	} finally {
		globalThis.fetch = before;
	}
	assert.deepEqual(announced, [7]);
	assert.equal(asked[0], "https://a.example/high.jpg");
	assert.equal(asked.filter((u) => u.endsWith("low.png")).length, 1);
	assert.ok(!asked.some((u) => u.includes("banner") || u.includes("not a url")));
	assert.ok(cancelled && streamed <= (1 << 20) + (256 << 10), `read ${streamed} bytes of an endless body`);
	using tmp = tempDir();
	const out = join(tmp.path, "r.html");
	render("violet", sections, out, [
		"data:image/jpeg;base64,AAAA",
		"data:image/png;base64,AAAA",
		"data:image/png;base64,AAAA",
	]);
	assert.match(
		readFileSync(out, "utf8"),
		/<template id="photos"><img src="data:image\/jpeg;base64,AAAA" data-n="1" alt=""><img src="data:image\/png;base64,AAAA" data-n="2" alt=""><\/template>/,
	);
});

test("reports are named after the most found username", () => {
	const section = (title: string, kind: "username" | "email", ...hits: Record<string, string>[]) => ({
		title,
		kind,
		checked: ["maigret"],
		hits: merge([hits.map((meta, i) => hit(`site${i}`, "", "maigret", meta))]),
	});
	assert.equal(reportName([section("eve", "username", {})]), "eve");
	assert.equal(
		reportName([section("a", "username", {}), section("b", "username", {}, {}), section("me@x.com", "email")]),
		"b",
	);
	assert.equal(reportName([section("a", "username", {}), section("b", "username", {})]), "a");
	const mail = section(
		"me@x.com",
		"email",
		{ username: "@violet" },
		{ github_username: "violet" },
		{ username: "other" },
	);
	assert.equal(reportName([mail]), "violet");
	assert.equal(reportName([section("me@x.com", "email", { name: "Eve" })]), "me");
	assert.equal(fileName("eve"), "eve.html");
	assert.equal(fileName("../../etc/passwd"), "_.._etc_passwd.html");
	assert.equal(fileName("..."), "footprint.html");
});

test("every url in a hit's details is a link, and nothing else is", () => {
	using tmp = tempDir();
	const out = join(tmp.path, "r.html");
	const sections = [
		{
			title: "rose",
			kind: "username" as const,
			checked: ["maigret"],
			hits: merge([
				[
					hit("GitHub", "https://github.com/rose", "maigret", {
						image: "https://avatars.example/u/1?v=4",
						bio: "trains (see https://rose.example/blog). javascript:alert(1)",
					}),
				],
			]),
		},
	];
	render("rose", sections, out);
	const page = readFileSync(out, "utf8");
	assert.match(page, /<dd><a href="https:\/\/avatars\.example\/u\/1\?v=4" target="_blank" rel="noopener noreferrer">/);
	assert.match(
		page,
		/\(see <a href="https:\/\/rose\.example\/blog"[^>]*>https:\/\/rose\.example\/blog<\/a>\)\. javascript:alert\(1\)/,
	);
	assert.doesNotMatch(page, /href="javascript/);
});

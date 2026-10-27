import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hit } from "../src/core/hit.ts";
import { merge } from "../src/core/merge.ts";
import { fileName, render, reportName } from "../src/output/html.ts";
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
	assert.equal(render(evil, sections, [evil], out), 1);
	const page = readFileSync(out, "utf8");
	assert.doesNotMatch(page, /<img|javascript:/);
	assert.match(page, /<p class="none">nothing found<\/p>/);
	assert.match(page, /not checked/);
	assert.doesNotMatch(page, /<ul><\/ul>|<ul class="hits"><p/);
	assert.match(page, /1 hits · 0 high · 0 medium · 1 low/);
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

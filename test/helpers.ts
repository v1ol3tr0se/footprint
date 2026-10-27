import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { io, shown } from "../src/output/terminal.ts";

globalThis.fetch = async () => {
	throw new Error("tests stay offline");
};

const FIXTURES = join(import.meta.dirname, "fixtures");
const PYTHON = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();

export function tempDir() {
	const path = mkdtempSync(join(tmpdir(), "footprint-test-"));
	return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

export function capture() {
	const before = { ...io };
	const out: string[] = [];
	const err: string[] = [];
	io.out = (s) => {
		out.push(s);
	};
	io.err = (s) => {
		err.push(s);
	};
	return {
		out: () => out.join(""),
		err: () => err.join(""),
		[Symbol.dispose]: () => {
			Object.assign(io, before);
			shown.clear();
		},
	};
}

export function path(dirs: string, { replace = false } = {}) {
	const before = process.env.PATH;
	process.env.PATH = replace ? dirs : `${dirs}${delimiter}${before}`;
	return {
		[Symbol.dispose]: () => {
			process.env.PATH = before;
		},
	};
}

export function fakeBin(dir: string, ...tools: string[]) {
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	for (const t of tools) symlinkSync(join(FIXTURES, "fake-checker.py"), join(bin, t));
	return bin;
}

export function fakeBlackbird(dir: string) {
	copyFileSync(join(FIXTURES, "fake-blackbird.py"), join(dir, "blackbird.py"));
	mkdirSync(join(dir, ".venv/bin"), { recursive: true });
	symlinkSync(PYTHON, join(dir, ".venv/bin/python"));
	mkdirSync(join(dir, "data"));
	const sites = [
		{
			name: "GitHub (User)",
			uri_check: "https://api.github.com/users/{account}",
			uri_pretty: "https://github.com/{account}",
			e_code: 200,
			m_code: 404,
		},
		{ name: "Down", uri_check: "https://down.example/{account}", e_code: 200, m_code: 404 },
		{ name: "Walled", uri_check: "https://walled.example/{account}", e_code: 200, m_code: 404 },
		{ name: "Limited", uri_check: "https://limited.example/{account}", e_code: 200, m_code: 404 },
		{ name: "Moved", uri_check: "https://moved.example/{account}", e_code: 200, m_code: 302 },
	];
	writeFileSync(join(dir, "data/wmn-data.json"), JSON.stringify({ sites }));
	const mail = [
		{
			name: "Gravatar",
			uri_check: "https://gravatar.example/{account}.json",
			e_code: 200,
			m_code: 404,
			input_operation: "hash-sha256",
		},
	];
	writeFileSync(join(dir, "data/email-data.json"), JSON.stringify({ sites: mail }));
	return dir;
}

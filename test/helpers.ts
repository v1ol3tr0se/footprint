import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { io, shown } from "../src/output/terminal.ts";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const PYTHON = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();

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
	const sites = [{ name: "GitHub (User)", uri_pretty: "https://github.com/{account}" }];
	writeFileSync(join(dir, "data/wmn-data.json"), JSON.stringify({ sites }));
	return dir;
}

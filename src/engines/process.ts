import { spawn } from "node:child_process";
import { accessSync, constants as fs, statSync } from "node:fs";
import { constants } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { getSystemErrorMessage } from "node:util";
import { cut } from "../core/text.ts";

let stopper = new AbortController();

/** Set when ctrl-c lands or a tool dies from a signal, so nothing new starts and retries give up. */
export const STOP = {
	set: () => stopper.abort(),
	clear: () => {
		stopper = new AbortController();
	},
	isSet: () => stopper.signal.aborted,
	wait: (ms: number) => sleep(ms, false, { signal: stopper.signal }).catch(() => true),
};

export function strerror(e: unknown) {
	const err = e as NodeJS.ErrnoException | undefined;
	return typeof err?.errno === "number" ? getSystemErrorMessage(err.errno) : String(err?.message ?? e);
}

export function isFile(path: string) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function which(cmd: string) {
	const dirs = (process.env.PATH ?? "/bin:/usr/bin").split(delimiter).filter(Boolean);
	return dirs.some((dir) => {
		const f = join(dir, cmd);
		try {
			accessSync(f, fs.X_OK);
		} catch {
			return false;
		}
		return isFile(f);
	});
}

export type Result = [out: string, problem: string | null];
export type RunOptions = { onLine?: (line: string) => void; limit?: number; cwd?: string };
type End = { code: number } | { error: Error };

/** Run one tool, handing each stdout line to onLine as it arrives; resolves to [stdout, problem or null]. */
export async function run(tool: string, argv: string[], { onLine, limit, cwd }: RunOptions = {}): Promise<Result> {
	if (STOP.isSet()) return ["", `${tool} skipped, the run was stopped`];
	let p: ReturnType<typeof spawn>;
	try {
		p = spawn(argv[0], argv.slice(1), {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PYTHONUNBUFFERED: "1", COLUMNS: "1000" },
		});
	} catch (e) {
		return ["", `${tool} didn't start: ${strerror(e)}`];
	}
	const ended = new Promise<End>((resolve) => {
		p.once("error", (error) => resolve({ error }));
		p.once("close", (code, signal) => resolve({ code: signal ? -constants.signals[signal] : (code ?? 0) }));
	});
	const lines: string[] = [];
	const err: string[] = [];
	let failure: unknown;
	createInterface({ input: p.stdout as NodeJS.ReadableStream }).on("line", (ln) => {
		lines.push(ln);
		try {
			onLine?.(ln);
		} catch (e) {
			failure ??= e;
		}
	});
	createInterface({ input: p.stderr as NodeJS.ReadableStream }).on("line", (ln) => err.push(ln));
	let killed = false;
	const timer =
		limit &&
		setTimeout(() => {
			killed = true;
			p.kill("SIGKILL");
		}, limit * 1000);
	const end = await ended;
	clearTimeout(timer || undefined);
	if ("error" in end) return ["", `${tool} didn't start: ${strerror(end.error)}`];
	if (failure) throw failure;
	const out = lines.map((ln) => `${ln}\n`).join("");
	if (limit && killed && end.code === -9 && !STOP.isSet()) {
		return [out, `${tool} took longer than ${Math.floor(limit / 60)} min, stopped it, some sites weren't checked`];
	}
	if (end.code < 0) STOP.set();
	if (end.code) {
		const last = err.map((ln) => ln.trim()).findLast(Boolean) ?? "";
		return [out, `${tool} exited with ${end.code}${last ? `: ${cut(last, 200)}` : ""}`];
	}
	return [out, null];
}

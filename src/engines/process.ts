import { spawn } from "node:child_process";
import { accessSync, constants as fs, statSync } from "node:fs";
import { constants } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { getSystemErrorMessage } from "node:util";
import { cut } from "../core/text.ts";

let stopper = new AbortController();
const GRACE_MS = 5000;
const PIPE_DRAIN_MS = 500;

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

type Result = [out: string, problem: string | null];
type RunOptions = { onLine?: (line: string) => void; idle?: number; limit?: number; cwd?: string };
type End = { code: number } | { error: Error };

/** Run one tool, handing each stdout line to onLine as it arrives; resolves to [stdout, problem or null]. It's only killed after `idle` seconds with no output or `limit` seconds in all, or a few seconds after the run is stopped if it hasn't quit on its own by then. */
export async function run(
	tool: string,
	argv: string[],
	{ onLine, idle, limit, cwd }: RunOptions = {},
): Promise<Result> {
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
	p.once("exit", () => {
		setTimeout(() => {
			p.stdout?.destroy();
			p.stderr?.destroy();
		}, PIPE_DRAIN_MS).unref();
	});
	const ended = new Promise<End>((resolve) => {
		p.once("error", (error) => resolve({ error }));
		p.once("close", (code, signal) => resolve({ code: signal ? -constants.signals[signal] : (code ?? 0) }));
	});
	const lines: string[] = [];
	const err: string[] = [];
	let failure: unknown;
	let killed = false;
	const timer =
		idle &&
		setTimeout(() => {
			killed = true;
			p.kill("SIGKILL");
		}, idle * 1000);
	let late = false;
	const cap =
		limit &&
		setTimeout(() => {
			late = true;
			p.kill("SIGKILL");
		}, limit * 1000);
	const stopped = stopper.signal;
	let grace: NodeJS.Timeout | undefined;
	const onStop = () => {
		grace = setTimeout(() => p.kill("SIGKILL"), GRACE_MS);
	};
	stopped.addEventListener("abort", onStop, { once: true });
	createInterface({ input: p.stdout as NodeJS.ReadableStream }).on("line", (ln) => {
		if (timer) timer.refresh();
		lines.push(ln);
		try {
			onLine?.(ln);
		} catch (e) {
			failure ??= e;
		}
	});
	createInterface({ input: p.stderr as NodeJS.ReadableStream }).on("line", (ln) => err.push(ln));
	const end = await ended;
	clearTimeout(timer || undefined);
	clearTimeout(grace);
	clearTimeout(cap || undefined);
	stopped.removeEventListener("abort", onStop);
	if ("error" in end) return ["", `${tool} didn't start: ${strerror(end.error)}`];
	if (failure) throw failure;
	const out = lines.map((ln) => `${ln}\n`).join("");
	if (late && end.code === -9 && !STOP.isSet()) return [out, `${tool} took over ${limit} s, stopped it`];
	if (idle && killed && end.code === -9 && !STOP.isSet()) {
		return [out, `${tool} went quiet for ${Math.floor(idle / 60)} min, stopped it, some sites weren't checked`];
	}
	if (end.code < 0) STOP.set();
	if (end.code) {
		const last = err.map((ln) => ln.trim()).findLast(Boolean) ?? "";
		return [out, `${tool} exited with ${end.code}${last ? `: ${cut(last, 200)}` : ""}`];
	}
	return [out, null];
}

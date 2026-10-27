import { createInterface, type Interface } from "node:readline";
import { io, paint } from "../output/terminal.ts";

export type Ask = (label: string) => Promise<string>;

let rl: Interface | undefined;
let lines: AsyncIterator<string> | undefined;

/** Ask one question on stdin; a closed stdin quits with 130, the same as ctrl-c. */
export const ask: Ask = async (label) => {
	io.out(`  ${label} ${paint("32", "›")} `);
	rl ??= createInterface({ input: process.stdin, terminal: false });
	lines ??= rl[Symbol.asyncIterator]();
	const quit = () => {
		io.out("\n");
		process.exit(130);
	};
	process.once("SIGINT", quit);
	const { value, done } = await lines.next();
	process.off("SIGINT", quit);
	if (done) {
		io.out("\n");
		process.exit(130);
	}
	return value.trim();
};

export function doneAsking() {
	rl?.close();
	rl = undefined;
	lines = undefined;
}

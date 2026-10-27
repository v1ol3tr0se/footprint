import type { Found, Kind } from "../core/types.ts";
import { blackbird } from "./blackbird.ts";
import { holehe } from "./holehe.ts";
import { maigret } from "./maigret.ts";
import { sherlock } from "./sherlock.ts";

export type Scan = { users: string[]; emails: string[]; noNsfw: boolean; blackbirdHome: string; tmp: string };
export type Outcome = [found: Found, notes: string[]];
type Plan = { run?: () => Promise<Outcome>; note?: string };

export type Engine = {
	name: string;
	covers: readonly Kind[];
	plan: (scan: Scan) => Plan;
};

export const ENGINES: readonly Engine[] = [maigret, sherlock, blackbird, holehe];

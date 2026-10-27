import { key } from "./hit.ts";
import { alnum } from "./text.ts";
import type { Hit, Level } from "./types.ts";

type Verdict = [Level, string];

const DONATION: Verdict = ["high", "public donation page tied to the handle"];
const PAYMENT: Verdict = ["high", "payment handle, often shows a real name"];
const UNKNOWN: Verdict = ["low", "account found, ownership not confirmed"];

const DONATION_SITES = [
	"buymeacoffee",
	"liberapay",
	"opencollective",
	"donationalerts",
	"tipeeestream",
	"boosty",
	"cafecito",
	"donatello",
	"patronite",
	"utip",
];

const RULES: [string, Verdict][] = [
	["paypal", ["high", "payment page, can expose a legal name"]],
	["kofi", DONATION],
	...DONATION_SITES.map((k): [string, Verdict] => [k, DONATION]),
	["patreon", ["high", "public page, may carry a real name"]],
	["venmo", PAYMENT],
	["cashapp", PAYMENT],
	["revolut", PAYMENT],
	["gravatar", ["high", "public profile with name and avatar tied to the email"]],
	["pronouns.page", ["high", "can list real names and pronouns"]],
	["streamelements", ["high", "exposes the linked streaming account and avatar"]],
	["hudsonrock", ["high", "handle appears in infostealer logs, may belong to someone else with the same name"]],
	["instagram", ["medium", "social profile, may show photos, followers and a real name"]],
	["twitter", ["medium", "account tied to the handle or email"]],
	["facebook", ["medium", "account tied to the handle"]],
	["tiktok", ["medium", "social profile, may show videos and a display name"]],
	["streamlabs", ["medium", "donation account"]],
	["pinterest", ["medium", "check which boards are public"]],
	["youtube", ["medium", "a renamed channel keeps the old handle as a redirect"]],
	["github", ["low", "known account"]],
	["gitlab", ["low", "known account"]],
	["roblox", ["low", "name-taken check only, may belong to someone else"]],
];

const RISK = RULES.map(([word, verdict]): [RegExp, Verdict] => [
	new RegExp(`(?<![\\p{L}\\p{N}_])${word.replaceAll(".", "\\.")}(?![\\p{L}\\p{N}_])`, "u"),
	verdict,
]);

export const NSFW = new Set(["xx nsfw xx", "porn", "erotic", "webcam"]);
export const NSFW_SITES = new Set(["fansly", "onlyfans"]);

const LEAKS = new Set([
	"name",
	"fullname",
	"displayname",
	"firstname",
	"lastname",
	"realname",
	"avatar",
	"image",
	"photo",
	"picture",
	"thumbnail",
	"profileimage",
	"phone",
	"recoveryemail",
	"email",
	"emails",
	"businessemail",
	"contacts",
	"address",
	"skype",
]);

export const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
export const LEVELS = Object.keys(RANK) as Level[];

/** Return [level, advice] for a hit, bumping low ones that leak a name, face or contact. */
export function risk(h: Hit): Verdict {
	if (h.meta.get("links to")) return ["high", "names another target in this report, so the two are publicly linked"];
	if ([...h.tags].some((t) => NSFW.has(t) || t === "dating")) {
		return ["high", "adult or dating site, may belong to someone else with the same name"];
	}
	if (h.tags.has("fintech")) return PAYMENT;
	const name = `${h.site.toLowerCase()} ${key(h.site)}`;
	const [level, advice] = RISK.find(([re]) => re.test(name))?.[1] ?? UNKNOWN;
	if (level === "low" && [...h.meta.keys()].some((k) => LEAKS.has(alnum(k)))) {
		return ["medium", "shows a name, avatar or contact detail"];
	}
	return [level, advice];
}

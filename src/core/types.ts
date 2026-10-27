export type Level = "high" | "medium" | "low";
export type Kind = "username" | "email";

export type Hit = { site: string; url: string; src: string; meta: Map<string, string>; tags: Set<string> };
export type Ranked = Hit & { srcs: string[]; level: Level; advice: string };
export type Found = Map<string, Hit[]>;
export type Section = { title: string; kind: Kind; checked: string[]; hits: Ranked[] };

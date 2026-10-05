/**
 * Fly-language text generator and width-preserving line masker.
 * Pure module: no runtime imports.
 */

export const ACTIONS: readonly string[] = [
	"*hums*",
	"*buzz*",
	"*zoom*",
	"*buzzes*",
	"*rubs hands*",
	"*rubs front legs together*",
	"*lands on screen*",
	"*cleans eyes*",
	"*circles the lamp*",
	"*bonks into window*",
	"*tastes with feet*",
	"*hovers menacingly*",
	"*zooms off*",
	"*lands on your sandwich*",
	"*grooms wings*",
	"*dodges swatter*",
	"*crawls up wall*",
	"*does a loop*",
];

const NOISE_LENGTHS = [4, 4, 4, 5, 3, 6, 2];
const ACTION_CHANCE = 0.25;
const CACHE_LIMIT = 10_000;

/** 32-bit FNV-1a over UTF-16 code units. */
export function fnv1a32(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/** Standard mulberry32 PRNG; returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function noise(length: number): string {
	if (length <= 1) return "z";
	if (length === 2) return "bz";
	return `b${"z".repeat(length - 2)}t`;
}

/** Deterministic fly text of exactly `width` ASCII chars. */
export function flyFill(width: number, seed: number): string {
	if (width <= 0) return "";
	const rand = mulberry32(seed);
	const parts: string[] = [];
	let remaining = width;
	while (remaining > 0) {
		const sep = parts.length > 0 ? 1 : 0;
		const avail = remaining - sep;
		const action = ACTIONS[Math.floor(rand() * ACTIONS.length)]!;
		const rest = avail - action.length;
		let token: string;
		if (rand() < ACTION_CHANCE && (rest === 0 || rest >= 2)) {
			token = action;
		} else {
			let len = Math.min(avail, NOISE_LENGTHS[Math.floor(rand() * NOISE_LENGTHS.length)]!);
			if (avail - len === 1) len = avail;
			token = noise(len);
		}
		parts.push(token);
		remaining -= sep + token.length;
	}
	return parts.join(" ");
}

export interface MaskDeps {
	widthOf(text: string): number;
	isRawLine(line: string): boolean;
}

const ESCAPE_RE =
	/\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|_[\s\S]*?(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\|[@-Z\\-_])/y;
const HAS_ALNUM_RE = /[\p{L}\p{N}]/u;
const WORD_START_RE = /[\p{L}\p{N}\p{M}_'’]/u;
const UPPER_START_RE = /^\p{Lu}/u;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type Item = { esc: true; text: string } | { esc: false; text: string; cls: "word" | "space" | "other" };

function classify(grapheme: string): "word" | "space" | "other" {
	if (grapheme === " ") return "space";
	const first = String.fromCodePoint(grapheme.codePointAt(0)!);
	return WORD_START_RE.test(first) ? "word" : "other";
}

function tokenize(line: string): Item[] {
	const items: Item[] = [];
	const len = line.length;
	let i = 0;
	while (i < len) {
		const code = line.charCodeAt(i);
		if (code === 0x1b) {
			ESCAPE_RE.lastIndex = i;
			const m = ESCAPE_RE.exec(line);
			const text = m ? m[0] : "\x1b";
			items.push({ esc: true, text });
			i += text.length;
		} else if (code < 0x20) {
			items.push({ esc: false, text: line[i]!, cls: "other" });
			i++;
		} else {
			let j = i + 1;
			while (j < len && line.charCodeAt(j) >= 0x20) j++;
			for (const { segment } of SEGMENTER.segment(line.slice(i, j))) {
				items.push({ esc: false, text: segment, cls: classify(segment) });
			}
			i = j;
		}
	}
	return items;
}

function maskTokens(items: Item[], deps: MaskDeps): string {
	// Visible (non-escape) item indices, in order.
	const visible: number[] = [];
	for (let k = 0; k < items.length; k++) if (!items[k]!.esc) visible.push(k);

	const inRun = new Array<boolean>(items.length).fill(false);
	for (let v = 0; v < visible.length; v++) {
		const item = items[visible[v]!] as Extract<Item, { esc: false }>;
		if (item.cls === "word") {
			inRun[visible[v]!] = true;
		} else if (item.cls === "space" && v > 0 && v < visible.length - 1) {
			const prev = items[visible[v - 1]!] as Extract<Item, { esc: false }>;
			const next = items[visible[v + 1]!] as Extract<Item, { esc: false }>;
			if (prev.cls === "word" && next.cls === "word") inRun[visible[v]!] = true;
		}
	}

	let out = "";
	let v = 0;
	let k = 0;
	while (k < items.length) {
		const item = items[k]!;
		if (item.esc || !inRun[k]) {
			out += item.text;
			k++;
			if (!item.esc) v++;
			continue;
		}
		// Collect the run: consecutive visible in-run items, escapes interleaved.
		const runIdx: number[] = [];
		let end = k;
		let nextV = v;
		while (nextV < visible.length && inRun[visible[nextV]!]) {
			runIdx.push(visible[nextV]!);
			end = visible[nextV]! + 1;
			nextV++;
		}
		let plain = "";
		let total = 0;
		const widths: number[] = [];
		for (const idx of runIdx) {
			const text = items[idx]!.text;
			const w = deps.widthOf(text);
			plain += text;
			total += w;
			widths.push(w);
		}
		let fly = flyFill(total, fnv1a32(plain));
		if (fly.length > 0 && UPPER_START_RE.test(items[runIdx[0]!]!.text)) {
			fly = fly[0]!.toUpperCase() + fly.slice(1);
		}
		let pos = 0;
		let r = 0;
		for (let m = k; m < end; m++) {
			const it = items[m]!;
			if (it.esc) {
				out += it.text;
			} else {
				const w = widths[r++]!;
				out += fly.slice(pos, pos + w);
				pos += w;
			}
		}
		k = end;
		v = nextV;
	}
	return out;
}

/**
 * Build a pure, width-preserving line masker. Escapes, punctuation, frames and
 * indentation survive; letter/number runs are replaced with fly text.
 */
export function createLineMasker(deps: MaskDeps): (line: string) => string {
	const cache = new Map<string, string>();
	return (line: string): string => {
		if (deps.isRawLine(line)) return line;
		if (!HAS_ALNUM_RE.test(line)) return line;
		const hit = cache.get(line);
		if (hit !== undefined) return hit;
		const masked = maskTokens(tokenize(line), deps);
		if (cache.size >= CACHE_LIMIT) cache.clear();
		cache.set(line, masked);
		return masked;
	};
}

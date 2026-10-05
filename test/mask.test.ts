import { describe, expect, test } from "bun:test";
import { createLineMasker, flyFill } from "../src/mask.ts";

const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const MARK_RE = /\p{M}/u;

function widthOf(text: string): number {
	let width = 0;
	for (const ch of text) {
		if (WIDE_RE.test(ch)) width += 2;
		else if (MARK_RE.test(ch)) width += 0;
		else width += 1;
	}
	return width;
}

function strip(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b_[\s\S]*?\x07/g, "");
}

const mask = createLineMasker({ widthOf, isRawLine: l => l.startsWith("RAW") });

describe("flyFill", () => {
	test("exact width, charset, spacing, determinism", () => {
		for (let w = 1; w <= 80; w++) {
			for (let s = 0; s <= 20; s++) {
				const out = flyFill(w, s);
				expect(out.length).toBe(w);
				expect(out).toMatch(/^[a-z* ]+$/);
				expect(out.startsWith(" ")).toBe(false);
				expect(out.endsWith(" ")).toBe(false);
				expect(out.includes("  ")).toBe(false);
				expect(flyFill(w, s)).toBe(out);
			}
		}
	});

	test("zero width yields empty string", () => {
		expect(flyFill(0, 1)).toBe("");
	});

	test("actions appear", () => {
		let found = false;
		for (let w = 30; w <= 80 && !found; w++) {
			for (let s = 0; s <= 20; s++) {
				if (flyFill(w, s).includes("*")) {
					found = true;
					break;
				}
			}
		}
		expect(found).toBe(true);
	});
});

describe("createLineMasker", () => {
	test("plain sentence keeps width and punctuation", () => {
		const input = "Hello world, this is a test.";
		const out = mask(input);
		expect(out.length).toBe(input.length);
		expect(out[11]).toBe(",");
		expect(out[out.length - 1]).toBe(".");
		expect(out).not.toContain("Hello");
		expect(out).toMatch(/^[BZ*]/);
	});

	test("ANSI and OSC 8 escapes survive in order", () => {
		const input = "\x1b[1mbold\x1b[22m plain \x1b]8;;https://x.y\x1b\\link\x1b]8;;\x1b\\";
		const out = mask(input);
		const escapeRe = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
		expect(out.match(escapeRe)).toEqual(input.match(escapeRe));
		expect(widthOf(strip(out))).toBe(widthOf(strip(input)));
		const visible = strip(out);
		expect(visible).not.toContain("bold");
		expect(visible).not.toContain("plain");
		expect(visible).not.toContain("link");
	});

	test("frames, symbols and raw lines are unchanged", () => {
		expect(mask("│ ─── ● ✓ │")).toBe("│ ─── ● ✓ │");
		expect(mask("RAW hello")).toBe("RAW hello");
	});

	test("wide characters keep width; indentation preserved", () => {
		const wide = "你好 world";
		expect(widthOf(mask(wide))).toBe(widthOf(wide));
		expect(mask("    indented code").startsWith("    ")).toBe(true);
	});

	test("pure function of the line", () => {
		const input = "Some \x1b[31mred\x1b[0m text, again.";
		expect(mask(input)).toBe(mask(input));
		const fresh = createLineMasker({ widthOf, isRawLine: l => l.startsWith("RAW") });
		expect(fresh(input)).toBe(mask(input));
	});
});

import { describe, expect, test } from "bun:test";
import type { Component } from "@oh-my-pi/pi-tui";
import { createRegistry, installTranscriptPatch, maskRows, wrapTranscriptChild } from "../src/wrap.ts";

type Fake = Component & {
	renderTranscriptStableRows?(count: number, width: number): readonly string[];
	renderTranscriptBlockEmergencyRow?(width: number): string | undefined;
};

function enabledRegistry() {
	const registry = createRegistry();
	registry.maskLine = s => `${s}!`;
	registry.enabled = true;
	return registry;
}

function staticComponent(rows: readonly string[]): Fake {
	return { render: () => rows, invalidate() {} } as unknown as Fake;
}

describe("maskRows / wrapTranscriptChild", () => {
	test("disabled: render returns the inner array reference itself", () => {
		const registry = createRegistry();
		registry.maskLine = s => `${s}!`;
		const inner = ["a", "b"];
		const component = staticComponent(inner);
		wrapTranscriptChild(component, registry);
		expect(component.render(80)).toBe(inner);
	});

	test("enabled: masks once, caches by reference, epoch bump invalidates", () => {
		const registry = enabledRegistry();
		const inner = ["a", "b"];
		const component = staticComponent(inner);
		wrapTranscriptChild(component, registry);
		const first = component.render(80);
		expect(first).toEqual(["a!", "b!"]);
		expect(component.render(80)).toBe(first);
		registry.epoch++;
		const second = component.render(80);
		expect(second).not.toBe(first);
		expect(second).toEqual(["a!", "b!"]);
	});

	test("maskRows returns empty input unchanged", () => {
		const registry = enabledRegistry();
		const empty: string[] = [];
		expect(maskRows(empty, registry)).toBe(empty);
	});

	test("renderTranscriptStableRows: unmasked inside render, masked outside", () => {
		const registry = enabledRegistry();
		const stable = ["s1", "s2"];
		let innerSeen: readonly string[] | undefined;
		const component = {
			invalidate() {},
			render(this: Fake) {
				innerSeen = this.renderTranscriptStableRows!(2, 80);
				return ["r"];
			},
			renderTranscriptStableRows() {
				return stable;
			},
		} as unknown as Fake;
		wrapTranscriptChild(component, registry);
		expect(component.render(80)).toEqual(["r!"]);
		expect(innerSeen).toBe(stable);
		expect(component.renderTranscriptStableRows!(2, 80)).toEqual(["s1!", "s2!"]);
	});

	test("renderTranscriptBlockEmergencyRow masks rows, passes undefined, respects disabled", () => {
		const registry = enabledRegistry();
		let row: string | undefined = "row";
		const component = {
			render: () => ["x"],
			invalidate() {},
			renderTranscriptBlockEmergencyRow: () => row,
		} as unknown as Fake;
		wrapTranscriptChild(component, registry);
		expect(component.renderTranscriptBlockEmergencyRow!(80)).toBe("row!");
		row = undefined;
		expect(component.renderTranscriptBlockEmergencyRow!(80)).toBeUndefined();
		row = "row";
		registry.enabled = false;
		expect(component.renderTranscriptBlockEmergencyRow!(80)).toBe("row");
	});

	test("excluded component keeps its original render function", () => {
		const registry = enabledRegistry();
		const component = staticComponent(["a"]);
		const original = component.render;
		registry.isExcluded = c => c === component;
		wrapTranscriptChild(component, registry);
		expect(component.render).toBe(original);
		expect(component.render(80)).toEqual(["a"]);
	});

	test("wrapping twice masks only once", () => {
		const registry = enabledRegistry();
		const component = staticComponent(["a"]);
		wrapTranscriptChild(component, registry);
		wrapTranscriptChild(component, registry);
		expect(component.render(80)).toEqual(["a!"]);
	});
});

describe("installTranscriptPatch", () => {
	test("installing twice wraps the child once and calls original addChild once per add", () => {
		const registry = enabledRegistry();
		const added: Component[] = [];
		const proto = {
			addChild(component: Component) {
				added.push(component);
			},
		};
		installTranscriptPatch(proto, registry);
		installTranscriptPatch(proto, registry);
		const component = staticComponent(["a"]);
		proto.addChild(component);
		expect(added).toEqual([component]);
		expect(component.render(80)).toEqual(["a!"]);
	});
});

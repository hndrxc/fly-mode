import type { Component } from "@oh-my-pi/pi-tui";

export interface FlyRegistry {
	enabled: boolean;
	/** Bumped on every enabled change; invalidates the masked-array cache. */
	epoch: number;
	/** State file read once per process. */
	loaded: boolean;
	maskLine: (line: string) => string;
	isExcluded: (component: object) => boolean;
	wrapped: WeakSet<object>;
	masked: WeakMap<readonly string[], { epoch: number; rows: readonly string[] }>;
}

type AppendOnlyComponent = Component & {
	renderTranscriptStableRows?(count: number, width: number): readonly string[];
	renderTranscriptBlockEmergencyRow?(width: number): string | undefined;
};

const REGISTRY_KEY = Symbol.for("omp-flymode.registry");
const PATCHED_KEY = Symbol.for("omp-flymode.addChildPatched");

export function createRegistry(): FlyRegistry {
	return {
		enabled: false,
		epoch: 0,
		loaded: false,
		maskLine: line => line,
		isExcluded: () => false,
		wrapped: new WeakSet(),
		masked: new WeakMap(),
	};
}

/** Process-wide singleton: shared with subagent sessions and surviving `/reload`. */
export function getRegistry(): FlyRegistry {
	const holder = globalThis as unknown as Record<symbol, FlyRegistry | undefined>;
	let registry = holder[REGISTRY_KEY];
	if (!registry) {
		registry = createRegistry();
		holder[REGISTRY_KEY] = registry;
	}
	return registry;
}

/**
 * Mask rows, returning the same reference for the same input array while the
 * epoch is unchanged (containers memoize child output by array identity).
 */
export function maskRows(rows: readonly string[], registry: FlyRegistry): readonly string[] {
	if (!registry.enabled || rows.length === 0) return rows;
	const cached = registry.masked.get(rows);
	if (cached && cached.epoch === registry.epoch) return cached.rows;
	const masked = rows.map(registry.maskLine);
	registry.masked.set(rows, { epoch: registry.epoch, rows: masked });
	return masked;
}

export function wrapTranscriptChild(component: Component, registry: FlyRegistry): void {
	if (registry.wrapped.has(component) || registry.isExcluded(component)) return;
	registry.wrapped.add(component);

	const target = component as AppendOnlyComponent;
	let innerDepth = 0;

	const originalRender = target.render;
	target.render = function (this: unknown, width: number): readonly string[] {
		innerDepth++;
		let result: readonly string[];
		try {
			result = originalRender.call(this, width);
		} finally {
			innerDepth--;
		}
		return maskRows(result, registry);
	};

	const originalStable = target.renderTranscriptStableRows;
	if (typeof originalStable === "function") {
		target.renderTranscriptStableRows = function (this: unknown, count: number, width: number): readonly string[] {
			const rows = originalStable.call(this, count, width);
			// Calls made from inside render() compare against unmasked rows.
			return innerDepth > 0 ? rows : maskRows(rows, registry);
		};
	}

	const originalEmergency = target.renderTranscriptBlockEmergencyRow;
	if (typeof originalEmergency === "function") {
		target.renderTranscriptBlockEmergencyRow = function (this: unknown, width: number): string | undefined {
			const row = originalEmergency.call(this, width);
			if (row === undefined || !registry.enabled) return row;
			return registry.maskLine(row);
		};
	}
}

export function installTranscriptPatch(
	proto: { addChild(component: Component): void },
	registry: FlyRegistry,
): void {
	const guarded = proto as unknown as Record<symbol, unknown>;
	if (guarded[PATCHED_KEY]) return;
	const original = proto.addChild;
	proto.addChild = function (this: unknown, component: Component): void {
		wrapTranscriptChild(component, registry);
		return original.call(this, component);
	};
	guarded[PATCHED_KEY] = true;
}

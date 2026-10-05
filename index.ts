import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isOsc66Line, TERMINAL, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome";
import * as fs from "node:fs";
import * as path from "node:path";
import { createLineMasker } from "./src/mask.ts";
import { getRegistry, installTranscriptPatch, wrapTranscriptChild } from "./src/wrap.ts";

const STATUS_KEY = "flymode";
const STATUS_TEXT = "fly mode: bzzt";

function loadEnabled(file: string): boolean {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")).enabled === true;
	} catch {
		return false;
	}
}

export default function flymode(pi: ExtensionAPI): void {
	const registry = getRegistry();
	registry.maskLine = createLineMasker({
		widthOf: visibleWidth,
		isRawLine: line => TERMINAL.isImageLine(line) || isOsc66Line(line),
	});
	registry.isExcluded = c =>
		c instanceof pi.pi.UserMessageComponent || c instanceof pi.pi.CollapsedSyntheticMessageComponent;
	installTranscriptPatch(TranscriptContainer.prototype, registry);

	const stateFile = path.join(pi.pi.getAgentDir(), "flymode.json");
	if (!registry.loaded) {
		registry.enabled = loadEnabled(stateFile);
		registry.loaded = true;
	}

	let tui: TUI | undefined;

	function captureTui(ctx: ExtensionContext): void {
		if (tui || ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return;
		ctx.ui.setWidget("flymode-probe", t => {
			tui = t;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget("flymode-probe", undefined);
	}

	function wrapExisting(): TranscriptContainer[] {
		const transcripts: TranscriptContainer[] = [];
		for (const child of tui?.children ?? []) {
			if (!(child instanceof TranscriptContainer)) continue;
			transcripts.push(child);
			for (const block of child.children) wrapTranscriptChild(block, registry);
		}
		return transcripts;
	}

	function repaint(): void {
		if (!tui) return;
		for (const transcript of wrapExisting()) transcript.resetStableEmission();
		tui.resetDisplay();
	}

	function setEnabled(next: boolean, ctx: ExtensionContext): void {
		captureTui(ctx);
		if (registry.enabled !== next) {
			registry.enabled = next;
			registry.epoch++;
		}
		try {
			fs.writeFileSync(stateFile, `${JSON.stringify({ enabled: next })}\n`);
		} catch (err) {
			ctx.ui.notify(
				`flymode: could not save state to ${stateFile}: ${err instanceof Error ? err.message : String(err)}`,
				"warning",
			);
		}
		ctx.ui.setStatus(STATUS_KEY, next ? STATUS_TEXT : undefined);
		repaint();
		ctx.ui.notify(next ? "Fly mode on. bzzt bzzt *rubs hands*" : "Fly mode off.", "info");
	}

	pi.registerCommand("flymode", {
		description: "Mask agent output with fly language (display only): /flymode [on|off]",
		getArgumentCompletions: prefix =>
			["on", "off"].filter(v => v.startsWith(prefix.trim().toLowerCase())).map(v => ({ value: v, label: v })),
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "") setEnabled(!registry.enabled, ctx);
			else if (arg === "on" || arg === "off") setEnabled(arg === "on", ctx);
			else ctx.ui.notify("Usage: /flymode [on|off]", "warning");
		},
	});

	pi.registerShortcut("ctrl+alt+f", {
		description: "Toggle fly mode",
		handler: ctx => setEnabled(!registry.enabled, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		captureTui(ctx);
		wrapExisting();
		if (registry.enabled) ctx.ui.setStatus(STATUS_KEY, STATUS_TEXT);
	});
}

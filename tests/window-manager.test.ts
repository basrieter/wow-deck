import { describe, expect, it } from "vitest";
import { listWindows, windowDiscoveryStatus } from "../src/capture/window-manager.js";

describe.skipIf(process.platform !== "win32")("Windows window discovery", () => {
    it("runs through both discovery paths without crashing the plugin", () => {
        expect(Array.isArray(listWindows(true))).toBe(true);
        expect(windowDiscoveryStatus()).toMatch(/windows/i);
    });
});

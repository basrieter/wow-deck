import { describe, expect, it } from "vitest";
import { mapClientToFrame } from "../src/capture/window-geometry.js";
import { sourceRegion } from "../src/capture/image-processor.js";
import { normalizeGrid } from "../src/settings/global-grid-settings.js";

describe("client-area mapping", () => {
    const windowBounds = { left: 92, top: 92, right: 1108, bottom: 908 };
    const visibleBounds = { left: 100, top: 100, right: 1100, bottom: 900 };

    it("uses the visible frame for captures without resize margins", () => {
        expect(
            mapClientToFrame(
                { x: 100, y: 130 },
                { width: 1000, height: 770 },
                { width: 1000, height: 800 },
                windowBounds,
                visibleBounds
            )
        ).toEqual({ x: 0, y: 30, width: 1000, height: 770 });
    });

    it("uses the Win32 rectangle when the frame includes resize margins", () => {
        expect(
            mapClientToFrame(
                { x: 100, y: 130 },
                { width: 1000, height: 770 },
                { width: 1016, height: 816 },
                windowBounds,
                visibleBounds
            )
        ).toEqual({ x: 8, y: 38, width: 1000, height: 770 });
    });

    it("keeps a partly clipped client area so interior cells can be captured", () => {
        const client = mapClientToFrame(
            { x: 96, y: 100 },
            { width: 1008, height: 800 },
            { width: 1000, height: 800 },
            windowBounds,
            visibleBounds
        );
        expect(client).toEqual({ x: -4, y: 0, width: 1008, height: 800 });
        const grid = normalizeGrid(null);
        const frame = {
            width: 1000,
            height: 800,
            buffer: Buffer.alloc(0),
            colorFormat: "bgra8"
        };
        expect(sourceRegion(grid, "1-1", client!, frame)).toBeNull();
        expect(sourceRegion(grid, "1-2", client!, frame)).toEqual({
            left: 44,
            top: 0,
            width: 48,
            height: 48
        });
    });

    it("rejects a client area with no overlap or invalid dimensions", () => {
        expect(
            mapClientToFrame(
                { x: 5000, y: 5000 },
                { width: 100, height: 100 },
                { width: 1000, height: 800 },
                windowBounds,
                visibleBounds
            )
        ).toBeNull();
        expect(
            mapClientToFrame({ x: 100, y: 100 }, { width: 0, height: 100 }, { width: 1000, height: 800 }, windowBounds)
        ).toBeNull();
    });
});

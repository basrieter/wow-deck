import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, cellRegion, normalizeGrid, positions } from "../src/settings/global-grid-settings.js";
import { parseShortcut } from "../src/input/shortcut.js";
import { boundingRegion, regionHash, regionWithin } from "../src/capture/image-processor.js";
import { renderCrop } from "../src/capture/image-processor.js";
import sharp from "sharp";
import { selectWindow } from "../src/capture/window-selection.js";

describe("shared grid", () => {
    it("generates row-column options", () => {
        expect(positions(DEFAULT_GRID)).toHaveLength(15);
        expect(positions(DEFAULT_GRID)[7]).toBe("2-3");
    });
    it("uses origin, dimensions and gaps", () => {
        const grid = {
            ...DEFAULT_GRID,
            originX: 10,
            originY: 20,
            cellWidth: 30,
            cellHeight: 40,
            horizontalGap: 2,
            verticalGap: 3
        };
        expect(cellRegion(grid, "2-3", 200, 200)).toEqual({
            x: 74,
            y: 63,
            width: 30,
            height: 40
        });
        expect(cellRegion(grid, "2-3", 100, 100)).toBeNull();
        expect(cellRegion(grid, "4-1", 200, 200)).toBeNull();
    });
    it("rejects malformed persisted settings", () => {
        expect(normalizeGrid({ rowCount: -1, cellWidth: 0, captureInterval: 123 }).rowCount).toBe(3);
        expect(normalizeGrid({ rowCount: -1, cellWidth: 0, captureInterval: 123 }).captureInterval).toBe(1000);
        expect(normalizeGrid({ hashChangeDetection: "off", debugLogging: 1 }).hashChangeDetection).toBe(true);
        expect(normalizeGrid({ hashChangeDetection: "off", debugLogging: 1 }).debugLogging).toBe(false);
        expect(normalizeGrid({ hashChangeDetection: false, debugLogging: true })).toMatchObject({
            hashChangeDetection: false,
            debugLogging: true
        });
    });
});
describe("shortcuts", () => {
    it("parses modifier order and supported keys", () => {
        expect(parseShortcut("Shift+1")?.keys).toEqual([0x10, 0x31]);
        expect(parseShortcut("Ctrl+Alt+F1")?.keys).toEqual([0x11, 0x12, 0x70]);
        expect(parseShortcut("Ctrl-Alt-Shift-F1")?.keys).toEqual([0x11, 0x12, 0x10, 0x70]);
        expect(parseShortcut("Ctrl--")?.keys).toEqual([0x11, 0xbd]);
        expect(parseShortcut("=")?.keys).toEqual([0xbb]);
        expect(parseShortcut("Ctrl+Ctrl+1")).toBeNull();
        expect(parseShortcut("Ctrl+")).toBeNull();
    });
});
describe("arbitrary window selection", () => {
    const windows = [
        { processName: "notepad.exe", title: "Notes - Notepad" },
        { processName: "firefox.exe", title: "Test page — Firefox" }
    ];
    it("selects a non-WoW window by executable or partial title", () => {
        expect(selectWindow(windows, { windowProcess: "", windowTitle: "test page" })).toBe(windows[1]);
        expect(selectWindow(windows, { windowProcess: "NOTEPAD.EXE", windowTitle: "" })).toBe(windows[0]);
    });
    it("falls back to executable after a title change", () => {
        expect(
            selectWindow(windows, {
                windowProcess: "notepad.exe",
                windowTitle: "Old title"
            })
        ).toBe(windows[0]);
        expect(selectWindow(windows, { windowProcess: "", windowTitle: "Missing" })).toBeNull();
    });
    it("honors the selected handle when one executable has multiple windows", () => {
        const sameApp = [
            { processName: "notepad.exe", title: "Notes", handle: 11 },
            { processName: "notepad.exe", title: "Notes", handle: 22 }
        ];
        expect(
            selectWindow(sameApp, {
                windowProcess: "notepad.exe",
                windowTitle: "Notes",
                windowHandle: 22
            })
        ).toBe(sameApp[1]);
    });
});
describe("image comparison", () => {
    it("builds a small area around only the mapped cells", () => {
        const area = boundingRegion([
            { left: 300, top: 200, width: 48, height: 48 },
            { left: 408, top: 200, width: 48, height: 48 }
        ]);
        expect(area).toEqual({ left: 300, top: 200, width: 156, height: 48 });
        expect(regionWithin({ left: 408, top: 200, width: 48, height: 48 }, area!)).toEqual({
            left: 108,
            top: 0,
            width: 48,
            height: 48
        });
        expect(boundingRegion([])).toBeNull();
    });
    it("hashes only the selected crop", () => {
        const frame = {
            buffer: Buffer.alloc(4 * 4 * 4),
            width: 4,
            height: 4,
            colorFormat: "bgra8"
        };
        const rect = { left: 1, top: 1, width: 2, height: 2 };
        const initial = regionHash(frame, rect);
        frame.buffer[0] = 255;
        expect(regionHash(frame, rect)).toBe(initial);
        frame.buffer[(1 * 4 + 1) * 4] = 255;
        expect(regionHash(frame, rect)).not.toBe(initial);
    });
    it("converts a BGRA game pixel to the right display color", async () => {
        const frame = {
            buffer: Buffer.from([10, 20, 200, 255]),
            width: 1,
            height: 1,
            colorFormat: "bgra8"
        };
        const dataUrl = await renderCrop(frame, {
            left: 0,
            top: 0,
            width: 1,
            height: 1
        });
        const pixel = await sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
            .raw()
            .toBuffer();
        expect([...pixel.subarray(0, 3)]).toEqual([200, 20, 10]);
    });
});

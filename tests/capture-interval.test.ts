import { describe, expect, it, vi } from "vitest";
import { CaptureManager } from "../src/capture/capture-manager.js";
import { normalizeGrid } from "../src/settings/global-grid-settings.js";

vi.mock("@elgato/streamdeck", () => ({
    default: { logger: { info() {}, warn() {} } }
}));

vi.mock("../src/capture/window-manager.js", () => ({
    resolveWindow: () => ({ handle: 1 }),
    isMinimized: () => false,
    clientBounds: () => ({ x: 0, y: 0, width: 48, height: 48 })
}));

vi.mock("@screen-capture/node", () => {
    type Frame = {
        buffer: Buffer;
        width: number;
        height: number;
        colorFormat: string;
    };
    class FakeCapture {
        private queue: Frame[] = [];
        private pending: ((frame: Frame | undefined) => void) | null = null;
        private push(frame: Frame) {
            if (this.pending) {
                const resolve = this.pending;
                this.pending = null;
                resolve(frame);
            }
            else {
                this.queue.push(frame);
            }
        }

        async start() {
            const makeFrame = (red: number): Frame => {
                const buffer = Buffer.alloc(48 * 48 * 4);
                for (let i = 0; i < buffer.length; i += 4) {
                    buffer[i + 2] = red;
                    buffer[i + 3] = 255;
                }
                return { buffer, width: 48, height: 48, colorFormat: "bgra8" };
            };
            this.push(makeFrame(50));
            setTimeout(() => this.push(makeFrame(200)), 40);
        }

        nextFrame(): Promise<Frame | undefined> {
            const queued = this.queue.shift();
            if (queued) {
                return Promise.resolve(queued);
            }
            return new Promise(resolve => (this.pending = resolve));
        }

        async stop() {
            this.pending?.(undefined);
            this.pending = null;
        }
    }
    return { ScreenCapture: FakeCapture, isSupported: () => true };
});

describe("capture interval", () => {
    it("shows a changed frame even if the window becomes static before the deadline", async () => {
        const manager = new CaptureManager();
        const images: string[] = [];
        const grid = {
            ...normalizeGrid(null),
            windowProcess: "test.exe",
            captureInterval: 250 as const
        };
        manager.setGrid(grid);
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Second frame was not shown")), 1200);
                manager.subscribe("button", {
                    position: "1-1",
                    mirror: true,
                    update: async (image) => {
                        if (image.startsWith("data:image/png")) {
                            images.push(image);
                        }
                        if (images.length === 2) {
                            clearTimeout(timeout);
                            resolve();
                        }
                    }
                });
            });
            expect(images[0]).not.toBe(images[1]);
        }
        finally {
            await manager.shutdown();
        }
    });
});

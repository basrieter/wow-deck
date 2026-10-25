import { ScreenCapture, captureApiSupport, isSupported, type WindowInfo } from "@screen-capture/node";
import streamDeck from "@elgato/streamdeck";
import type { GridSettings } from "../settings/global-grid-settings.js";
import { normalizeGrid } from "../settings/global-grid-settings.js";
import { clientBounds, isMinimized, resolveWindow } from "./window-manager.js";
import {
    fallbackSvg,
    regionHash,
    renderCrop,
    renderPreview,
    sourceRegion,
    boundingRegion,
    regionWithin,
    type RawFrame,
    type ClientRect,
    type PixelRegion
} from "./image-processor.js";

type Subscriber = {
    position: string;
    mirror: boolean;
    update: (image: string, status: string) => Promise<void>;
};
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type CaptureStats = {
    since: number;
    frames: number;
    processed: number;
    frameGapMs: number;
    frameGaps: number;
    maxFrameGapMs: number;
    waitMs: number;
    cropMs: number;
    hashMs: number;
    encodeMs: number;
    deliveryMs: number;
    imageMs: number;
    imageUpdates: number;
    hashSkips: number;
    encodedCells: number;
    invalidCells: number;
    source: string;
    area: string;
    sourcePixels: number;
    areaPixels: number;
    mappedCells: number;
    validCells: number;
};

const freshStats = (): CaptureStats => ({
    since: Date.now(),
    frames: 0,
    processed: 0,
    frameGapMs: 0,
    frameGaps: 0,
    maxFrameGapMs: 0,
    waitMs: 0,
    cropMs: 0,
    hashMs: 0,
    encodeMs: 0,
    deliveryMs: 0,
    imageMs: 0,
    imageUpdates: 0,
    hashSkips: 0,
    encodedCells: 0,
    invalidCells: 0,
    source: "none",
    area: "none",
    sourcePixels: 0,
    areaPixels: 0,
    mappedCells: 0,
    validCells: 0
});

export class CaptureManager {
    private subscribers = new Map<string, Subscriber>();
    private grid: GridSettings = normalizeGrid(null);
    private session: ScreenCapture | null = null;
    private selected: WindowInfo | null = null;
    private running = false;
    private generation = 0;
    private lastWarning = new Map<string, number>();
    private status = "Select a window";
    private latest: { frame: RawFrame; client: ClientRect } | null = null;
    private latestImages = new Map<string, string>();
    private wakeInterval: (() => void) | null = null;
    private loggedInterval: number | null = null;
    private stats = freshStats();
    private lastFrameAt = 0;

    private diagnosticsEnabled() {
        return this.grid.debugLogging || process.env.WOW_MIRROR_DEBUG === "1";
    }

    recordImageUpdate(milliseconds: number) {
        if (!this.diagnosticsEnabled()) {
            return;
        }
        this.stats.imageUpdates++;
        this.stats.imageMs += milliseconds;
    }

    private logDiagnostics() {
        if (!this.diagnosticsEnabled()) {
            return;
        }
        const s = this.stats;
        const seconds = Math.max(0.001, (Date.now() - s.since) / 1000);
        const average = (duration: number) => (s.frames ? (duration / s.frames).toFixed(1) : "0.0");
        streamDeck.logger.info(
            `[capture-debug] interval=${this.grid.captureInterval}ms hash=${this.grid.hashChangeDetection ? "on" : "off"} `
            + `status=${this.status} frames=${s.frames}/${seconds.toFixed(1)}s fps=${(s.frames / seconds).toFixed(2)} processed=${s.processed} `
            + `frameGapMs(avg/max)=${s.frameGaps ? (s.frameGapMs / s.frameGaps).toFixed(1) : "0.0"}/${s.maxFrameGapMs.toFixed(1)} `
            + `source=${s.source} roi=${s.area} roiPixels=${s.sourcePixels ? ((100 * s.areaPixels) / s.sourcePixels).toFixed(1) : "0.0"}% cells=${s.validCells}/${s.mappedCells} invalid=${s.invalidCells} `
            + `hashSkipped=${s.hashSkips} encoded=${s.encodedCells} imageUpdates=${s.imageUpdates} `
            + `avgMs(wait/crop/hash/encode/deliver/image)=${average(s.waitMs)}/${average(s.cropMs)}/${average(s.hashMs)}/${average(s.encodeMs)}/${average(s.deliveryMs)}/${s.imageUpdates ? (s.imageMs / s.imageUpdates).toFixed(1) : "0.0"} `
            + `actions=${this.subscribers.size} rss=${Math.round(process.memoryUsage().rss / 1048576)}MiB`
        );
        this.stats = freshStats();
        this.stats.source = s.source;
        this.stats.area = s.area;
        this.stats.sourcePixels = s.sourcePixels;
        this.stats.areaPixels = s.areaPixels;
        this.stats.mappedCells = s.mappedCells;
        this.stats.validCells = s.validCells;
    }

    get window() {
        return this.selected;
    }

    get currentStatus() {
        return this.status;
    }

    async preview() {
        const latest = this.latest;
        const window = this.selected;
        if (!latest || !window) {
            return null;
        }
        return {
            dataUrl: await renderPreview(latest.frame),
            frameWidth: latest.frame.width,
            frameHeight: latest.frame.height,
            client: { ...latest.client },
            windowHandle: window.handle
        };
    }

    setGrid(grid: GridSettings) {
        const wasDebugging = this.diagnosticsEnabled();
        if (this.loggedInterval !== grid.captureInterval) {
            streamDeck.logger.info(`Capture interval configured: ${grid.captureInterval} ms`);
            this.loggedInterval = grid.captureInterval;
        }
        this.grid = grid;
        if (!wasDebugging && this.diagnosticsEnabled()) {
            streamDeck.logger.info("[capture-debug] Detailed capture logging enabled");
        }
        this.stats = freshStats();
        this.latest = null;
        this.latestImages.clear();
        this.generation++;
        this.wakeInterval?.();
        void this.session?.stop().catch(() => {});
        this.session = null;
        if (this.subscribers.size) {
            this.ensureRunning();
        }
    }

    subscribe(id: string, subscriber: Subscriber) {
        this.subscribers.set(id, subscriber);
        void (async () => {
            try {
                await subscriber.update(fallbackSvg(this.status), this.status);
                if (this.subscribers.get(id) !== subscriber || !this.latest || !subscriber.mirror) {
                    return;
                }
                const { frame, client } = this.latest;
                const rect = sourceRegion(this.grid, subscriber.position, client, frame);
                if (!rect) {
                    await subscriber.update(fallbackSvg("Invalid cell"), "Invalid cell");
                    return;
                }
                const image = this.latestImages.get(subscriber.position);
                if (!image) {
                    // A newly mapped cell will be rendered from the next shared cropped frame.
                    return;
                }
                if (this.subscribers.get(id) === subscriber) {
                    await subscriber.update(image, "Mirroring");
                }
            }
            catch (error) {
                this.warn(String(error));
            }
        })();
        this.ensureRunning();
    }

    unsubscribe(id: string) {
        this.subscribers.delete(id);
        if (!this.subscribers.size) {
            this.generation++;
            this.wakeInterval?.();
            void this.session?.stop().catch(() => {});
            this.session = null;
            this.selected = null;
            this.latest = null;
            this.latestImages.clear();
        }
    }

    private ensureRunning() {
        if (!this.running) {
            this.running = true;
            void this.loop();
        }
    }

    private warn(message: string) {
        const now = Date.now();
        if (now - (this.lastWarning.get(message) ?? 0) > 30_000) {
            streamDeck.logger.warn(message);
            this.lastWarning.set(message, now);
        }
    }

    private async publish(message: string) {
        if (this.diagnosticsEnabled() && message !== this.status) {
            streamDeck.logger.info(`[capture-debug] Status ${this.status} -> ${message}`);
        }
        this.status = message;
        const image = fallbackSvg(message);
        await Promise.allSettled([...this.subscribers.values()].map(s => s.update(image, message)));
    }

    private waitForInterval(started: number, token: number) {
        const remaining = this.grid.captureInterval - (performance.now() - started);
        if (remaining <= 0 || token !== this.generation || !this.subscribers.size) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const finish = () => {
                clearTimeout(timer);
                if (this.wakeInterval === finish) {
                    this.wakeInterval = null;
                }
                resolve();
            };
            const timer = setTimeout(finish, remaining);
            this.wakeInterval = finish;
        });
    }

    private async loop() {
        while (this.subscribers.size) {
            const token = this.generation;
            let capture: ScreenCapture | null = null;
            let diagnosticTimer: ReturnType<typeof setInterval> | null = null;
            try {
                if (!this.grid.windowProcess && !this.grid.windowTitle) {
                    await this.publish("Select a window");
                    await pause(1500);
                    continue;
                }
                const window = resolveWindow(this.grid);
                if (!window) {
                    this.selected = null;
                    await this.publish("Target not running");
                    await pause(1500);
                    continue;
                }
                if (isMinimized(window)) {
                    this.selected = null;
                    await this.publish("Window minimized");
                    await pause(1500);
                    continue;
                }
                let supported = false;
                try {
                    supported = isSupported();
                }
                catch (error) {
                    this.warn(String(error));
                }
                if (!supported) {
                    await this.publish("Capture unavailable");
                    await pause(3000);
                    continue;
                }
                this.selected = window;
                capture = new ScreenCapture({
                    windowHandle: window.handle,
                    cursorCapture: false,
                    minimumUpdateIntervalMs: this.grid.captureInterval
                });
                this.session = capture;
                await capture.start();
                this.lastFrameAt = 0;
                if (this.diagnosticsEnabled()) {
                    let nativeInterval = "unknown";
                    try {
                        nativeInterval = captureApiSupport().minimumUpdateInterval ? "available" : "unavailable";
                    }
                    catch {
                        // Diagnostics must not interrupt capture.
                    }
                    streamDeck.logger.info(
                        `[capture-debug] Session started handle=${window.handle} interval=${this.grid.captureInterval}ms `
                        + `nativeInterval=${nativeInterval} hash=${this.grid.hashChangeDetection ? "on" : "off"} actions=${this.subscribers.size}`
                    );
                    diagnosticTimer = setInterval(() => this.logDiagnostics(), 10_000);
                }
                let unavailableFrames = 0;
                const previous = new Map<string, { hash: string; image: string }>();
                while (this.subscribers.size && token === this.generation) {
                    const started = performance.now();
                    const frame = await capture.nextFrame();
                    const processedAt = performance.now();
                    const captureWait = processedAt - started;
                    if (!frame || token !== this.generation || !this.subscribers.size) {
                        break;
                    }
                    const diagnostic = this.diagnosticsEnabled();
                    if (diagnostic) {
                        this.stats.frames++;
                        this.stats.waitMs += captureWait;
                        this.stats.source = `${frame.width}x${frame.height}`;
                        this.stats.sourcePixels = frame.width * frame.height;
                        if (this.lastFrameAt) {
                            const gap = processedAt - this.lastFrameAt;
                            this.stats.frameGapMs += gap;
                            this.stats.frameGaps++;
                            this.stats.maxFrameGapMs = Math.max(this.stats.maxFrameGapMs, gap);
                        }
                        this.lastFrameAt = processedAt;
                    }
                    const current = resolveWindow(this.grid);
                    if (!current || current.handle !== window.handle || isMinimized(current)) {
                        break;
                    }
                    const client = clientBounds(current, frame.width, frame.height);
                    if (!client) {
                        unavailableFrames++;
                        this.warn(
                            `Client area unavailable: frame=${frame.width}x${frame.height} window=${current.width}x${current.height} handle=${current.handle}`
                        );
                        if (unavailableFrames >= 3) {
                            this.latest = null;
                            await this.publish("Client area unavailable");
                        }
                        await this.waitForInterval(processedAt, token);
                        continue;
                    }
                    unavailableFrames = 0;
                    this.status = "Mirroring";
                    this.latest = { frame, client };
                    const cache = new Map<string, { image: string; status: string }>();
                    const valid = new Map<string, PixelRegion>();
                    let invalid = 0;
                    for (const sub of this.subscribers.values()) {
                        if (!sub.mirror) {
                            continue;
                        }
                        const pos = sub.position;
                        if (cache.has(pos) || valid.has(pos)) {
                            continue;
                        }
                        const rect = sourceRegion(this.grid, pos, client, frame);
                        if (!rect) {
                            invalid++;
                            cache.set(pos, {
                                image: fallbackSvg("Invalid cell"),
                                status: "Invalid cell"
                            });
                            continue;
                        }
                        valid.set(pos, rect);
                    }
                    const area = boundingRegion(valid.values());
                    let cellFrame: RawFrame | null = null;
                    if (area) {
                        const cropStarted = performance.now();
                        const cropped = frame.crop(area.left, area.top, area.left + area.width, area.top + area.height);
                        // Read the native pixels once, after reducing the full window to its mapped cells.
                        cellFrame = {
                            buffer: cropped.buffer,
                            width: cropped.width,
                            height: cropped.height,
                            colorFormat: cropped.colorFormat
                        };
                        if (diagnostic) {
                            this.stats.cropMs += performance.now() - cropStarted;
                        }
                    }
                    if (diagnostic) {
                        this.stats.processed++;
                        this.stats.invalidCells += invalid;
                        this.stats.mappedCells = valid.size + invalid;
                        this.stats.validCells = valid.size;
                        this.stats.area = area ? `${area.width}x${area.height}` : "none";
                        this.stats.areaPixels = area ? area.width * area.height : 0;
                    }
                    for (const [pos, rect] of valid) {
                        const local = regionWithin(rect, area!);
                        let image: string | undefined;
                        let hash = "";
                        if (this.grid.hashChangeDetection) {
                            const hashStarted = performance.now();
                            hash = regionHash(cellFrame!, local);
                            if (diagnostic) {
                                this.stats.hashMs += performance.now() - hashStarted;
                            }
                            const prior = previous.get(pos);
                            if (prior?.hash === hash) {
                                image = prior.image;
                                if (diagnostic) {
                                    this.stats.hashSkips++;
                                }
                            }
                        }
                        if (!image) {
                            const encodeStarted = performance.now();
                            image = await renderCrop(cellFrame!, local);
                            if (diagnostic) {
                                this.stats.encodedCells++;
                                this.stats.encodeMs += performance.now() - encodeStarted;
                            }
                        }
                        if (this.grid.hashChangeDetection) {
                            previous.set(pos, { hash, image });
                        }
                        this.latestImages.set(pos, image);
                        cache.set(pos, { image, status: "Mirroring" });
                    }
                    const deliveryStarted = performance.now();
                    const results = await Promise.allSettled(
                        [...this.subscribers.values()].map((sub) => {
                            if (!sub.mirror) {
                                return sub.update(fallbackSvg("Mirror off"), "Mirror off");
                            }
                            const data = cache.get(sub.position);
                            return data ? sub.update(data.image, data.status) : Promise.resolve();
                        })
                    );
                    if (diagnostic) {
                        this.stats.deliveryMs += performance.now() - deliveryStarted;
                    }
                    for (const result of results) {
                        if (result.status === "rejected") {
                            this.warn(`Button update failed: ${String(result.reason)}`);
                        }
                    }
                    await this.waitForInterval(processedAt, token);
                }
            }
            catch (error) {
                this.warn(String(error));
                await this.publish(
                    /access denied|0x80070005/i.test(String(error)) ? "Access denied" : "Capture failed"
                );
            }
            finally {
                if (diagnosticTimer) {
                    clearInterval(diagnosticTimer);
                    if (this.stats.frames) {
                        this.logDiagnostics();
                    }
                }
                this.selected = null;
                this.latest = null;
                this.latestImages.clear();
                if (capture) {
                    try {
                        await capture.stop();
                    }
                    catch {
                        /* closed already */
                    }
                }
                if (this.session === capture) {
                    this.session = null;
                }
            }
            if (this.subscribers.size && token === this.generation) {
                await pause(1500);
            }
        }
        this.running = false;
    }

    async shutdown() {
        this.subscribers.clear();
        this.generation++;
        this.wakeInterval?.();
        await this.session?.stop().catch(() => {});
    }
}

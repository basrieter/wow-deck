import {
  ScreenCapture,
  isSupported,
  type WindowInfo,
} from "@screen-capture/node";
import streamDeck from "@elgato/streamdeck";
import type { GridSettings } from "../settings/global-grid-settings.js";
import { normalizeGrid } from "../settings/global-grid-settings.js";
import { clientBounds, isMinimized, resolveWindow } from "./window-manager.js";
import {
  fallbackSvg,
  regionHash,
  renderCrop,
  sourceRegion,
  type RawFrame,
  type ClientRect,
} from "./image-processor.js";

type Subscriber = {
  position: string;
  mirror: boolean;
  update: (image: string, status: string) => Promise<void>;
};
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CaptureManager {
  private subscribers = new Map<string, Subscriber>();
  private grid: GridSettings = normalizeGrid(null);
  private session: ScreenCapture | null = null;
  private selected: WindowInfo | null = null;
  private running = false;
  private generation = 0;
  private lastWarning = new Map<string, number>();
  private status = "Select a window";
  private lastDiagnostic = 0;
  private latest: { frame: RawFrame; client: ClientRect } | null = null;
  private latestImages = new Map<string, string>();

  get window() {
    return this.selected;
  }
  get currentStatus() {
    return this.status;
  }
  setGrid(grid: GridSettings) {
    this.grid = grid;
    this.latest = null;
    this.latestImages.clear();
    this.generation++;
    void this.session?.stop().catch(() => {});
    this.session = null;
    if (this.subscribers.size) this.ensureRunning();
  }
  subscribe(id: string, subscriber: Subscriber) {
    this.subscribers.set(id, subscriber);
    void (async () => {
      try {
        await subscriber.update(fallbackSvg(this.status), this.status);
        if (
          this.subscribers.get(id) !== subscriber ||
          !this.latest ||
          !subscriber.mirror
        )
          return;
        const { frame, client } = this.latest;
        const rect = sourceRegion(
          this.grid,
          subscriber.position,
          client,
          frame,
        );
        if (!rect) {
          await subscriber.update(fallbackSvg("Invalid cell"), "Invalid cell");
          return;
        }
        const image =
          this.latestImages.get(subscriber.position) ??
          (await renderCrop(frame, rect));
        this.latestImages.set(subscriber.position, image);
        if (this.subscribers.get(id) === subscriber)
          await subscriber.update(image, "Mirroring");
      } catch (error) {
        this.warn(String(error));
      }
    })();
    this.ensureRunning();
  }
  unsubscribe(id: string) {
    this.subscribers.delete(id);
    if (!this.subscribers.size) {
      this.generation++;
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
    this.status = message;
    const image = fallbackSvg(message);
    await Promise.allSettled(
      [...this.subscribers.values()].map((s) => s.update(image, message)),
    );
  }
  private async loop() {
    while (this.subscribers.size) {
      const token = this.generation;
      let capture: ScreenCapture | null = null;
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
        } catch (error) {
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
          minimumUpdateIntervalMs: this.grid.captureInterval,
        });
        this.session = capture;
        await capture.start();
        let lastUpdate = 0;
        let unavailableFrames = 0;
        const previous = new Map<string, { hash: string; image: string }>();
        while (this.subscribers.size && token === this.generation) {
          const started = performance.now();
          const frame = await capture.nextFrame();
          const captureWait = performance.now() - started;
          if (!frame) break;
          if (Date.now() - lastUpdate < this.grid.captureInterval - 20)
            continue;
          lastUpdate = Date.now();
          const current = resolveWindow(this.grid);
          if (
            !current ||
            current.handle !== window.handle ||
            isMinimized(current)
          )
            break;
          const client = clientBounds(current, frame.width, frame.height);
          if (!client) {
            unavailableFrames++;
            this.warn(
              `Client area unavailable: frame=${frame.width}x${frame.height} window=${current.width}x${current.height} handle=${current.handle}`,
            );
            if (unavailableFrames >= 3) {
              this.latest = null;
              await this.publish("Client area unavailable");
            }
            continue;
          }
          unavailableFrames = 0;
          this.status = "Mirroring";
          this.latest = { frame, client };
          const cache = new Map<string, { image: string; status: string }>();
          let encoded = 0;
          for (const sub of this.subscribers.values()) {
            if (!sub.mirror) continue;
            const pos = sub.position;
            if (cache.has(pos)) continue;
            const rect = sourceRegion(this.grid, pos, client, frame);
            if (!rect) {
              cache.set(pos, {
                image: fallbackSvg("Invalid cell"),
                status: "Invalid cell",
              });
              continue;
            }
            const hash = regionHash(frame, rect);
            const prior = previous.get(pos);
            const image =
              hash === prior?.hash
                ? prior.image
                : await renderCrop(frame, rect);
            if (hash !== prior?.hash) encoded++;
            previous.set(pos, { hash, image });
            this.latestImages.set(pos, image);
            cache.set(pos, { image, status: "Mirroring" });
          }
          await Promise.allSettled(
            [...this.subscribers.values()].map((sub) => {
              if (!sub.mirror)
                return sub.update(fallbackSvg("Mirror off"), "Mirror off");
              const data = cache.get(sub.position);
              return data
                ? sub.update(data.image, data.status)
                : Promise.resolve();
            }),
          );
          if (
            process.env.WOW_MIRROR_DEBUG === "1" &&
            Date.now() - this.lastDiagnostic > 30_000
          ) {
            streamDeck.logger.info(
              `frame=${frame.width}x${frame.height} wait=${captureWait.toFixed(1)}ms processing=${(performance.now() - started - captureWait).toFixed(1)}ms encoded=${encoded} actions=${this.subscribers.size} rss=${Math.round(process.memoryUsage().rss / 1048576)}MiB`,
            );
            this.lastDiagnostic = Date.now();
          }
        }
      } catch (error) {
        this.warn(String(error));
        await this.publish(
          /access denied|0x80070005/i.test(String(error))
            ? "Access denied"
            : "Capture failed",
        );
      } finally {
        this.selected = null;
        this.latest = null;
        this.latestImages.clear();
        if (capture)
          try {
            await capture.stop();
          } catch {
            /* closed already */
          }
        if (this.session === capture) this.session = null;
      }
      if (this.subscribers.size && token === this.generation) await pause(1500);
    }
    this.running = false;
  }
  async shutdown() {
    this.subscribers.clear();
    this.generation++;
    await this.session?.stop().catch(() => {});
  }
}

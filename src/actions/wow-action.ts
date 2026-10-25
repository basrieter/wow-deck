import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type SendToPluginEvent,
} from "@elgato/streamdeck";
import type { KeyAction } from "@elgato/streamdeck";
import {
  normalizeAction,
  type ActionSettings,
} from "../settings/action-settings.js";
import {
  normalizeGrid,
  type GridSettings,
} from "../settings/global-grid-settings.js";
import { parseShortcut } from "../input/shortcut.js";
import {
  listWindows,
  resolveWindow,
  windowDiscoveryStatus,
  foregroundWindowInfo,
} from "../capture/window-manager.js";
import { CaptureManager } from "../capture/capture-manager.js";
import { KeyboardManager } from "../input/keyboard-manager.js";
import { fallbackSvg } from "../capture/image-processor.js";

const UUID = "com.wow-deck.button";
export const capture = new CaptureManager();
export const keyboard = new KeyboardManager();

@action({ UUID })
export class WowAction extends SingletonAction<ActionSettings> {
  private settings = new Map<string, ActionSettings>();
  private lastImage = new Map<string, string>();
  private statuses = new Map<string, string>();
  private grid: GridSettings | null = null;
  private pickTimer: ReturnType<typeof setTimeout> | null = null;
  setGrid(grid: GridSettings) {
    this.grid = grid;
    keyboard.releaseAll();
    this.statuses.clear();
    capture.setGrid(grid);
    for (const key of this.actions) if (key.isKey()) this.bind(key);
    this.sendInspector();
  }
  private sendInspector(refreshWindows = false) {
    const id = streamDeck.ui.action?.id;
    const settings = id ? this.settings.get(id) : undefined;
    const status =
      settings?.shortcut && !parseShortcut(settings.shortcut)
        ? "Invalid shortcut"
        : (id && this.statuses.get(id)) || capture.currentStatus;
    const windows = listWindows(refreshWindows);
    void streamDeck.ui.sendToPropertyInspector({
      type: "state",
      status,
      windowDiagnostic: windowDiscoveryStatus(),
      windows: windows.map((w) => ({
        title: w.title,
        process: w.processName,
        handle: w.handle,
      })),
    });
  }
  private bind(key: KeyAction<ActionSettings>) {
    const settings = this.settings.get(key.id) ?? normalizeAction(null);
    this.lastImage.delete(key.id);
    if (settings.shortcut && !parseShortcut(settings.shortcut)) {
      capture.unsubscribe(key.id);
      this.statuses.set(key.id, "Invalid shortcut");
      void key.setImage(fallbackSvg("Invalid shortcut"));
      return;
    }
    capture.subscribe(key.id, {
      position: settings.position,
      mirror: settings.mirror,
      update: async (image, status) => {
        if (this.lastImage.get(key.id) !== image) {
          await key.setImage(image);
          this.lastImage.set(key.id, image);
        }
        if (this.statuses.get(key.id) !== status) {
          this.statuses.set(key.id, status);
          if (streamDeck.ui.action?.id === key.id) this.sendInspector();
        }
      },
    });
  }
  override onWillAppear(ev: WillAppearEvent<ActionSettings>) {
    this.settings.set(ev.action.id, normalizeAction(ev.payload.settings));
    if (ev.action.isKey()) this.bind(ev.action);
  }
  override onWillDisappear(ev: WillDisappearEvent<ActionSettings>) {
    keyboard.release(ev.action.id);
    capture.unsubscribe(ev.action.id);
    this.settings.delete(ev.action.id);
    this.statuses.delete(ev.action.id);
    this.lastImage.delete(ev.action.id);
  }
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>) {
    keyboard.release(ev.action.id);
    const settings = normalizeAction(ev.payload.settings);
    this.settings.set(ev.action.id, settings);
    if (ev.action.isKey()) this.bind(ev.action);
    this.sendInspector();
  }
  override onKeyDown(ev: KeyDownEvent<ActionSettings>) {
    const settings =
      this.settings.get(ev.action.id) ?? normalizeAction(ev.payload.settings);
    if (!parseShortcut(settings.shortcut)) return;
    keyboard.press(
      ev.action.id,
      settings.shortcut,
      this.grid ? resolveWindow(this.grid) : null,
    );
  }
  override onKeyUp(ev: KeyUpEvent<ActionSettings>) {
    keyboard.release(ev.action.id);
  }
  override onPropertyInspectorDidAppear() {
    streamDeck.logger.info("Property Inspector opened");
    this.sendInspector(true);
  }
  override onSendToPlugin(
    ev: SendToPluginEvent<{ type: string }, ActionSettings>,
  ) {
    if (
      !ev.payload ||
      typeof ev.payload !== "object" ||
      Array.isArray(ev.payload)
    )
      return;
    if (ev.payload.type === "refresh") {
      this.sendInspector(true);
      streamDeck.logger.info(windowDiscoveryStatus());
    }
    if (ev.payload.type === "preview") {
      void (async () => {
        try {
          const preview = await capture.preview();
          await streamDeck.ui.sendToPropertyInspector(
            preview
              ? { type: "preview", ...preview }
              : {
                  type: "previewError",
                  message:
                    "No captured frame yet. Save the target window, wait a moment, and try again.",
                },
          );
        } catch (error) {
          streamDeck.logger.warn("Could not make window preview", error);
          await streamDeck.ui.sendToPropertyInspector({
            type: "previewError",
            message: "Could not make a window preview. Check the plugin log.",
          });
        }
      })();
    }
    if (ev.payload.type === "pickForeground") {
      streamDeck.logger.info("Foreground window selection requested");
      if (this.pickTimer) clearTimeout(this.pickTimer);
      this.pickTimer = setTimeout(() => {
        this.pickTimer = null;
        void (async () => {
          const window = foregroundWindowInfo();
          if (!window) {
            streamDeck.logger.warn(
              "No foreground window was accessible after the picker countdown",
            );
            await streamDeck.ui.sendToPropertyInspector({
              type: "pickResult",
              message: "No active window was available",
            });
            return;
          }
          const next = {
            ...(this.grid ?? normalizeGrid(null)),
            windowProcess: window.processName,
            windowTitle: window.title,
            windowHandle: window.handle,
          };
          try {
            await streamDeck.settings.setGlobalSettings(next);
            this.setGrid(next);
            streamDeck.logger.info(
              `Selected window: ${window.processName} (handle ${window.handle})`,
            );
            await streamDeck.ui.sendToPropertyInspector({
              type: "pickResult",
              message: `Selected ${window.processName}. Shared grid saved.`,
            });
          } catch (error) {
            streamDeck.logger.error("Could not save picked window", error);
            await streamDeck.ui.sendToPropertyInspector({
              type: "pickResult",
              message: "Could not save the selected window",
            });
          }
        })();
      }, 3000);
    }
  }
}

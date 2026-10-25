import streamDeck from "@elgato/streamdeck";
import { WowAction, keyboard, capture } from "./actions/wow-action.js";
import { normalizeGrid } from "./settings/global-grid-settings.js";
import { enablePhysicalPixels } from "./capture/window-manager.js";

enablePhysicalPixels();
const action = new WowAction();
streamDeck.actions.registerAction(action);
streamDeck.settings.onDidReceiveGlobalSettings((ev) =>
  action.setGrid(normalizeGrid(ev.settings)),
);
streamDeck.devices.onDeviceDidDisconnect(() => keyboard.releaseAll());
process.on("SIGINT", () => {
  keyboard.releaseAll();
  void capture.shutdown();
});
process.on("SIGTERM", () => {
  keyboard.releaseAll();
  void capture.shutdown();
});
process.on("exit", () => keyboard.releaseAll());
await streamDeck.connect();
streamDeck.logger.info("WoW-Deck plugin connected");
action.setGrid(normalizeGrid(await streamDeck.settings.getGlobalSettings()));

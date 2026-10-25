import koffi from "koffi";
import { parseShortcut, type Shortcut } from "./shortcut.js";
import { isForeground } from "../capture/window-manager.js";
import type { WindowInfo } from "@screen-capture/node";

// INPUT/KEYBDINPUT layout for 64-bit Windows. N-API is used by Koffi; no
// Node-version-specific addon is required, but only win32 x64 is packaged.
const sendInput = koffi
  .load("user32.dll")
  .func("uint SendInput(uint count, void *inputs, int size)");
function sendKey(vk: number, up: boolean): boolean {
  const input = Buffer.alloc(40);
  input.writeUInt32LE(1, 0); // INPUT_KEYBOARD
  input.writeUInt16LE(vk, 8);
  input.writeUInt32LE(up ? 2 : 0, 12); // KEYEVENTF_KEYUP
  return sendInput(1, input, 40) === 1;
}

export class KeyboardManager {
  private held = new Map<string, Shortcut>();
  private counts = new Map<number, number>();
  private down(vk: number) {
    const count = this.counts.get(vk) ?? 0;
    if (count === 0 && !sendKey(vk, false))
      throw new Error("SendInput rejected key down");
    this.counts.set(vk, count + 1);
  }
  private up(vk: number) {
    const count = this.counts.get(vk) ?? 0;
    if (count <= 1) {
      this.counts.delete(vk);
      try {
        sendKey(vk, true);
      } catch {
        /* best effort */
      }
    } else this.counts.set(vk, count - 1);
  }
  press(id: string, text: string, window: WindowInfo | null): boolean {
    if (this.held.has(id) || !window || !isForeground(window)) return false;
    const shortcut = parseShortcut(text);
    if (!shortcut) return false;
    const pressed: number[] = [];
    try {
      for (const vk of shortcut.keys) {
        this.down(vk);
        pressed.push(vk);
      }
      this.held.set(id, shortcut);
      return true;
    } catch {
      for (const vk of pressed.reverse()) this.up(vk);
      return false;
    }
  }
  release(id: string) {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id);
    for (const vk of [...held.keys].reverse()) this.up(vk);
  }
  releaseAll() {
    for (const id of this.held.keys()) this.release(id);
  }
}

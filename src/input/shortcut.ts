export interface Shortcut {
  keys: number[];
  label: string;
}
const named: Record<string, number> = {
  "-": 0xbd,
  "=": 0xbb,
  SPACE: 0x20,
  ENTER: 0x0d,
  TAB: 0x09,
  ESC: 0x1b,
  ESCAPE: 0x1b,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
};
export function parseShortcut(text: string): Shortcut | null {
  let remaining = text.trim().toUpperCase();
  const parts: string[] = [];
  while (true) {
    const prefix = /^(CTRL|CONTROL|ALT|SHIFT)\s*[+-]\s*/.exec(remaining);
    if (!prefix) break;
    parts.push(prefix[1] === "CONTROL" ? "CTRL" : prefix[1]);
    remaining = remaining.slice(prefix[0].length);
  }
  const main = remaining.trim();
  let vk = named[main];
  if (/^[A-Z0-9]$/.test(main)) vk = main.charCodeAt(0);
  if (/^F(?:[1-9]|1[0-2])$/.test(main)) vk = 0x6f + Number(main.slice(1));
  if (vk === undefined) return null;
  const mods = new Set(parts);
  if (mods.size !== parts.length) return null;
  const keys = [
    mods.has("CTRL") ? 0x11 : 0,
    mods.has("ALT") ? 0x12 : 0,
    mods.has("SHIFT") ? 0x10 : 0,
    vk,
  ].filter(Boolean);
  return { keys, label: text.trim() };
}

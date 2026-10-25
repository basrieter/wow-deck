import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("com.wow-deck.sdPlugin");
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, "bin"), { recursive: true });
await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(root, "bin/plugin.js"),
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["@screen-capture/node", "koffi", "sharp"],
});
await cp("manifest.json", path.join(root, "manifest.json"));
await mkdir(path.join(root, "assets"), { recursive: true });
for (const [name, source, size] of [
  ["plugin-icon", "icon", 256],
  ["plugin-icon@2x", "icon", 512],
  ["category-icon", "icon", 28],
  ["category-icon@2x", "icon", 56],
  ["action-icon", "icon", 20],
  ["action-icon@2x", "icon", 40],
  ["key", "key", 144],
  ["key@2x", "key", 288],
]) {
  await sharp(path.join("assets", `${source}.svg`))
    .resize(size, size)
    .png()
    .toFile(path.join(root, "assets", `${name}.png`));
}
await cp("inspector", path.join(root, "inspector"), { recursive: true });
await writeFile(
  path.join(root, "package.json"),
  '{"type":"module","private":true}',
);
for (const name of [
  "@screen-capture/node",
  "@screen-capture/node-win32-x64-msvc",
  "koffi",
  "@koromix/koffi-win32-x64",
  "sharp",
  "@img/sharp-win32-x64",
  "@img/colour",
  "detect-libc",
  "semver",
]) {
  const from = path.join("node_modules", name);
  const to = path.join(root, "node_modules", name);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

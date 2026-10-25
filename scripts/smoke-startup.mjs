import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { WebSocketServer } from "ws";

const pluginDir = path.resolve("com.wow-deck.sdPlugin");
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const port = server.address().port;
let child;
let stderr = "";
try {
  const registered = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Plugin did not register")),
      5000,
    );
    server.once("connection", (socket) => {
      socket.once("message", (data) => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
      });
    });
  });
  child = spawn(
    process.execPath,
    [
      "bin/plugin.js",
      "-port",
      String(port),
      "-pluginUUID",
      "com.wow-deck",
      "-registerEvent",
      "registerPlugin",
      "-info",
      JSON.stringify({ application: { version: "7.6.0" } }),
    ],
    { cwd: pluginDir, stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (data) => (stderr += data.toString()));
  const message = await registered;
  assert.deepEqual(message, { event: "registerPlugin", uuid: "com.wow-deck" });
  console.log(`Packaged plugin registered using Node ${process.version}`);
} finally {
  child?.kill();
  await new Promise((resolve) => server.close(resolve));
}
if (stderr) {
  console.error(stderr);
  process.exitCode = 1;
}

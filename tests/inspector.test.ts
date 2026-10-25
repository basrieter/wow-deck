import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

class FakeOption {
  constructor(
    public label: string,
    public value: string,
  ) {}
}
class FakeElement {
  value = "";
  checked = true;
  textContent = "";
  src = "";
  hidden = false;
  style: Record<string, string> = { color: "" };
  options: FakeOption[] = [];
  onchange?: () => void;
  onclick?: (event?: { clientX: number; clientY: number }) => void;
  oninput?: () => void;
  onkeydown?: (event: {
    key: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    preventDefault(): void;
  }) => void;
  onkeyup?: (event: { key: string; preventDefault(): void }) => void;
  onblur?: () => void;
  replaceChildren() {
    this.options = [];
  }
  add(option: FakeOption) {
    this.options.push(option);
  }
  focus() {}
  checkValidity() {
    return true;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 100 };
  }
}
class FakeSocket {
  static last: FakeSocket;
  readyState = 1;
  messages: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() {
    FakeSocket.last = this;
  }
  send(text: string) {
    this.messages.push(JSON.parse(text));
  }
}

describe("Property Inspector protocol", () => {
  it("uses the inspector UUID to save each action and global grid", () => {
    const elements = new Map<string, FakeElement>();
    const get = (id: string) => {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id)!;
    };
    const browser: Record<string, unknown> = {};
    runInNewContext(
      readFileSync(new URL("../inspector/index.js", import.meta.url), "utf8"),
      {
        window: browser,
        document: { getElementById: get, addEventListener() {} },
        WebSocket: FakeSocket,
        Option: FakeOption,
        setTimeout() {},
        clearTimeout() {},
      },
    );
    const connect = browser.connectElgatoStreamDeckSocket as (
      ...args: string[]
    ) => void;
    connect(
      "1234",
      "pi-uuid",
      "registerPropertyInspector",
      "{}",
      JSON.stringify({
        action: "com.wow-deck.button",
        payload: { settings: {} },
      }),
    );
    const socket = FakeSocket.last;
    socket.onopen?.();
    expect(
      socket.messages.find((m) => m.event === "sendToPlugin")?.context,
    ).toBe("pi-uuid");
    get("position").value = "2-3";
    get("position").onchange?.();
    const actionSave = socket.messages.find((m) => m.event === "setSettings");
    expect(actionSave?.context).toBe("pi-uuid");
    expect(actionSave?.payload).toMatchObject({ position: "2-3" });
    expect(get("status").textContent).toBe("Saving button settings…");
    socket.onmessage?.({
      data: JSON.stringify({
        event: "didReceiveSettings",
        payload: { settings: actionSave?.payload },
      }),
    });
    expect(get("status").textContent).toBe("Button settings saved");
    get("windowProcess").value = "notepad.exe";
    get("saveGrid").onclick?.();
    const gridSave = socket.messages.find(
      (m) => m.event === "setGlobalSettings",
    );
    expect(gridSave?.context).toBe("pi-uuid");
    socket.onmessage?.({
      data: JSON.stringify({
        event: "didReceiveGlobalSettings",
        payload: { settings: gridSave?.payload },
      }),
    });
    expect(get("status").textContent).toBe("Shared grid settings saved");
    socket.onmessage?.({
      data: JSON.stringify({
        event: "sendToPropertyInspector",
        payload: {
          type: "state",
          status: "Mirroring",
          windows: [{ process: "chrome.exe", title: "Browser", handle: 42 }],
        },
      }),
    });
    const listedWindows = get("window").options.length;
    socket.onmessage?.({
      data: JSON.stringify({
        event: "sendToPropertyInspector",
        payload: { type: "state", status: "Mirroring" },
      }),
    });
    expect(get("window").options).toHaveLength(listedWindows);
  });

  it("sets and saves the shared origin from a preview click", () => {
    const elements = new Map<string, FakeElement>();
    const get = (id: string) => {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id)!;
    };
    const browser: Record<string, unknown> = {};
    runInNewContext(
      readFileSync(new URL("../inspector/index.js", import.meta.url), "utf8"),
      {
        window: browser,
        document: { getElementById: get, addEventListener() {} },
        WebSocket: FakeSocket,
        Option: FakeOption,
        setTimeout() {},
        clearTimeout() {},
      },
    );
    const connect = browser.connectElgatoStreamDeckSocket as (
      ...args: string[]
    ) => void;
    connect(
      "1234",
      "pi-uuid",
      "registerPropertyInspector",
      "{}",
      JSON.stringify({
        action: "com.wow-deck.button",
        payload: { settings: {} },
      }),
    );
    const socket = FakeSocket.last;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        event: "didReceiveGlobalSettings",
        payload: {
          settings: { windowProcess: "chrome.exe", windowHandle: 42 },
        },
      }),
    });
    get("showPreview").onclick?.();
    expect(socket.messages.at(-1)?.payload).toMatchObject({ type: "preview" });
    socket.onmessage?.({
      data: JSON.stringify({
        event: "sendToPropertyInspector",
        payload: {
          type: "preview",
          dataUrl: "data:image/jpeg;base64,abc",
          frameWidth: 1000,
          frameHeight: 500,
          client: { x: 10, y: 20, width: 980, height: 460 },
          windowHandle: 42,
        },
      }),
    });
    expect(get("previewWrap").hidden).toBe(false);
    const before = socket.messages.length;
    get("previewImage").onclick?.({ clientX: 1, clientY: 1 });
    expect(socket.messages).toHaveLength(before);
    get("previewImage").onclick?.({ clientX: 100, clientY: 50 });
    const saved = socket.messages.at(-1);
    expect(saved?.event).toBe("setGlobalSettings");
    expect(saved?.payload).toMatchObject({ originX: 490, originY: 230 });
    const afterClick = socket.messages.length;
    const arrow = (key: string) => ({ key, preventDefault() {} });
    get("previewWrap").onkeydown?.(arrow("ArrowRight"));
    get("previewWrap").onkeydown?.(arrow("ArrowRight"));
    get("previewWrap").onkeydown?.(arrow("ArrowUp"));
    expect(socket.messages).toHaveLength(afterClick);
    get("previewWrap").onkeyup?.(arrow("ArrowUp"));
    expect(socket.messages.at(-1)?.payload).toMatchObject({
      originX: 492,
      originY: 229,
    });
    expect(socket.messages).toHaveLength(afterClick + 1);
    get("previewImage").onclick?.({ clientX: 2, clientY: 4 });
    const atEdge = socket.messages.length;
    get("previewWrap").onkeydown?.(arrow("ArrowLeft"));
    get("previewWrap").onkeydown?.(arrow("ArrowUp"));
    get("previewWrap").onkeyup?.(arrow("ArrowUp"));
    expect(socket.messages).toHaveLength(atEdge);
    expect(get("originX").value).toBe(0);
    expect(get("originY").value).toBe(0);
  });
});

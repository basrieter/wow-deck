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
  style = { color: "" };
  options: FakeOption[] = [];
  onchange?: () => void;
  onclick?: () => void;
  oninput?: () => void;
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
  });
});

const $ = id => document.getElementById(id);
const defaults = {
    windowProcess: "",
    windowTitle: "",
    windowHandle: 0,
    originX: 0,
    originY: 0,
    cellWidth: 48,
    cellHeight: 48,
    rowCount: 3,
    columnCount: 5,
    horizontalGap: 0,
    verticalGap: 0,
    captureInterval: 1000,
    hashChangeDetection: true,
    debugLogging: false
};
let socket,
    uuid,
    action,
    grid = { ...defaults },
    settings = { position: "", shortcut: "", mirror: true },
    windows = [];
let learning = false;
let selectedHandle = 0;
let windowDiagnostic = "";
let receivedPluginState = false;
let pendingActionSave;
let pendingGridSave;
let pendingPick = 0;
let preview = null;
let pendingPreview = 0;
let originSaveTimer = null;
let originDirty = false;
const numeric = [
    "originX",
    "originY",
    "cellWidth",
    "cellHeight",
    "rowCount",
    "columnCount",
    "horizontalGap",
    "verticalGap",
    "captureInterval"
];
function send(event, payload) {
    if (socket?.readyState !== 1) {
        return false;
    }
    const message = {
        event,
        context: uuid
    };
    if (["getSettings", "setSettings", "sendToPlugin"].includes(event)) {
        message.action = action;
    }
    if (payload !== undefined) {
        message.payload = payload;
    }
    socket.send(JSON.stringify(message));
    return true;
}
function confirmSave(kind, expected) {
    const pending = { expected };
    if (kind === "button") {
        pendingActionSave = pending;
    }
    else {
        pendingGridSave = pending;
    }
    setStatus(`Saving ${kind} settings…`);
    setTimeout(() => {
        if ((kind === "button" ? pendingActionSave : pendingGridSave) !== pending) {
            return;
        }
        send(kind === "button" ? "getSettings" : "getGlobalSettings");
    }, 200);
    setTimeout(() => {
        if ((kind === "button" ? pendingActionSave : pendingGridSave) !== pending) {
            return;
        }
        setStatus(
            `${kind === "button" ? "Button" : "Shared grid"} settings could not be confirmed. Check the Stream Deck connection.`
        );
        if (kind === "button") {
            pendingActionSave = undefined;
        }
        else {
            pendingGridSave = undefined;
        }
    }, 3000);
}
function receivedSave(kind, actual) {
    const pending = kind === "button" ? pendingActionSave : pendingGridSave;
    if (!pending) {
        return false;
    }
    if (
        !Object.entries(pending.expected).every(
            ([key, value]) => actual?.[key] === value
        )
    ) {
        return false;
    }
    if (kind === "button") {
        pendingActionSave = undefined;
    }
    else {
        pendingGridSave = undefined;
    }
    setStatus(`${kind === "button" ? "Button" : "Shared grid"} settings saved`);
    if (kind === "grid" && preview) {
        $("previewHint").textContent
            = `Origin X ${actual.originX}, Y ${actual.originY} saved. Use the arrow keys for one-pixel adjustments.`;
    }
    return true;
}
function validShortcut(text) {
    let remaining = text.trim().toUpperCase();
    const parts = [];
    while (true) {
        const prefix = /^(CTRL|CONTROL|ALT|SHIFT)\s*[+-]\s*/.exec(remaining);
        if (!prefix) {
            break;
        }
        parts.push(prefix[1] === "CONTROL" ? "CTRL" : prefix[1]);
        remaining = remaining.slice(prefix[0].length);
    }
    const key = remaining.trim();
    const mods = new Set(parts);
    return (
        !!key
        && mods.size === parts.length
        && (/^[A-Z0-9]$/.test(key)
            || /^F(?:[1-9]|1[0-2])$/.test(key)
            || [
                "-",
                "=",
                "UP",
                "DOWN",
                "LEFT",
                "RIGHT",
                "SPACE",
                "ENTER",
                "TAB",
                "ESC",
                "ESCAPE"
            ].includes(key))
    );
}
function setStatus(text) {
    $("status").textContent = text;
}
function clearPreview() {
    if (originSaveTimer !== null) {
        clearTimeout(originSaveTimer);
    }
    originSaveTimer = null;
    originDirty = false;
    preview = null;
    $("previewWrap").hidden = true;
    $("previewImage").src = "";
}
function drawPreviewOverlay() {
    if (!preview) {
        return;
    }
    const { frameWidth, frameHeight, client } = preview;
    const left = Math.max(0, client.x);
    const top = Math.max(0, client.y);
    const right = Math.min(frameWidth, client.x + client.width);
    const bottom = Math.min(frameHeight, client.y + client.height);
    const outline = $("previewClient");
    outline.style.left = `${(left / frameWidth) * 100}%`;
    outline.style.top = `${(top / frameHeight) * 100}%`;
    outline.style.width = `${(Math.max(0, right - left) / frameWidth) * 100}%`;
    outline.style.height = `${(Math.max(0, bottom - top) / frameHeight) * 100}%`;
    const marker = $("previewMarker");
    const x = client.x + Number($("originX").value);
    const y = client.y + Number($("originY").value);
    marker.style.display
        = x >= 0 && x < frameWidth && y >= 0 && y < frameHeight ? "block" : "none";
    marker.style.left = `${(x / frameWidth) * 100}%`;
    marker.style.top = `${(y / frameHeight) * 100}%`;
}
function saveNudgedOrigin() {
    if (!originDirty) {
        return;
    }
    if (originSaveTimer !== null) {
        clearTimeout(originSaveTimer);
    }
    originSaveTimer = null;
    originDirty = false;
    $("previewHint").textContent
        = `Origin X ${$("originX").value}, Y ${$("originY").value}; saving…`;
    $("saveGrid").onclick();
}
function drawPositions() {
    const select = $("position"),
        old = settings.position;
    select.replaceChildren();
    select.add(new Option("Choose a cell", ""));
    for (let r = 1; r <= grid.rowCount; r++) {
        for (let c = 1; c <= grid.columnCount; c++) {
            select.add(new Option(`${r}-${c}`, `${r}-${c}`));
        }
    }
    if (old && !Array.from(select.options).some(o => o.value === old)) {
        select.add(new Option(`${old} (invalid in current grid)`, old));
    }
    select.value = old;
}
function drawWindows() {
    const el = $("window"),
        selected = JSON.stringify([
            $("windowProcess").value.trim(),
            $("windowTitle").value.trim(),
            selectedHandle
        ]);
    el.replaceChildren();
    el.add(
        new Option(
            "Choose a window or enter a target below",
            JSON.stringify(["", "", 0])
        )
    );
    for (const w of windows) {
        el.add(
            new Option(
                `${w.process} — ${w.title || "[untitled]"}`,
                JSON.stringify([w.process, w.title, w.handle])
            )
        );
    }
    if (
        selected !== JSON.stringify(["", "", 0])
        && !Array.from(el.options).some(o => o.value === selected)
    ) {
        el.add(new Option("Manual target", selected));
    }
    el.value = selected;
    $("windowHint").textContent = windows.length
        ? `${windows.length} visible windows found. Choose any application, then save the shared grid.`
        : windowDiagnostic
            || "No windows listed. Open a desktop app and click Refresh.";
}
function drawGrid() {
    numeric.forEach(id => ($(id).value = grid[id]));
    $("hashChangeDetection").checked = grid.hashChangeDetection !== false;
    $("debugLogging").checked = grid.debugLogging === true;
    $("windowProcess").value = grid.windowProcess;
    $("windowTitle").value = grid.windowTitle;
    selectedHandle = grid.windowHandle || 0;
    drawPositions();
    drawWindows();
    if (preview && selectedHandle && preview.windowHandle !== selectedHandle) {
        clearPreview();
    }
    drawPreviewOverlay();
}
function drawAction() {
    drawPositions();
    $("shortcut").value = settings.shortcut;
    $("mirror").checked = settings.mirror !== false;
    $("shortcutHint").style.color
        = settings.shortcut && !validShortcut(settings.shortcut) ? "#ff7979" : "#bbb";
}
function learnedMain(code) {
    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3);
    }
    if (/^Digit[0-9]$/.test(code)) {
        return code.slice(5);
    }
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) {
        return code;
    }
    return (
        {
            Minus: "-",
            Equal: "=",
            Space: "Space",
            Enter: "Enter",
            Tab: "Tab",
            Escape: "Esc",
            ArrowUp: "Up",
            ArrowDown: "Down",
            ArrowLeft: "Left",
            ArrowRight: "Right"
        }[code] || null
    );
}
function setLearning(value) {
    learning = value;
    $("learnShortcut").textContent = value ? "Cancel learning" : "Learn shortcut";
    if (value) {
        setStatus("Press your shortcut now");
        $("learnShortcut").focus();
    }
}
document.addEventListener(
    "keydown",
    (event) => {
        if (!learning) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) {
            return;
        }
        if (
            [
                "ControlLeft",
                "ControlRight",
                "AltLeft",
                "AltRight",
                "ShiftLeft",
                "ShiftRight"
            ].includes(event.code)
        ) {
            return;
        }
        if (event.metaKey) {
            setStatus("Windows-key shortcuts are not supported");
            return;
        }
        const main = learnedMain(event.code);
        if (!main) {
            setStatus("That key is not supported");
            return;
        }
        settings.shortcut = [
            event.ctrlKey && "Ctrl",
            event.altKey && "Alt",
            event.shiftKey && "Shift",
            main
        ]
            .filter(Boolean)
            .join("+");
        $("shortcut").value = settings.shortcut;
        $("shortcutHint").style.color = "#bbb";
        setLearning(false);
        saveAction();
    },
    true
);
function saveAction() {
    const expected = { ...settings };
    if (send("setSettings", expected)) {
        confirmSave("button", expected);
    }
    else {
        setStatus("Stream Deck disconnected; button settings were not saved");
    }
}
window.connectElgatoStreamDeckSocket = (
    port,
    pluginUuid,
    registerEvent,
    _info,
    actionInfo
) => {
    uuid = pluginUuid;
    let data = JSON.parse(actionInfo);
    action = data.action;
    settings = { ...settings, ...data.payload?.settings };
    drawAction();
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.onopen = () => {
        socket.send(JSON.stringify({ event: registerEvent, uuid }));
        send("getGlobalSettings");
        send("getSettings");
        send("sendToPlugin", { type: "refresh" });
        setTimeout(() => {
            if (!receivedPluginState && socket?.readyState === 1) {
                setStatus("Plugin did not respond");
                $("windowHint").textContent
                    = "No window list arrived from the plugin. Check whether the key shows Module error.";
            }
        }, 3000);
    };
    socket.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.event === "didReceiveGlobalSettings") {
            if (!pendingGridSave || receivedSave("grid", m.payload.settings)) {
                grid = { ...defaults, ...m.payload.settings };
                drawGrid();
            }
        }
        if (m.event === "didReceiveSettings") {
            if (!pendingActionSave || receivedSave("button", m.payload.settings)) {
                settings = { ...settings, ...m.payload.settings };
                drawAction();
            }
        }
        if (m.event === "sendToPropertyInspector" && m.payload?.type === "state") {
            receivedPluginState = true;
            if (Array.isArray(m.payload.windows)) {
                windows = m.payload.windows;
                windowDiagnostic = m.payload.windowDiagnostic || "";
                drawWindows();
            }
            if (!pendingActionSave && !pendingGridSave) {
                setStatus(m.payload.status || "Ready");
            }
        }
        if (
            m.event === "sendToPropertyInspector"
            && m.payload?.type === "pickResult"
        ) {
            pendingPick = 0;
            setStatus(m.payload.message || "Window pick finished");
        }
        if (
            m.event === "sendToPropertyInspector"
            && m.payload?.type === "preview"
        ) {
            pendingPreview = 0;
            preview = m.payload;
            $("previewImage").src = preview.dataUrl;
            $("previewWrap").hidden = false;
            $("previewHint").textContent
                = "Green outline: client area. Click the grid's top-left corner, then use arrow keys for one-pixel adjustments. Changes save automatically.";
            drawPreviewOverlay();
            $("previewWrap").focus();
        }
        if (
            m.event === "sendToPropertyInspector"
            && m.payload?.type === "previewError"
        ) {
            pendingPreview = 0;
            $("previewHint").textContent = m.payload.message;
        }
    };
    socket.onclose = () => {
        setLearning(false);
        pendingActionSave = undefined;
        pendingGridSave = undefined;
        pendingPick = 0;
        pendingPreview = 0;
        clearPreview();
        setStatus("Stream Deck disconnected");
    };
};
$("learnShortcut").onclick = () => setLearning(!learning);
$("position").onchange = () => {
    settings.position = $("position").value;
    saveAction();
};
$("shortcut").onchange = () => {
    const text = $("shortcut").value.trim();
    $("shortcutHint").style.color
        = text && !validShortcut(text) ? "#ff7979" : "#bbb";
    if (text && !validShortcut(text)) {
        setStatus("Invalid shortcut");
        return;
    }
    settings.shortcut = text;
    saveAction();
};
$("mirror").onchange = () => {
    settings.mirror = $("mirror").checked;
    saveAction();
};
$("refresh").onclick = () => send("sendToPlugin", { type: "refresh" });
$("pickWindow").onclick = () => {
    if (!send("sendToPlugin", { type: "pickForeground" })) {
        setStatus("Stream Deck disconnected; window picker unavailable");
        return;
    }
    const request = ++pendingPick;
    setStatus("Switch to the target window now; selecting in 3 seconds…");
    setTimeout(() => {
        if (pendingPick !== request) {
            return;
        }
        pendingPick = 0;
        setStatus(
            "Window picker received no reply. Check the WoW-Deck plugin log for a startup error."
        );
    }, 5500);
};
$("window").onchange = () => {
    [$("windowProcess").value, $("windowTitle").value, selectedHandle]
        = JSON.parse($("window").value);
    clearPreview();
};
$("windowProcess").oninput = () => {
    selectedHandle = 0;
    drawWindows();
    clearPreview();
};
$("windowTitle").oninput = () => {
    selectedHandle = 0;
    drawWindows();
    clearPreview();
};
$("showPreview").onclick = () => {
    if (!grid.windowProcess && !grid.windowTitle) {
        $("previewHint").textContent = "Choose and save a target window first.";
        return;
    }
    if (
        $("windowProcess").value.trim() !== grid.windowProcess
        || $("windowTitle").value.trim() !== grid.windowTitle
        || selectedHandle !== grid.windowHandle
    ) {
        $("previewHint").textContent
            = "Save the selected target window before opening its preview.";
        return;
    }
    if (!send("sendToPlugin", { type: "preview" })) {
        $("previewHint").textContent = "Stream Deck disconnected";
        return;
    }
    const request = ++pendingPreview;
    $("previewHint").textContent = "Loading the latest captured frame…";
    setTimeout(() => {
        if (pendingPreview !== request) {
            return;
        }
        pendingPreview = 0;
        $("previewHint").textContent = "No preview reply. Check the plugin log.";
    }, 5000);
};
$("previewImage").onclick = (event) => {
    if (!preview) {
        return;
    }
    const rect = $("previewImage").getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return;
    }
    const x = Math.floor(
        ((event.clientX - rect.left) / rect.width) * preview.frameWidth
        - preview.client.x
    );
    const y = Math.floor(
        ((event.clientY - rect.top) / rect.height) * preview.frameHeight
        - preview.client.y
    );
    if (
        x < 0
        || y < 0
        || x >= preview.client.width
        || y >= preview.client.height
    ) {
        $("previewHint").textContent
            = "Click inside the green client-area outline.";
        return;
    }
    $("originX").value = x;
    $("originY").value = y;
    drawPreviewOverlay();
    $("saveGrid").onclick();
    $("previewWrap").focus();
};
$("previewWrap").onkeydown = (event) => {
    if (!preview) {
        return;
    }
    const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
    }[event.key];
    if (!direction || event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }
    event.preventDefault();
    const x = Number($("originX").value) + direction[0];
    const y = Number($("originY").value) + direction[1];
    const frameX = preview.client.x + x;
    const frameY = preview.client.y + y;
    if (
        x < 0
        || y < 0
        || x >= preview.client.width
        || y >= preview.client.height
        || frameX < 0
        || frameY < 0
        || frameX >= preview.frameWidth
        || frameY >= preview.frameHeight
    ) {
        $("previewHint").textContent
            = "The selected point must stay inside the visible client area.";
        return;
    }
    $("originX").value = x;
    $("originY").value = y;
    drawPreviewOverlay();
    $("previewHint").textContent
        = `Origin X ${x}, Y ${y}. Release the arrow key to save.`;
    originDirty = true;
    if (originSaveTimer !== null) {
        clearTimeout(originSaveTimer);
    }
    originSaveTimer = setTimeout(saveNudgedOrigin, 300);
};
$("previewWrap").onkeyup = (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        return;
    }
    event.preventDefault();
    saveNudgedOrigin();
};
$("previewWrap").onblur = saveNudgedOrigin;
$("originX").oninput = drawPreviewOverlay;
$("originY").oninput = drawPreviewOverlay;
$("saveGrid").onclick = () => {
    const next = { ...grid };
    for (const id of numeric) {
        const input = $(id),
            value = Number(input.value);
        if (!input.checkValidity() || !Number.isInteger(value)) {
            setStatus(`Invalid ${id}`);
            return;
        }
        next[id] = value;
    }
    next.windowProcess = $("windowProcess").value.trim();
    next.windowTitle = $("windowTitle").value.trim();
    next.windowHandle = selectedHandle;
    next.hashChangeDetection = $("hashChangeDetection").checked;
    next.debugLogging = $("debugLogging").checked;
    if (!next.windowProcess && !next.windowTitle) {
        setStatus("Choose a window or enter an executable/title");
        return;
    }
    if (!send("setGlobalSettings", next)) {
        setStatus("Stream Deck disconnected; shared grid was not saved");
        return;
    }
    grid = next;
    drawGrid();
    confirmSave("grid", next);
};

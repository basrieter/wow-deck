import streamDeck, { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

try {
    await import("./runtime.js");
}
catch (error) {
    streamDeck.logger.error("Native module or startup failure", error);
    @action({ UUID: "com.wow-deck.button" })
    class FailedAction extends SingletonAction {
        private sendError() {
            void streamDeck.ui.sendToPropertyInspector({
                type: "state",
                status: "Native module unavailable",
                windowDiagnostic: "The plugin could not start its Windows modules. Check Stream Deck plugin logs.",
                windows: []
            });
        }

        override onWillAppear(ev: WillAppearEvent) {
            if (ev.action.isKey()) {
                void ev.action.setImage(
                    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"144\" height=\"144\"><rect width=\"144\" height=\"144\" fill=\"#171923\"/><text x=\"72\" y=\"65\" fill=\"#f0b35d\" font-size=\"16\" text-anchor=\"middle\">WoW</text><text x=\"72\" y=\"90\" fill=\"white\" font-size=\"11\" text-anchor=\"middle\">Module error</text></svg>"
                );
            }
        }

        override onPropertyInspectorDidAppear() {
            this.sendError();
        }

        override onSendToPlugin() {
            this.sendError();
        }
    }
    streamDeck.actions.registerAction(new FailedAction());
    await streamDeck.connect();
}

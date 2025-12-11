export class FigmaBridge {
  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    window.addEventListener("message", (event) => {
      if (event.data.pluginMessage) {
        const message = event.data.pluginMessage;
        if (message.from === "ai-app") {
          const { from, ...command } = message;

          window.parent.postMessage(
            {
              pluginMessage: command,
            },
            "*",
          );
        } else if (message.from === "figma-plugin") {
          const iframe = document.getElementById(
            "pluginIframe",
          ) as HTMLIFrameElement;
          if (iframe?.contentWindow) {
            const { from, ...response } = message;
            iframe.contentWindow.postMessage(
              {
                pluginMessage: response,
              },
              "*",
            );
          }
        }
      }
    });
  }
}

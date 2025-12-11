/// <reference types="@figma/plugin-typings" />

import { getNodeSummarize } from "./functions/get-node-summarize";
import { getRootFrame } from "./functions/get-root-frame";
import { preloadPretendardFonts } from "./functions/preload-pretendard-fonts";

figma.showUI(__html__, { visible: true, width: 600, height: 640 });

// Initialize fonts and text styles on startup
async function initializePlugin() {
  await preloadPretendardFonts();
}

initializePlugin();

figma.on("selectionchange", () => {
  const selection = figma.currentPage.selection.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));

  console.log("selectionchange", selection);

  figma.ui.postMessage({
    type: "SELECTION_CHANGED",
    data: {
      selectedNodes: selection,
    },
    from: "figma-plugin",
  });
});

figma.ui.onmessage = async (msg) => {
  console.log("🔽 [Plugin] Received message:", msg);
  const pluginMessage = msg.pluginMessage || msg;
  const { type, requestId } = pluginMessage;
  let executedCodeLength = 0;

  try {
    switch (type) {
      case "GET_CONTEXT":
        handleGET_CONTEXT();
        break;

      case "EXECUTE_CODE":
        const { code } = pluginMessage;

        if (!code || typeof code !== "string") {
          figma.ui.postMessage({
            type: "CODE_EXECUTION_ERROR",
            requestId,
            success: false,
            from: "figma-plugin",
          });
          break;
        }

        const startedAt = Date.now();
        let executionError: unknown = null;

        try {
          const aiFunction = new Function(code);
          await Promise.resolve(aiFunction());
        } catch (error) {
          executionError = error;
        }

        const durationMs = Date.now() - startedAt;

        if (executionError) {
          const errorMessage =
            executionError instanceof Error
              ? executionError.message
              : String(executionError);
          const errorStack =
            executionError instanceof Error ? executionError.stack || "" : "";

          figma.ui.postMessage({
            type: "CODE_EXECUTION_ERROR",
            requestId,
            success: false,
            from: "figma-plugin",
            data: {
              originalCode: code,
              errorMessage,
            },
          });
        } else {
          figma.ui.postMessage({
            type: "CODE_EXECUTED",
            requestId,
            success: true,
            from: "figma-plugin",
            data: {
              executedCodeLength,
              executionTime: durationMs,
              result: "Code executed successfully",
            },
          });

          console.log("🚀 [Plugin] Code execution completed");
        }
        break;

      default:
        console.warn(`⚠️ [Plugin] Unknown command type: ${type}`);
        figma.ui.postMessage({
          type: "ERROR",
          requestId,
          success: false,
          from: "figma-plugin",
          data: { message: `Unknown command type: ${type}` },
        });
    }
  } catch (error) {
    // 명령 처리 중 전역 에러 캐치
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack || "" : "";

    console.error("❌ [Plugin] Error processing command:", error);

    figma.ui.postMessage({
      type: "ERROR",
      requestId,
      success: false,
      from: "figma-plugin",
      data: {
        message: errorMessage,
        details: errorStack,
        command: type,
        timestamp: Date.now(),
      },
    });
  }
};

const handleGET_CONTEXT = async () => {
  const selectedNodesInfo = await Promise.all(
    figma.currentPage.selection.map((node: SceneNode) =>
      getNodeSummarize(node),
    ),
  );

  // 웹 디자인 파악용 최적화된 이미지 export
  const selectedNodesImage = await Promise.all(
    figma.currentPage.selection.map(async (node) => {
      const rootFrame = getRootFrame(node);

      let nodeImage = await rootFrame.exportAsync({
        format: "JPG" as const,
        constraint: {
          type: "SCALE",
          value: 0.5,
        },
      });

      return {
        nodeId: node.id,
        nodeName: node.name,
        nodeImage: Array.from(nodeImage),
      };
    }),
  );

  const contextData = {
    selectedNodes: selectedNodesInfo,
    selectedNodesImage,
  };

  console.log("📎 [Plugin] GET_CONTEXT response:", contextData);

  const response = {
    type: "CONTEXT",
    success: true,
    data: contextData,
    from: "figma-plugin",
  };

  figma.ui.postMessage(response);
};

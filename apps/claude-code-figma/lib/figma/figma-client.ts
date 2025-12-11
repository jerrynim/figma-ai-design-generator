"use client";

// Figma Plugin Communication Client
export interface FigmaCommand {
  type:
    | "EXECUTE_CODE"
    | "GET_CONTEXT"
    | "GET_CONTEXT_DETAIL"
    | "REPORT_EXECUTION"
    | "CREATE_NODE"
    | "EXPORT_NODES";
  requestId: string;
  code?: string; // For EXECUTE_CODE
  nodeType?: "RECTANGLE" | "TEXT" | "FRAME" | "COMPONENT";
  properties?: Record<string, any>;
  nodeIds?: string[];
  nodeId?: string;
}

export interface FigmaResponse {
  type:
    | "CODE_EXECUTED"
    | "CODE_EXECUTION_ERROR"
    | "CONTEXT"
    | "CONTEXT_DETAIL"
    | "NODE_CREATED"
    | "NODES_EXPORTED"
    | "EXECUTION_REPORT"
    | "ERROR";
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
  nodeIds?: string[];
}

export interface CodeExecutionError {
  type: "CODE_EXECUTION_ERROR";
  originalCode: string;
  errorMessage: string;
  errorStack: string;
  createdNodeIds: string[];
}

export interface FigmaContext {
  selectedNodes: Array<{
    id: string;
    name: string;
    type: string;
    componentName?: string;
    children?: FigmaContext[];
  }>;
  selectedNodesImage: Array<{
    nodeId: string;
    nodeName: string;
    nodeImage: number[] | string; // 전송시 number[] array, 변환 후 base64 string
  }>;
}

export interface NodeSummary {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
}

export interface NodeDetail extends NodeSummary {
  visible?: boolean;
  componentKey?: string | null;
  componentName?: string | null;
  variantProperties?: Record<string, string>;
  size?: {
    width: number;
    height: number;
  };
  layout?: {
    layoutMode?: string;
    primaryAxisAlignItems?: string;
    counterAxisAlignItems?: string;
    primaryAxisSizingMode?: string;
    counterAxisSizingMode?: string;
    itemSpacing?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    layoutWrap?: string;
    primaryAxisAlignContent?: string;
    counterAxisSpacing?: number;
    layoutGrow?: number;
    layoutAlign?: string;
    layoutPositioning?: string;
    layoutSizingHorizontal?: string;
    layoutSizingVertical?: string;
    minWidth?: number | null;
    maxWidth?: number | null;
    minHeight?: number | null;
    maxHeight?: number | null;
  };
  constraints?: {
    horizontal?: string;
    vertical?: string;
  };
  text?: {
    characters: string;
    textStyleId?: string;
    fontSize?: number;
    fontName?: { family: string; style: string };
    fontNames?: { family: string; style: string }[];
    fontFallbacks?: { family: string; style: string }[];
  };
  fills?: any;
  strokes?: any;
  effects?: any;
  boundVariables?: Record<string, string>;
  children?: NodeSummary[];
}

export interface UpdatedNodeSummary extends NodeSummary {
  changedProperties: string[];
  componentKey?: string | null;
  componentName?: string | null;
  variantProps?: Record<string, string>;
}

export interface ExecutionReport {
  timestamp: number;
  durationMs: number;
  executedCodeLength: number;
  createdNodes: NodeDetail[];
  updatedNodes: UpdatedNodeSummary[];
  deletedNodeIds: string[];
  selection: NodeSummary[];
  createdNodeIds: string[];
  message?: string;
  error?: string;
}

export class FigmaClient {
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  // 선택 변경 리스너 관리
  private selectionChangeListeners = new Set<
    (nodes: Array<{ id: string; name: string; type: string }>) => void
  >();

  private nodeDetailCache = new Map<string, NodeDetail>();
  private lastExecutionReport: ExecutionReport | null = null;

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        console.log("📨 [FigmaClient] Message received:", event.data);

        // Figma 플러그인으로부터의 메시지 처리 (ai-app과 동일한 형태)
        if (event.data.pluginMessage) {
          const { type, requestId, success, data } = event.data.pluginMessage;

          console.log("🔍 [FigmaClient] Plugin message:", {
            type,
            requestId,
            success,
            hasData: !!data,
          });

          // 선택 변경 이벤트 처리
          if (type === "SELECTION_CHANGED") {
            this.selectionChangeListeners.forEach((listener) => {
              listener(data.selectedNodes || []);
            });
            return;
          }

          // GET_CONTEXT 응답 처리
          if (type === "CONTEXT" && requestId) {
            this.handlePluginResponse({
              type,
              requestId,
              success: success !== false, // undefined인 경우도 true로 처리
              data,
              error: event.data.pluginMessage.error,
            } as FigmaResponse);
          } else {
            // 기타 응답 처리
            this.handlePluginResponse({
              type,
              requestId,
              success,
              data,
              error: event.data.pluginMessage.error,
            } as FigmaResponse);
          }
        }
      });

      console.log("📡 FigmaClient message listener registered");
    }
  }

  // Array를 base64로 변환하는 유틸리티 함수
  private arrayToBase64(array: number[]): string {
    const uint8Array = new Uint8Array(array);
    const binary = String.fromCharCode(...uint8Array);
    return btoa(binary);
  }

  private handlePluginResponse(response: FigmaResponse) {
    const request = this.pendingRequests.get(response.requestId);
    if (!request) {
      console.log(
        "🔍 [FigmaClient] No matching request for:",
        response.requestId,
      );
      return;
    }

    clearTimeout(request.timeout);
    this.pendingRequests.delete(response.requestId);

    // GET_CONTEXT 응답에서 이미지 배열을 base64로 변환
    if (response.type === "CONTEXT" && response.data?.selectedNodesImage) {
      response.data.selectedNodesImage = response.data.selectedNodesImage.map(
        (img: any) => ({
          ...img,
          nodeImage: this.arrayToBase64(img.nodeImage),
        }),
      );
      console.log(
        "🖼️ [FigmaClient] Images converted to base64:",
        response.data.selectedNodesImage.length,
      );
    }

    if (response.success) {
      console.log(
        "✅ [FigmaClient] Response success:",
        response.type,
        response.data,
      );

      if (response.type === "CONTEXT_DETAIL" && response.data?.id) {
        this.nodeDetailCache.set(response.data.id, response.data as NodeDetail);
      }

      if (response.type === "EXECUTION_REPORT") {
        this.lastExecutionReport = (response.data ||
          null) as ExecutionReport | null;
      }

      request.resolve(response.data);
    } else if (response.type === "CODE_EXECUTION_ERROR") {
      // 코드 실행 에러는 특별한 형태로 reject
      const codeError = new Error(
        response.data?.errorMessage || "Code execution failed",
      ) as any;
      codeError.type = "CODE_EXECUTION_ERROR";
      codeError.originalCode = response.data?.originalCode;
      codeError.errorMessage = response.data?.errorMessage;
      codeError.errorStack = response.data?.errorStack;
      codeError.createdNodeIds = response.data?.createdNodeIds || [];
      request.reject(codeError);
    } else {
      request.reject(new Error(response.error || "Plugin execution failed"));
    }
  }

  private sendCommand<T = any>(
    command: FigmaCommand,
    timeoutMs = 30000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(
          new Error("FigmaClient can only be used in browser environment"),
        );
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(command.requestId);
        reject(new Error("Figma Plugin request timeout"));
      }, timeoutMs) as unknown as NodeJS.Timeout;

      this.pendingRequests.set(command.requestId, {
        resolve,
        reject,
        timeout,
      });

      // Check if running in iframe context (inside Figma plugin)
      if (window.parent !== window) {
        // Send to parent window (Figma plugin) with 'from' identifier - ai-app과 동일한 형태
        window.parent.postMessage(
          {
            pluginMessage: { ...command, from: "ai-app" },
          },
          "*",
        );
      } else {
        reject(new Error("Not running in Figma plugin context"));
        return;
      }
    });
  }

  // Public API Methods

  async executeCode(code: string): Promise<{
    success: boolean;
    createdNodeIds: string[];
    executionTime: number;
    executionReport: ExecutionReport | null;
    error?: string;
    executionLog?: any;
  }> {
    try {
      const response = await this.sendCommand<{
        createdNodeIds?: string[];
        executionTime?: number;
        executionLog?: any;
        executionReport?: ExecutionReport;
      }>({
        type: "EXECUTE_CODE",
        requestId: `exec-${Date.now()}`,
        code,
      });

      if (response.executionReport) {
        this.lastExecutionReport = response.executionReport;
      }

      return {
        success: true,
        createdNodeIds:
          response.createdNodeIds ||
          response.executionReport?.createdNodeIds ||
          [],
        executionTime:
          response.executionTime || response.executionReport?.durationMs || 0,
        executionLog: response.executionLog, // 실행 로그 포함
        executionReport: this.lastExecutionReport,
      };
    } catch (error: any) {
      // CODE_EXECUTION_ERROR는 ChatInterface에서 처리하도록 다시 throw
      if (error.type === "CODE_EXECUTION_ERROR") {
        throw error;
      }

      return {
        success: false,
        createdNodeIds: [],
        executionTime: 0,
        error: error instanceof Error ? error.message : String(error),
        executionLog: error.data?.executionLog, // 에러 시에도 실행 로그 포함
        executionReport: this.lastExecutionReport,
      };
    }
  }

  async getContext(): Promise<FigmaContext | null> {
    try {
      const contextData = await this.sendCommand<FigmaContext>({
        type: "GET_CONTEXT",
        requestId: `context-${Date.now()}`,
      });

      console.log("📡 [FigmaClient] Context received:", contextData);
      return contextData;
    } catch (error) {
      console.error("Failed to get Figma context:", error);
      return null;
    }
  }

  async getNodeDetail(
    nodeId: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<NodeDetail | null> {
    if (!options.forceRefresh && this.nodeDetailCache.has(nodeId)) {
      return this.nodeDetailCache.get(nodeId) || null;
    }

    try {
      const detail = await this.sendCommand<NodeDetail>({
        type: "GET_CONTEXT_DETAIL",
        requestId: `detail-${nodeId}-${Date.now()}`,
        nodeId,
      });

      if (detail?.id) {
        this.nodeDetailCache.set(nodeId, detail);
        return detail;
      }

      return null;
    } catch (error) {
      console.warn("Failed to get node detail", error);
      return this.nodeDetailCache.get(nodeId) || null;
    }
  }

  async getExecutionReport(
    forceRefresh = false,
  ): Promise<ExecutionReport | null> {
    if (!forceRefresh && this.lastExecutionReport) {
      return this.lastExecutionReport;
    }

    try {
      const report = await this.sendCommand<ExecutionReport | null>({
        type: "REPORT_EXECUTION",
        requestId: `report-${Date.now()}`,
      });

      this.lastExecutionReport = report || null;
      return this.lastExecutionReport;
    } catch (error) {
      console.warn("Failed to get execution report", error);
      return this.lastExecutionReport;
    }
  }

  async createNode(
    nodeType: FigmaCommand["nodeType"],
    properties: Record<string, any>,
  ): Promise<{ success: boolean; nodeId?: string; error?: string }> {
    try {
      const response = await this.sendCommand<FigmaResponse>({
        type: "CREATE_NODE",
        requestId: `create-${Date.now()}`,
        nodeType,
        properties,
      });

      return {
        success: response.success,
        nodeId: response.data?.nodeId,
        error: response.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async exportNodes(nodeIds: string[]): Promise<{
    success: boolean;
    images?: Array<{ nodeId: string; url: string }>;
    error?: string;
  }> {
    try {
      const response = await this.sendCommand<FigmaResponse>({
        type: "EXPORT_NODES",
        requestId: `export-${Date.now()}`,
        nodeIds,
      });

      return {
        success: response.success,
        images: response.data?.images,
        error: response.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Selection change listener methods

  onSelectionChange(
    callback: (
      nodes: Array<{ id: string; name: string; type: string }>,
    ) => void,
  ) {
    this.selectionChangeListeners.add(callback);
  }

  offSelectionChange(
    callback: (
      nodes: Array<{ id: string; name: string; type: string }>,
    ) => void,
  ) {
    this.selectionChangeListeners.delete(callback);
  }

  // Utility methods

  dispose() {
    // Clear pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error("FigmaClient disposed"));
    }
    this.pendingRequests.clear();

    // Clear selection listeners
    this.selectionChangeListeners.clear();

    this.nodeDetailCache.clear();
    this.lastExecutionReport = null;
  }
}

// Export singleton instance
export const figmaClient = new FigmaClient();

"use client";

import { useTabsDB } from "@/hooks/useTabsDB";
import type {
  CollectedContext,
  ExecutionReport,
  FigmaCodeWorkflowState,
  RequestedContext,
  RunLogEntry,
} from "@/lib/types/workflow-types";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ConversationTab, Message } from "../types/tabs";


interface StreamingMessage {
  id: string;
  content: string;
  streaming: boolean;
}

interface WorkflowStepResponse {
  success: boolean;
  completed: boolean;
  step: string;
  nextStep: string;
  state?: FigmaCodeWorkflowState;
  requestedContext: RequestedContext;
  timestamp: number;
  error?: string;
}

export function ChatInterface({ tab }: { tab: ConversationTab }) {
  const { addMessage, getTabMessages, updateFigmaContext } = useTabsDB();

  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDebugPane, setShowDebugPane] = useState(false);
  const [latestExecutionReport, setLatestExecutionReport] =
    useState<ExecutionReport | null>(null);
  const [workflowRunLog, setWorkflowRunLog] = useState<RunLogEntry[]>([]);
  const [runLogFilter, setRunLogFilter] = useState<string>("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const workflowStateRef = useRef<Record<string, FigmaCodeWorkflowState>>({});
  const thoughtCountRef = useRef<Map<string, number>>(new Map());

  // 선택된 노드 상태
  const [figmaContext, setFigmaContext] = useState<any>(null);
  const [currentSelection, setCurrentSelection] = useState<
    Array<{
      id: string;
      name: string;
      type: string;
    }>
  >([]);

  // 로컬 스트리밍 상태
  const [streamingMessages, setStreamingMessages] = useState<
    Map<string, StreamingMessage>
  >(new Map());

  // 비동기 데이터 상태
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // 탭 변경 시 메시지 로드
  useEffect(() => {
    const loadTabData = async () => {
      setIsLoadingData(true);
      try {
        const tabMessages = await getTabMessages(tab.id);
        setMessages(tabMessages);
      } catch (error) {
        console.error("Failed to load tab data:", error);
      } finally {
        setIsLoadingData(false);
      }
    };

    loadTabData();
  }, [tab.id, getTabMessages]);

  // Figma 선택 변경 리스너 등록
  useEffect(() => {
    const { figmaClient } = require("@/lib/figma/figma-client");

    const handleSelectionChange = (
      nodes: Array<{ id: string; name: string; type: string }>,
    ) => {
      setCurrentSelection(nodes);
    };

    figmaClient.onSelectionChange(handleSelectionChange);

    return () => {
      figmaClient.offSelectionChange(handleSelectionChange);
    };
  }, []);

  // 스트리밍 메시지 업데이트 (로컬 상태만)
  const updateLocalStreamingMessage = (messageId: string, content: string) => {
    setStreamingMessages((prev) => {
      const newMap = new Map(prev);
      newMap.set(messageId, { id: messageId, content, streaming: true });
      return newMap;
    });
  };

  const hasPendingRequests = (requestedContext?: RequestedContext) => {
    if (!requestedContext) return false;
    return (
      (requestedContext.nodeIds?.length ?? 0) > 0 ||
      (requestedContext.assets?.length ?? 0) > 0 ||
      (requestedContext.questions?.length ?? 0) > 0
    );
  };

  const fulfillRequestedContext = async (
    requestedContext: WorkflowStepResponse["requestedContext"],
  ): Promise<CollectedContext> => {
    try {
      const { figmaClient } = await import("@/lib/figma/figma-client");
      const context = await figmaClient.getContext();

      const nodeDetails: Record<string, any> = {};
      for (const id of requestedContext.nodeIds) {
        const detail = await figmaClient.getNodeDetail(id, {
          forceRefresh: true,
        });
        if (detail) {
          nodeDetails[id] = detail;
          continue;
        }

        const fallback = context?.selectedNodes?.find((node) => node.id === id);
        if (fallback) {
          nodeDetails[id] = fallback;
        }
      }

      const answers: Record<string, string> = {};
      requestedContext.questions.forEach((question, index) => {
        answers[`question_${index}`] = `추가 정보 필요: ${question}`;
      });

      const assets: Record<string, any> = {};
      for (const assetRequest of requestedContext.assets) {
        if (assetRequest.type === "execution_report") {
          const report = await figmaClient.getExecutionReport(true);
          assets.execution_report = report ?? {
            timestamp: Date.now(),
            durationMs: 0,
            executedCodeLength: 0,
            createdNodes: [],
            updatedNodes: [],
            deletedNodeIds: [],
            selection: [],
            createdNodeIds: [],
            error: "Execution report unavailable",
          };
        }
      }

      return {
        nodeDetails,
        assets,
        answers,
      };
    } catch (error) {
      console.warn("컨텍스트 수집 실패", error);
      return {
        nodeDetails: {},
        assets: {},
        answers: {},
      };
    }
  };

  const appendThoughts = (
    streamingMessageId: string,
    state: FigmaCodeWorkflowState,
    accumulated: string,
  ) => {
    const previousCount = thoughtCountRef.current.get(streamingMessageId) ?? 0;
    const thoughts: string[] = Array.isArray(state?.thoughts)
      ? state.thoughts
      : [];
    const newThoughts = thoughts.slice(previousCount);
    if (newThoughts.length > 0) {
      const formatted = newThoughts.join("\n");
      const updatedContent = `${accumulated}${formatted}\n`;
      updateLocalStreamingMessage(streamingMessageId, updatedContent);
      thoughtCountRef.current.set(streamingMessageId, thoughts.length);
      return updatedContent;
    }
    return accumulated;
  };

  // Figma 코드 실행 함수
  const executeFigmaCode = async (
    figmaCode: string,
    messageId: string,
    currentContent: string,
  ): Promise<string> => {
    try {
      const { figmaClient } = await import("@/lib/figma/figma-client");
      const executionResult = await figmaClient.executeCode(figmaCode);
      const executionReport =
        executionResult.executionReport ||
        (await figmaClient.getExecutionReport(true));

      let updatedContent =
        currentContent + `\n🚀 **Figma에서 코드 실행 중...**\n`;

      if (executionResult.success) {
        updatedContent += `\n🎆 **실행 완료:** ${executionResult.createdNodeIds.length}개 노드가 생성되었습니다!\n`;
        if (executionReport) {
          const durationSec = (executionReport.durationMs / 1000).toFixed(2);
          updatedContent += `⏱️ 실행 시간: ${durationSec}초, 추적 노드: ${executionReport.createdNodeIds.length}개\n`;
          if (executionReport.selection?.length) {
            const selectionNames = executionReport.selection
              .slice(0, 5)
              .map((node) => `• ${node.name} (${node.type})`)
              .join("\n");
            updatedContent += `선택 요약:\n${selectionNames}\n`;
            if (executionReport.selection.length > 5) {
              updatedContent += `...외 ${executionReport.selection.length - 5}개 노드\n`;
            }
          }
          if (executionReport.updatedNodes?.length) {
            const updatedSummary = executionReport.updatedNodes
              .slice(0, 5)
              .map(
                (node) =>
                  `• ${node.name} (${node.type}) → ${node.changedProperties.join(", ")}`,
              )
              .join("\n");
            updatedContent += `수정된 노드:\n${updatedSummary}\n`;
            if (executionReport.updatedNodes.length > 5) {
              updatedContent += `...외 ${executionReport.updatedNodes.length - 5}개 노드 수정\n`;
            }
          }
          if (executionReport.deletedNodeIds?.length) {
            const deletedPreview = executionReport.deletedNodeIds
              .slice(0, 5)
              .map((id) => `• ${id}`)
              .join("\n");
            updatedContent += `삭제된 노드 ID:\n${deletedPreview}\n`;
            if (executionReport.deletedNodeIds.length > 5) {
              updatedContent += `...외 ${executionReport.deletedNodeIds.length - 5}개 삭제\n`;
            }
          }
        }
      } else {
        updatedContent += `\n❌ **실행 실패:** ${executionResult.error}\n`;
        if (executionReport?.error) {
          updatedContent += `에러 상세: ${executionReport.error}\n`;
        }
      }

      updateLocalStreamingMessage(messageId, updatedContent);
      return updatedContent;
    } catch (execError: any) {
      const errorMessage =
        execError.errorMessage || execError.message || String(execError);
      const errorContent =
        currentContent + `\n💥 **실행 중 오류:** ${errorMessage}\n`;
      updateLocalStreamingMessage(messageId, errorContent);
      return errorContent;
    }
  };

  // 스트리밍 완료 (최종 메시지를 탭 상태에 저장)
  const completeStreamingMessage = async (
    messageId: string,
    content: string,
  ) => {
    const assistantMessageId = await addMessage(tab.id, {
      role: "assistant",
      content,
      streaming: false,
      figmaContext,
    });

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content,
      timestamp: new Date(),
      streaming: false,
      figmaContext,
    };
    setMessages((prev) => [...prev, assistantMessage]);

    setStreamingMessages((prev) => {
      const newMap = new Map(prev);
      newMap.delete(messageId);
      return newMap;
    });
  };

  // 스트리밍 메시지를 기존 메시지와 합치기
  const combinedMessages = [...messages];
  streamingMessages.forEach((streamingMsg) => {
    const existingIndex = combinedMessages.findIndex(
      (msg) => msg.id === streamingMsg.id,
    );
    if (existingIndex >= 0) {
      combinedMessages[existingIndex] = {
        ...combinedMessages[existingIndex],
        content: streamingMsg.content,
        streaming: true,
      };
    } else {
      combinedMessages.push({
        id: streamingMsg.id,
        role: "assistant",
        content: streamingMsg.content,
        timestamp: new Date(),
        streaming: true,
        figmaContext: null,
      } as Message);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingMessages, messages]);

  // 선택된 노드 정보 업데이트 함수
  const updateSelectedNodes = async () => {
    try {
      const { figmaClient } = await import("@/lib/figma/figma-client");
      const context = await figmaClient.getContext();

      if (context) {
        setFigmaContext(context);
        return context;
      } else {
        setFigmaContext(null);
        return null;
      }
    } catch (error) {
      console.warn("Failed to update selected nodes:", error);
      return null;
    }
  };

  // 컴포넌트 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      thoughtCountRef.current.clear();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isProcessing) return;

    const userContent = inputValue.trim();

    // 제출 시에만 현재 Figma 컨텍스트 업데이트
    const currentContext = await updateSelectedNodes();

    // 탭에 사용자 메시지 추가
    const userMessageId = await addMessage(tab.id, {
      role: "user",
      content: userContent,
      figmaContext: currentContext,
    });

    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: userContent,
      timestamp: new Date(),
      figmaContext: currentContext,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsProcessing(true);
    setWorkflowRunLog([]);
    setLatestExecutionReport(null);
    setRunLogFilter("all");

    try {
      const streamingMessageId = uuidv4();

      setStreamingMessages((prev) => {
        const newMap = new Map(prev);
        newMap.set(streamingMessageId, {
          id: streamingMessageId,
          content: "",
          streaming: true,
        });
        return newMap;
      });

      await runStepWorkflow(
        tab.id,
        userContent,
        streamingMessageId,
        currentContext,
      );
    } catch (error) {
      console.error("Workflow failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const runStepWorkflow = async (
    tabId: string,
    userMessage: string,
    streamingMessageId: string,
    latestFigmaContext: any,
  ) => {
    let accumulatedContent = "🧠 워크플로우를 준비하고 있습니다...\n";
    updateLocalStreamingMessage(streamingMessageId, accumulatedContent);
    thoughtCountRef.current.set(streamingMessageId, 0);

    let currentState: FigmaCodeWorkflowState | undefined;
    let contextUpdate: CollectedContext | undefined;
    let action: "start" | "continue" = "start";
    let iteration = 0;

    const serializeHistory = () =>
      messages.map((msg) => {
        const timestamp = msg.timestamp
          ? msg.timestamp instanceof Date
            ? msg.timestamp.getTime()
            : new Date(msg.timestamp).getTime()
          : Date.now();
        return {
          role: msg.role,
          content: msg.content,
          timestamp,
        };
      });

    try {
      while (iteration < 25) {
        const payload: any =
          action === "start"
            ? {
                action: "start",
                userPrompt: userMessage,
                figmaContext: latestFigmaContext,
                conversationHistory: serializeHistory(),
                previousError: null,
              }
            : {
                action: "continue",
                state: currentState,
                contextUpdate,
              };

        const response = await fetch("/api/workflow/step", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result: WorkflowStepResponse = await response.json();

        if (!result.success || !result.state) {
          throw new Error(result.error || "워크플로우 스텝 실행 실패");
        }

        accumulatedContent += `\n➡️ 스텝 '${result.step}' 실행 완료`;
        updateLocalStreamingMessage(streamingMessageId, accumulatedContent);

        currentState = result.state;
        workflowStateRef.current[tabId] = currentState;
        const runLog = currentState.runLog || [];
        setWorkflowRunLog(runLog);
        if (
          runLogFilter !== "all" &&
          !runLog.some((entry) => entry.step === runLogFilter)
        ) {
          setRunLogFilter("all");
        }
        setLatestExecutionReport(currentState.executionReport || null);

        accumulatedContent = appendThoughts(
          streamingMessageId,
          currentState,
          accumulatedContent,
        );

        if (result.completed || currentState.isComplete) {
          if (currentState.generatedCode) {
            accumulatedContent += "\n✨ **코드 생성 완료!**\n";
            updateLocalStreamingMessage(streamingMessageId, accumulatedContent);
            const updatedContent = await executeFigmaCode(
              currentState.generatedCode,
              streamingMessageId,
              accumulatedContent,
            );
            await completeStreamingMessage(streamingMessageId, updatedContent);
          } else {
            await completeStreamingMessage(
              streamingMessageId,
              accumulatedContent,
            );
          }
          break;
        }

        if (hasPendingRequests(result.requestedContext)) {
          accumulatedContent += "\n📥 추가 컨텍스트 수집 중...\n";
          updateLocalStreamingMessage(streamingMessageId, accumulatedContent);
          contextUpdate = await fulfillRequestedContext(
            result.requestedContext,
          );
          const collectedSummary: string[] = [];
          if (
            contextUpdate &&
            Object.keys(contextUpdate.nodeDetails ?? {}).length > 0
          ) {
            collectedSummary.push(
              `${Object.keys(contextUpdate.nodeDetails).length}개 노드 세부 정보를 확보했습니다.`,
            );
          }
          if (
            contextUpdate &&
            Object.keys(contextUpdate.answers ?? {}).length > 0
          ) {
            collectedSummary.push(
              `${Object.keys(contextUpdate.answers).length}개 질문에 임시 답변을 작성했습니다.`,
            );
          }
          if (contextUpdate?.assets?.execution_report) {
            collectedSummary.push("실행 리포트를 확보했습니다.");
          }
          if (collectedSummary.length > 0) {
            accumulatedContent += collectedSummary.join(" ") + "\n";
            updateLocalStreamingMessage(streamingMessageId, accumulatedContent);
          }
        } else {
          contextUpdate = undefined;
        }

        action = "continue";
        iteration += 1;
      }

      if (iteration >= 25) {
        throw new Error("워크플로우 반복 한도를 초과했습니다");
      }

      if (!currentState?.isComplete && !currentState?.error) {
        accumulatedContent += "\n⏭️ 다음 스텝을 진행합니다...\n";
        updateLocalStreamingMessage(streamingMessageId, accumulatedContent);
      }
    } catch (error: any) {
      console.error("Step workflow failed:", error);
      const errorMessage =
        accumulatedContent +
        `\n\n❌ **워크플로우 실패:** ${error instanceof Error ? error.message : String(error)}\n`;
      await completeStreamingMessage(streamingMessageId, errorMessage);
    }
  };

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No active conversation
      </div>
    );
  }

  const runLogSteps = Array.from(
    new Set(workflowRunLog.map((entry) => entry.step)),
  );
  const filteredRunLog =
    runLogFilter === "all"
      ? workflowRunLog
      : workflowRunLog.filter((entry) => entry.step === runLogFilter);

  return (
    <div
      style={{
        height: "calc(100% - 106px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 현재 선택된 노드 표시 */}
      {currentSelection.length > 0 && (
        <div
          style={{
            padding: 8,
            background: "rgba(0,0,0,0.03)",
            borderBottom: `1px solid rgba(0,0,0,0.1)`,
            borderRadius: "8px 8px 0 0",
          }}
        >
          <div
            style={{
              padding: "8px 0",
              gap: 4,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <p
              style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}
            >
              📌 선택된 노드:
            </p>
            {currentSelection.map((node) => (
              <div
                key={node.id}
                style={{
                  background: "rgba(0,0,0,0.03)",
                  color: "rgba(0,0,0,0.8)",
                }}
              >
                {node.name || "이름 없음"}{" "}
                <span style={{ opacity: 0.7 }}>({node.type})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ justifyContent: "flex-end", padding: "8px 8px 0" }}>
        <button
          onClick={() => setShowDebugPane((prev) => !prev)}
        >
          {showDebugPane ? "디버그 닫기" : "디버그 정보"}
        </button>
      </div>

      {/* 메시지 목록 */}
      <div
        style={{ flexDirection: "column", flex: 1, gap: 12, padding: 8 }}
      >
        {isLoadingData ? (
          <div
            style={{
              padding: 8,
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 600 }}>
              💭 대화 내용을 불러오는 중...
            </span>
          </div>
        ) : combinedMessages.length === 0 ? (
          <div style={{ padding: 8, flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600 }}>
              Claude Code for Figma Designer
            </span>
            <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
              어떤 디자인을 만들어드릴까요?
            </span>
          </div>
        ) : (
          combinedMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {showDebugPane && (
        <div
          style={{
            flexDirection: "column",
            gap: 8,
            padding: 12,
            background: "rgba(0,0,0,0.03)",
            borderTop: `1px solid rgba(0,0,0,0.1)`,
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 600 }}>실행 리포트</span>
          {latestExecutionReport ? (
            <div>
              <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
                완료 시각:{" "}
                {new Date(latestExecutionReport.timestamp).toLocaleString()}
              </span>
              <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
                실행 시간:{" "}
                {(latestExecutionReport.durationMs / 1000).toFixed(2)}초
              </span>
              <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
                생성: {latestExecutionReport.createdNodes?.length ?? 0}개 /
                수정:
                {latestExecutionReport.updatedNodes?.length ?? 0}개 / 삭제:
                {latestExecutionReport.deletedNodeIds?.length ?? 0}개
              </span>
              {latestExecutionReport.error && (
                <span style={{ fontSize: 14, color: "rgba(0,0,0,0.8)" }}>
                  {latestExecutionReport.error}
                </span>
              )}
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  생성 노드
                </span>
                {latestExecutionReport.createdNodes?.length ? (
                  <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                    {latestExecutionReport.createdNodes
                      .slice(0, 5)
                      .map((node) => (
                        <li key={`created-${node.id}`}>
                          <details>
                            <summary>
                              {node.name} ({node.type})
                            </summary>
                            <pre style={{ whiteSpace: "pre-wrap" }}>
                              {JSON.stringify(node, null, 2)}
                            </pre>
                          </details>
                        </li>
                      ))}
                    {latestExecutionReport.createdNodes.length > 5 && (
                      <li>
                        ...외 {latestExecutionReport.createdNodes.length - 5}개
                      </li>
                    )}
                  </ul>
                ) : (
                  <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>생성된 노드 없음</span>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  수정 노드
                </span>
                {latestExecutionReport.updatedNodes?.length ? (
                  <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                    {latestExecutionReport.updatedNodes
                      .slice(0, 5)
                      .map((node) => (
                        <li key={`updated-${node.id}`}>
                          <details>
                            <summary
                              style={{
                                display: "flex",
                                gap: 6,
                                alignItems: "center",
                              }}
                            >
                              <span>
                                {node.name} ({node.type})
                              </span>
                              <span
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                }}
                              >
                                {node.changedProperties.map((prop) => (
                                  <span
                                    key={`${node.id}-${prop}`}
                                  >
                                    {prop}
                                  </span>
                                ))}
                              </span>
                            </summary>
                            <pre style={{ whiteSpace: "pre-wrap" }}>
                              {JSON.stringify(node, null, 2)}
                            </pre>
                          </details>
                        </li>
                      ))}
                    {latestExecutionReport.updatedNodes.length > 5 && (
                      <li>
                        ...외 {latestExecutionReport.updatedNodes.length - 5}개
                      </li>
                    )}
                  </ul>
                ) : (
                  <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>수정된 노드 없음</span>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  삭제 노드 ID
                </span>
                {latestExecutionReport.deletedNodeIds?.length ? (
                  <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
                    {latestExecutionReport.deletedNodeIds.join(", ")}
                    </span>
                ) : (
                    <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>삭제된 노드 없음</span>
                )}
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
              수집된 실행 리포트가 없습니다.
            </span>
          )}

            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>
            Run Log
          </span>
          {workflowRunLog.length > 0 && (
            <div style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                onClick={() => setRunLogFilter("all")}
              >
                전체
              </button>
              {runLogSteps.map((step) => (
                <button
                  key={`runlog-step-${step}`}
                  onClick={() => setRunLogFilter(step)}
                >
                  {step}
                </button>
              ))}
            </div>
          )}
          {filteredRunLog.length === 0 ? (
            <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>아직 기록이 없습니다.</span>
          ) : (
            <div
              style={{
                maxHeight: 160,
                overflowY: "auto",
                background: "white",
                borderRadius: 8,
                padding: 8,
                border: `1px solid rgba(0,0,0,0.1)`,
              }}
            >
              {filteredRunLog.map((entry, index) => (
                <div
                  key={`${entry.step}-${entry.timestamp}-${index}`}
                  style={{ marginBottom: 6 }}
                >
                  <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)" }}>
                    [{new Date(entry.timestamp).toLocaleTimeString()}]{" "}
                    {entry.step}
                  </span>
                  <span style={{ fontSize: 14, color: "rgba(0,0,0,0.5)", opacity: 0.8 }}>
                    {entry.summary}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 입력 폼 */}
      <form
        onSubmit={handleSubmit}
        style={{
          position: "sticky",
          bottom: 0,
          width: "100%",
          background: "white",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.1)",
          padding: 8,
        }}
      >
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputValue(e.target.value)}
            placeholder="예: 로그인 버튼을 만들어주세요"
            disabled={isProcessing}
          />
        </div>
        <div style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="submit"
            disabled={isProcessing || !inputValue.trim()}
          />
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const formatContent = (content: string) => {
    if (!content || content.trim() === "") {
      return message.streaming
        ? "🧠 AI가 생각하고 있습니다..."
        : "내용이 없습니다.";
    }

    // 마크다운 볼드 처리
    let formattedContent = content.replace(
      /\*\*(.*?)\*\*/g,
      "<strong>$1</strong>",
    );

    // 이모지와 함께 있는 상태 표시 강조
    formattedContent = formattedContent.replace(
      /(⚡|🧠|🎨|✨|💡|❌)\s*([^<\n]+)/g,
      '<span class="text-yellow-300">$1</span> <strong>$2</strong>',
    );

    return formattedContent;
  };

  return (
    <div
      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
    >
      <div 
        style={{
          maxWidth: "100%",
        }}
      >
        <div
          className="whitespace-pre-wrap"
          style={{
            textAlign: message.role === "user" ? "right" : "left",
          }}
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
        />

        {message.streaming && (
          <div className="flex items-center mt-2 text-sm opacity-70">
            <div className="animate-spin w-3 h-3 border border-gray-400 border-t-transparent rounded-full mr-2"></div>
            AI가 응답하고 있습니다...
          </div>
        )}
      </div>
    </div>
  );
}

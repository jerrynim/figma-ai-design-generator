import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, StateGraph } from "@langchain/langgraph";
import { FigmaContext } from "../figma/figma-client";
import { getComponentGuides } from "../guides/component-guide";
import {
  createGenerationPrompt,
  LearningPromptContext,
} from "../prompts/generation-prompt";
import { analyzePlanningPrompt } from "../prompts/planning-prompt";
import { TypeScriptValidator } from "../services/typescript-validator";
import {
  BlueprintScreen,
  ExecutionReport,
  FigmaCodeWorkflowState as NewWorkflowState,
  PlanningResult,
  ProductBlueprint,
  RequestedContext,
  ScenarioLayoutStrategy,
  TodoDesign,
  TodoItem
} from "../types/workflow-types";

// Export the new workflow state
export type FigmaCodeWorkflowState = NewWorkflowState;

// Claude API Setup
const claude = new ChatAnthropic({
  modelName: "claude-4-5-haiku",
  temperature: 0.1,
  maxTokens: 4000,
  apiKey: process.env.NEXT_ANTHROPIC_API_KEY,
});

const WORKFLOW_STATE_VERSION = "2025-01-step-alpha";

const EMPTY_REQUESTED_CONTEXT: RequestedContext = {
  nodeIds: [],
  assets: [],
  questions: [],
};

type ContextUpdatePayload = {
  nodeDetails?: Record<string, any>;
  assets?: Record<string, any>;
  answers?: Record<string, string>;
};

interface StepExecutionOptions {
  contextUpdate?: ContextUpdatePayload;
  autoAdvance?: boolean;
}

interface StepResult {
  state: FigmaCodeWorkflowState;
  completed: boolean;
  step: string;
  nextStep: string;
  requestedContext: RequestedContext;
}

export class FigmaCodeGenerateWorkflow {
  private onThoughtCallback?: (thought: string) => void;
  private onProgressCallback?: (
    message: string,
    type: "thinking" | "complete" | "error",
  ) => void;
  private validator: TypeScriptValidator;

  constructor(
    onThoughtCallback?: (thought: string) => void,
    onProgressCallback?: (
      message: string,
      type: "thinking" | "complete" | "error",
    ) => void,
  ) {
    this.onThoughtCallback = onThoughtCallback;
    this.onProgressCallback = onProgressCallback;
    this.validator = new TypeScriptValidator();
  }

  createInitialState(
    userPrompt: string,
    figmaContext?: FigmaContext,
    conversationHistory?: Array<any>,
    previousError?: string,
  ): FigmaCodeWorkflowState {
    const initialState: FigmaCodeWorkflowState = {
      userPrompt,
      figmaContext,
      conversationHistory,
      plan: undefined,
      analysis: undefined,
      design: undefined,
      generation: undefined,
      validation: undefined,
      execution: undefined,
      verification: undefined,
      blueprint: undefined,
      componentGuides: undefined,
      currentStep: "product-blueprint",
      retryCount: 0,
      maxRetries: 3,
      partialRetry: false,
      stateVersion: WORKFLOW_STATE_VERSION,
      stepHistory: [],
      requestedContext: { ...EMPTY_REQUESTED_CONTEXT },
      collectedContext: {
        nodeDetails: {},
        assets: {},
        answers: {},
      },
      learning: previousError,
      errorHistory: [],
      successPatterns: [],
      thoughts: [],
      messages: [],
      isComplete: false,
      error: undefined,
      lastUpdatedAt: Date.now(),
      runLog: [],
      executionReport: undefined,
    };

    return initialState;
  }

  async executeStep(
    rawState: FigmaCodeWorkflowState | Partial<FigmaCodeWorkflowState>,
    options: StepExecutionOptions = {},
  ): Promise<StepResult> {
    const state = this.ensureStateDefaults(rawState);

    if (options.contextUpdate) {
      this.applyContextUpdate(state, options.contextUpdate);
    }

    const step = state.currentStep || "product-blueprint";

    switch (step) {
      case "product-blueprint":
        await this.buildProductBlueprint(state);
        break;
      case "planning":
        await this.planStrategy(state);
        break;
      case "figma-design":
        await this.designTodos(state);
        break;
      case "generate":
        await this.generateCode(state);
        break;
      case "validate":
        await this.validateCode(state);
        break;
      case "execute":
        await this.executeCode(state);
        break;
      case "verify":
        await this.verifyExecution(state);
        break;
      case "handleError":
        await this.handleError(state);
        break;
      case "complete":
        // No-op, already complete
        state.isComplete = true;
        break;
      default:
        state.error = `알 수 없는 스텝입니다: ${step}`;
        state.isComplete = true;
        state.currentStep = "complete";
        break;
    }

    state.stepHistory.push(step);
    state.lastStepCompleted = step;
    state.lastUpdatedAt = Date.now();

    const nextStep = state.currentStep;
    const summaryThought = state.thoughts[state.thoughts.length - 1];
    this.appendRunLog(state, step, summaryThought || `${step} 단계 완료`);

    return {
      state,
      completed: state.isComplete === true,
      step,
      nextStep,
      requestedContext: this.cloneRequestedContext(
        state.requestedContext ?? EMPTY_REQUESTED_CONTEXT,
      ),
    };
  }

  private ensureStateDefaults(
    rawState: FigmaCodeWorkflowState | Partial<FigmaCodeWorkflowState>,
  ): FigmaCodeWorkflowState {
    const baseState = rawState as FigmaCodeWorkflowState;

    baseState.thoughts = baseState.thoughts ?? [];
    baseState.messages = baseState.messages ?? [];
    baseState.errorHistory = baseState.errorHistory ?? [];
    baseState.successPatterns = baseState.successPatterns ?? [];
    baseState.stepHistory = baseState.stepHistory ?? [];
    baseState.collectedContext = baseState.collectedContext ?? {
      nodeDetails: {},
      assets: {},
      answers: {},
    };
    baseState.collectedContext.assets = baseState.collectedContext.assets ?? {};
    baseState.componentGuides = baseState.componentGuides ?? undefined;
    baseState.runLog = baseState.runLog ?? [];
    baseState.executionReport = baseState.executionReport ?? undefined;
    baseState.requestedContext = baseState.requestedContext
      ? this.cloneRequestedContext(baseState.requestedContext)
      : { ...EMPTY_REQUESTED_CONTEXT };
    baseState.stateVersion = baseState.stateVersion ?? WORKFLOW_STATE_VERSION;
    baseState.currentStep = baseState.currentStep ?? "product-blueprint";
    baseState.retryCount = baseState.retryCount ?? 0;
    baseState.maxRetries = baseState.maxRetries ?? 3;
    baseState.partialRetry = baseState.partialRetry ?? false;
    baseState.isComplete = baseState.isComplete ?? false;

    return baseState;
  }

  private applyContextUpdate(
    state: FigmaCodeWorkflowState,
    update: ContextUpdatePayload,
  ) {
    if (!update) return;

    if (update.nodeDetails) {
      state.collectedContext.nodeDetails = {
        ...state.collectedContext.nodeDetails,
        ...update.nodeDetails,
      };
    }

    if (update.assets) {
      state.collectedContext.assets = {
        ...state.collectedContext.assets,
        ...update.assets,
      };
    }

    if (update.answers) {
      state.collectedContext.answers = {
        ...state.collectedContext.answers,
        ...update.answers,
      };
    }
  }

  private cloneRequestedContext(context: RequestedContext): RequestedContext {
    return {
      nodeIds: [...(context?.nodeIds ?? [])],
      assets: [...(context?.assets ?? [])].map((asset) => ({ ...asset })),
      questions: [...(context?.questions ?? [])],
    };
  }

  private appendRunLog(
    state: FigmaCodeWorkflowState,
    step: string,
    summary: string,
  ) {
    if (!state.runLog) {
      state.runLog = [];
    }

    state.runLog.push({
      step,
      timestamp: Date.now(),
      summary,
      requestedContext: this.cloneRequestedContext(
        state.requestedContext ?? EMPTY_REQUESTED_CONTEXT,
      ),
    });
  }

  private hasPendingRequests(context: RequestedContext): boolean {
    if (!context) return false;
    const hasNodes = (context.nodeIds ?? []).length > 0;
    const hasAssets = (context.assets ?? []).length > 0;
    const hasQuestions = (context.questions ?? []).length > 0;
    return hasNodes || hasAssets || hasQuestions;
  }

  private clearRequestedContext(state: FigmaCodeWorkflowState) {
    state.requestedContext = { ...EMPTY_REQUESTED_CONTEXT };
  }

  private async buildProductBlueprint(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = "🗺️ 제품 블루프린트 작성 중...";
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.("제품 블루프린트 생성", "thinking");

    const selectedNodes = state.figmaContext?.selectedNodes ?? [];

    const screens: BlueprintScreen[] = selectedNodes.map(
      (node, index): BlueprintScreen => ({
        id: `existing_${node.id}`,
        name: node.name || `선택된 노드 ${index + 1}`,
        intent: `기존 ${node.type} 노드 개선`,
        description: `선택된 ${node.type} 노드를 기반으로 한 개선 작업`,
        type: "existing",
        relatedNodeIds: [node.id],
      }),
    );

    if (screens.length === 0) {
      screens.push({
        id: "new_screen_1",
        name: "신규 화면",
        intent: state.userPrompt,
        description: "사용자 요청을 기반으로 생성되는 신규 화면",
        type: "new",
        relatedNodeIds: [],
      });
    }

    const flows = [
      {
        id: "primary_flow",
        name: "핵심 사용자 여정",
        description: "사용자 요청을 충족하기 위한 주요 단계",
        steps: ["요구사항 해석", "핵심 화면 설계", "상세 UI 구성"],
        primaryScreenIds: screens.map((screen) => screen.id),
      },
    ];

    const blueprint: ProductBlueprint = {
      screens,
      flows,
      dataContracts: [],
      requiredContext: {
        nodeIds: screens
          .flatMap((screen) => screen.relatedNodeIds)
          .filter(Boolean),
        assets: [],
        questions:
          screens.filter((screen) => screen.type === "new").length > 0
            ? [
                "신규 화면의 핵심 사용자 목표가 무엇인가요?",
                "필수로 노출되어야 하는 데이터나 콘텐츠가 있나요?",
              ]
            : [],
      },
      summary: `요청한 작업을 위한 화면 ${screens.length}개와 주요 플로우 1개를 정의했습니다.`,
    };

    state.blueprint = blueprint;
    state.requestedContext = this.hasPendingRequests(blueprint.requiredContext)
      ? this.cloneRequestedContext(blueprint.requiredContext)
      : { ...EMPTY_REQUESTED_CONTEXT };

    const completeThought = "🧭 블루프린트 생성 완료";
    state.thoughts.push(completeThought);
    this.onThoughtCallback?.(completeThought);

    state.currentStep = "planning";
    return state;
  }

  // Node 1: Planning - Strategy and TODO Generation
  private async planStrategy(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = `📋 사용자 요청 전략 수립 중: "${state.userPrompt}"`;
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.("작업 전략을 수립하고 있습니다...", "thinking");

    const prompt = analyzePlanningPrompt(state);

    try {
      const response = await claude.invoke([
        new SystemMessage(prompt),
        new HumanMessage({
          content: !!state.figmaContext?.selectedNodesImage.length
            ? [
                {
                  type: "text",
                  text: state.userPrompt,
                },
                ...state.figmaContext?.selectedNodesImage!.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${image.nodeImage}`,
                    detail: "high" as const,
                  },
                })),
              ]
            : state.userPrompt,
        }),
      ]);

      const responseContent = response.content as string;

      // Parse planning result
      let planningResult: PlanningResult;
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          planningResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Planning JSON not found");
        }
      } catch (parseError) {
        // Fallback planning
        planningResult = {
          intent: state.userPrompt,
          strategy: "create",
          confidence: 0.5,
          scope: {
            targetNodes: [],
            newComponents: [],
            reusableNodes: [],
          },
          todoList: [],
          risks: [],
          rollbackStrategy: "Revert all changes",
        };
      }

      if (!planningResult.scenarioStrategy) {
        planningResult.scenarioStrategy = "variant";
      }

      if (!Array.isArray(planningResult.scenarios)) {
        planningResult.scenarios = [];
      }

      if (planningResult.scenarios.length === 0) {
        const fallbackScenarioId =
          planningResult.defaultScenarioId || "default";
        planningResult.scenarios.push({
          id: fallbackScenarioId,
          name: "기본 시나리오",
          strategy: planningResult.scenarioStrategy,
          description: planningResult.intent,
        });
        planningResult.defaultScenarioId = fallbackScenarioId;
      }

      if (
        !planningResult.defaultScenarioId &&
        planningResult.scenarios.length > 0
      ) {
        planningResult.defaultScenarioId = planningResult.scenarios[0].id;
      }

      if (Array.isArray(planningResult.todoList)) {
        planningResult.todoList = planningResult.todoList.map((todo, index) => {
          const normalized = { ...todo } as TodoItem;
          if (!normalized.id) {
            normalized.id = `todo_${index + 1}`;
          }
          if (!normalized.targetNodeId && normalized.targetNode) {
            normalized.targetNodeId = normalized.targetNode;
          } else if (!normalized.targetNode && normalized.targetNodeId) {
            normalized.targetNode = normalized.targetNodeId;
          }
          if (!normalized.scenarioId) {
            normalized.scenarioId = planningResult.defaultScenarioId;
          }
          if (
            normalized.expectedVariantProps &&
            typeof normalized.expectedVariantProps !== "object"
          ) {
            normalized.expectedVariantProps = undefined;
          }
          return normalized;
        });
      }

      state.plan = planningResult;

      const planThought = `🎯 전략 수립 완료: ${planningResult.strategy} 전략, TODO ${planningResult.todoList.length}개 생성`;
      state.thoughts.push(planThought);
      this.onThoughtCallback?.(planThought);

      // Log TODO list for debugging
      if (planningResult.todoList.length > 0) {
        const todoSummary = planningResult.todoList
          .map((todo) => `${todo.order}. [${todo.type}] ${todo.task}`)
          .join("\n");
        console.log("📝 TODO List:\n", todoSummary);
      }

      console.log("========= plan", state.plan);
      state.currentStep = "figma-design";
      this.clearRequestedContext(state);
      return state;
    } catch (error) {
      state.error = `전략 수립 실패: ${error instanceof Error ? error.message : String(error)}`;
      state.currentStep = "error";
      return state;
    }
  }

  // Node 2: Design TODO-specific Decisions
  private async designTodos(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = `🎨 TODO별 구체적인 디자인 결정 중...`;
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.(
      "각 TODO에 대한 구체적인 디자인 결정을 내리고 있습니다...",
      "thinking",
    );

    // Planning 결과가 없으면 에러
    if (!state.plan) {
      state.error =
        "Planning 결과가 없습니다. Planning 단계를 먼저 수행해주세요.";
      state.currentStep = "error";
      return state;
    }

    // Design prompt 생성
    const prompt = ""

    try {
      const response = await claude.invoke([
        new SystemMessage(prompt),
        new HumanMessage(
          `사용자 요청: ${state.userPrompt}\n\n위의 Planning 결과를 바탕으로 각 TODO별 구체적인 디자인 결정을 내려주세요.\n\n⚠️ 중요: Planning의 전략이 "${state.plan.strategy}"입니다.\n- modify 전략: 기존 노드의 특정 속성만 변경하므로 layout/styles는 필요한 경우만 포함하세요\n- create 전략: 새로운 요소 생성이므로 완전한 layout/styles를 포함할 수 있습니다\n\n대부분의 간단한 수정은 description으로만 처리 가능합니다.`,
        ),
        ...state.messages,
      ]);

      const responseContent = response.content as string;

      console.log(responseContent, "responseContent==========");
      // Design 결과 JSON 파싱
      let designData;
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          designData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Design JSON 형식을 찾을 수 없음");
        }
      } catch (parseError) {
        console.error("Design JSON 파싱 실패:", parseError);
      }

      const normalizedTodoDesigns: TodoDesign[] = (
        designData.todoDesigns || []
      ).map((todo: TodoDesign, index: number) => {
        const cloned: TodoDesign = {
          ...todo,
          todoId: todo.todoId || `todo_${index + 1}`,
          scenarioId:
            todo.scenarioId ||
            state.plan?.todoList?.find((t) => t.id === todo.todoId)
              ?.scenarioId ||
            state.plan?.defaultScenarioId,
          targetNodeId: todo.targetNodeId || todo.targetNode,
          targetNode: todo.targetNode || todo.targetNodeId,
          design: {
            ...todo.design,
            expectedVariantProps: todo.design?.expectedVariantProps,
          },
        };
        return cloned;
      });

      const metadata = designData.metadata || {
        designSystemComponents: 0,
        customElements: state.plan.todoList.length,
        complexityScore: 5,
        estimatedRenderTime: 1000,
      };

      if (!metadata.scenarioCoverage && normalizedTodoDesigns.length > 0) {
        const scenarioCounts: Record<string, number> = {};
        normalizedTodoDesigns.forEach((todo) => {
          if (!todo.scenarioId) return;
          const scenario = state.plan?.scenarios?.find(
            (s) => s.id === todo.scenarioId,
          );
          const strategy =
            scenario?.strategy || state.plan?.scenarioStrategy || "variant";
          scenarioCounts[strategy] = (scenarioCounts[strategy] || 0) + 1;
        });
        metadata.scenarioCoverage = {
          total: Object.values(scenarioCounts).reduce(
            (acc, val) => acc + val,
            0,
          ),
          strategies: scenarioCounts as Record<ScenarioLayoutStrategy, number>,
        };
      }

      // DesignResult 저장
      state.design = {
        todoDesigns: normalizedTodoDesigns,
        metadata,
        dependencies: {
          executionOrder: designData.dependencies?.executionOrder || [],
          parentChildMap: new Map(
            Object.entries(designData.dependencies?.parentChildMap || {}),
          ),
        },
        scenarios: state.plan?.scenarios,
      };

      // Legacy 필드 유지 (backward compatibility)
      state.analysisResult = {
        content: responseContent,
        keyRequirements: state.plan.todoList.map((todo) => todo.task),
        designSpecs: {
          layout: {
            type: "VERTICAL",
            spacing: 16,
            padding: 24,
            alignment: "MIN",
          },
          dimensions: { width: "FILL", height: "HUG" },
        },
      
        containerStructure: {
          type: "FRAME",
          name: "Main Container",
          layout: "VERTICAL",
        },
      };

      const designThought = `✨ 디자인 결정 완료: ${state.design.todoDesigns.length}개 TODO별 구체적인 디자인 결정`;
      state.thoughts.push(designThought);
      this.onThoughtCallback?.(designThought);

      // 디자인 결과 로그
      console.log("🎨 Design Result:", {
        todoDesigns: state.design.todoDesigns.length,
        designSystemComponents: state.design.metadata.designSystemComponents,
        customElements: state.design.metadata.customElements,
        complexityScore: state.design.metadata.complexityScore,
        executionOrder: state.design.dependencies.executionOrder,
      });

      state.messages.push(response);
      const componentNames = new Set<string>();
      state.design.todoDesigns.forEach((todoDesign) => {
        if (todoDesign.design.component?.name) {
          componentNames.add(todoDesign.design.component.name);
        }
      });
      if (componentNames.size > 0) {
        state.componentGuides = getComponentGuides([...componentNames]);
      }
      state.currentStep = "generate";
      this.clearRequestedContext(state);
      console.log("========= design", JSON.stringify(state.design, null, 2));

      return state;
    } catch (error) {
      state.error = `디자인 결정 실패: ${error instanceof Error ? error.message : String(error)}`;
      state.currentStep = "error";
      return state;
    }
  }

  // Node 3: Generate Figma Code (Enhanced with TODO tracking)
  private async generateCode(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = `🎨 TODO 기반 Figma 코드 생성 중...${state.retryCount > 0 ? ` (재시도 ${state.retryCount}/${state.maxRetries})` : ""}`;
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.(
      "TODO 리스트를 기반으로 Figma 코드를 생성하고 있습니다...",
      "thinking",
    );

    // Planning과 Design 결과가 없으면 에러
    if (!state.plan || !state.design) {
      state.error = "Planning 또는 Design 결과가 없습니다.";
      state.currentStep = "error";
      return state;
    }

    // Generation prompt 생성 (이미 모든 필요한 정보 포함)
    const learningGuidance = this.buildLearningGuidance(state.learning);
    if (learningGuidance?.summary) {
      const summaryText = learningGuidance.guides?.length
        ? `${learningGuidance.summary} (세부 ${learningGuidance.guides.length}항목)`
        : learningGuidance.summary;
      const learningThought = `📚 재시도 가이드 적용: ${summaryText}`;
      state.thoughts.push(learningThought);
      this.onThoughtCallback?.(learningThought);
    }

    const fullPrompt = createGenerationPrompt(
      state.userPrompt,
      state.plan,
      state.design,
      learningGuidance,
      state.figmaContext,
      state.componentGuides,
    );

    try {
      const messages = [
        new SystemMessage(fullPrompt),
        new HumanMessage(
          `사용자 요청: ${state.userPrompt}\n\n위의 Planning과 Design 결과를 바탕으로 각 TodoDesign을 순차적으로 구현하는 JavaScript 코드를 생성해주세요.`,
        ),
      ];

      const response = await claude.invoke(messages);

      let responseContent = "";
      if (typeof response.content === "string") {
        responseContent = response.content;
      } else {
        responseContent = String(response);
      }

      const rawCode = this.extractCode(responseContent);
      const figmaCode = this.applyCodeGuards(rawCode);

      // GenerationResult 저장 (새로운 형식)
      state.generation = {
        code: figmaCode,
        metadata: {
          apiCalls: [],
          nodeOperations: [],
          estimatedExecutionTime: 1000,
          estimatedNodeCount: state.plan.todoList.length * 2,
          codePatterns: ["todo-driven", "safe-node-access", "error-handling"],
          safetyChecks: ["null-check", "readonly-check", "promise-catch"],
        },
        todoImplementation: new Map(
          state.plan.todoList.map((todo: TodoItem) => [
            todo.id,
            {
              todoId: todo.id,
              codeLines: [0, 0], // 실제 구현 시 파싱하여 채움
              implemented: true,
            },
          ]),
        ),
      };

      // Legacy 필드 유지 (backward compatibility)
      state.generatedCode = figmaCode;

      console.log(figmaCode, "figmaCode");
      console.log("🎯 Generated Code Info:", {
        length: figmaCode.length,
        todos: state.plan.todoList.length,
        implementedTodos: state.generation.todoImplementation.size,
      });

      const codeGenThought = `✅ 코드 생성 완료: ${figmaCode.length} 문자, ${state.plan.todoList.length}개 TODO 구현`;
      state.thoughts.push(codeGenThought);
      this.onThoughtCallback?.(codeGenThought);

      state.currentStep = "validate";
      this.clearRequestedContext(state);
      return state;
    } catch (error) {
      state.error = `코드 생성 실패: ${error instanceof Error ? error.message : String(error)}`;
      state.currentStep = "error";
      return state;
    }
  }

  // Node 4: Validate Generated Code (Enhanced with multi-layer validation)
  private async validateCode(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = `🔍 다층 검증 수행 중 (TypeScript, Figma API, TODO 커버리지)...`;
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.(
      "생성된 코드를 다층 검증하고 있습니다...",
      "thinking",
    );

    this.clearRequestedContext(state);

    if (!state.generatedCode || !state.generation) {
      state.error = "생성된 코드가 없습니다.";
      state.currentStep = "generate";
      return state;
    }

    try {
      // 1. TypeScript Validation
      const tsValidation = await this.validator.validateFigmaCode(
        state.generatedCode,
      );

      // 2. Figma API Validation (코드 분석 기반)
      const figmaApiValidation = this.validateFigmaApi(state.generatedCode);

      // 3. TODO Implementation Validation
      const todoValidation = this.validateTodoImplementation(
        state.generatedCode,
        state.plan?.todoList || [],
        state.generation.todoImplementation,
      );

      // 4. Safety Validation
      const safetyValidation = this.validateSafety(state.generatedCode);

      // 간소화된 검증 판정
      const isValid =
        tsValidation.success &&
        figmaApiValidation.validCalls.length > 0 &&
        figmaApiValidation.invalidCalls.length === 0;

      // ValidationResult 저장 (간소화된 형식)
      state.validation = {
        typescript: {
          success: tsValidation.success,
          errors: tsValidation.errors,
          warnings: tsValidation.warnings,
          suggestions: (tsValidation as any).suggestions || [],
        },
        figmaApi: figmaApiValidation,
        todoValidation,
        safety: safetyValidation,
        overallScore: isValid ? 100 : 0, // 간소화된 점수
        recommendation: isValid ? "proceed" : "retry",
      };

      // Legacy 필드 유지 (backward compatibility)
      state.validationResult = {
        isValid,
        errors: tsValidation.errors.map(
          (e) => `[${e.type}] ${e.line}번 줄: ${e.message}`,
        ),
        warnings: tsValidation.warnings.map((w) => w.message),
      };

      console.log(tsValidation, "tsValidation");
      console.log("🔍 Validation Results:", {
        typescript: tsValidation.success,
        figmaApiValid: figmaApiValidation.validCalls.length > 0,
        figmaApiInvalid: figmaApiValidation.invalidCalls.length,
        isValid,
        recommendation: state.validation.recommendation,
      });

      if (isValid) {
        const validThought = `✅ 검증 성공: TypeScript ✓, Figma API ✓`;
        state.thoughts.push(validThought);
        this.onThoughtCallback?.(validThought);
        state.currentStep = "execute";
      } else if (state.retryCount < state.maxRetries) {
        const invalidThought = `⚠️ 검증 실패, 재시도 필요`;
        state.thoughts.push(invalidThought);
        this.onThoughtCallback?.(invalidThought);

        // 에러 기록
        this.recordValidationError(state, tsValidation);

        state.retryCount += 1;
        state.learning = tsValidation.learningContext;
        state.currentStep = "generate";
      } else {
        state.error = `검증 실패: ${tsValidation.errors.map((e) => `- ${e.message}`).join("\n")}`;
        state.currentStep = "error";
      }
    } catch (error) {
      // TypeScript 검증 자체가 실패한 경우 기본 검증으로 폴백
      console.error("TypeScript validator 오류:", error);

      const fallbackThought = `⚠️ TypeScript 검증 실패, 기본 패턴 검증 수행`;
      state.thoughts.push(fallbackThought);
      this.onThoughtCallback?.(fallbackThought);

      // 기본 패턴 검증 (폴백)
      const code = state.generatedCode;
      const errors: string[] = [];

      // 최소한의 검증만 수행
      if (!code.includes("figma.")) {
        errors.push("Figma API 호출이 없습니다");
      }

      if (code.includes("await") && !code.includes("async")) {
        errors.push("async 함수 내에서만 await 사용 가능");
      }

      state.validationResult = {
        isValid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };

      if (state.validationResult.isValid) {
        state.currentStep = "execute";
      } else {
        state.retryCount += 1;
        if (state.retryCount < state.maxRetries) {
          state.learning = `기본 검증 실패:\n${errors.join("\n")}`;
          state.currentStep = "generate";
        } else {
          state.error = `검증 실패: ${errors.join(", ")}`;
          state.currentStep = "error";
        }
      }
    }

    return state;
  }

  // Node 4: Execute Code (클라이언트에서 실행)
  private async executeCode(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const thought = `🚀 코드를 클라이언트로 전송 중...`;
    state.thoughts.push(thought);
    this.onThoughtCallback?.(thought);
    this.onProgressCallback?.("코드 실행 준비 완료", "complete");

    if (!state.generatedCode) {
      state.error = "실행할 코드가 없습니다";
      state.currentStep = "error";
      return state;
    }

    // 클라이언트가 코드를 실행할 수 있도록 상태 설정 (구조화된 결과 초기화)
    state.executionResult = {
      success: false,
      nodes: {
        created: [],
        modified: [],
        deleted: [],
      },
      logs: {
        info: [],
        warnings: [],
        errors: [],
      },
      performance: {
        totalTime: 0,
        apiCallTime: 0,
        renderTime: 0,
        memoryUsage: 0,
      },
      promises: {
        resolved: 0,
        rejected: 0,
        rejectionReasons: [],
      },
      report: undefined,
    };
    state.executionReport = undefined;
    state.requestedContext = {
      nodeIds: [],
      assets: [
        {
          type: "execution_report",
          description: "마지막 코드 실행 결과",
        },
      ],
      questions: [],
    };

    const executeThought = `✨ 코드가 생성되었습니다. 클라이언트에서 실행을 시작합니다.`;
    state.thoughts.push(executeThought);
    this.onThoughtCallback?.(executeThought);

    state.currentStep = "verify";
    state.isComplete = false;

    return state;
  }

  // Node 5: Handle Errors
  // Enhanced Error Recovery Mechanism
  private async handleError(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const errorThought = `🔧 에러 복구 메커니즘 실행 중...`;
    state.thoughts.push(errorThought);
    this.onThoughtCallback?.(errorThought);
    this.onProgressCallback?.(
      "에러를 분석하고 복구를 시도합니다...",
      "thinking",
    );

    this.clearRequestedContext(state);

    // Categorize error type
    const errorType = this.categorizeError(state.error || "");

    // Record error in history
    if (!state.errorHistory) {
      state.errorHistory = [];
    }
    state.errorHistory.push({
      code: state.generatedCode || "",
      errorMessage: state.error || "",
      errorType,
      timestamp: Date.now(),
    });

    // Analyze error patterns
    const errorPattern = this.analyzeErrorPattern(state.errorHistory);

    // Determine recovery strategy
    const recoveryStrategy = this.determineRecoveryStrategy(
      errorType,
      state.retryCount,
      errorPattern,
    );

    console.log("🔧 Error Recovery:", {
      errorType,
      pattern: errorPattern,
      strategy: recoveryStrategy,
      retryCount: state.retryCount,
    });

    // Apply recovery strategy
    switch (recoveryStrategy) {
      case "retry_with_learning":
        if (state.retryCount < state.maxRetries) {
          // Learn from error
          state.learning = this.generateLearningContext(
            errorType,
            state.error || "",
          );

          // Record success pattern from error
          if (!state.successPatterns) {
            state.successPatterns = [];
          }
          state.successPatterns.push({
            pattern: `Avoid: ${errorType}`,
            frequency: 1,
            averageTime: Date.now(),
          });

          const retryThought = `🔄 에러 패턴 학습 후 재시도 (${state.retryCount + 1}/${state.maxRetries})`;
          state.thoughts.push(retryThought);
          this.onThoughtCallback?.(retryThought);

          state.retryCount += 1;
          state.error = undefined;

          // Determine restart point based on error type
          if (errorType === "planning" || errorType === "figma-design") {
            state.currentStep = "planning";
          } else if (errorType === "generation" || errorType === "validation") {
            state.currentStep = "generate";
          } else {
            state.currentStep = "planning";
          }
          break;
        }
      // Fall through to abort if max retries exceeded

      case "partial_recovery":
        // Try to recover partially completed work
        if (state.plan && state.generation) {
          const partialThought = `⚠️ 부분 복구 시도: 완료된 TODO만 유지`;
          state.thoughts.push(partialThought);
          this.onThoughtCallback?.(partialThought);

          state.partialRetry = true;
          state.currentStep = "verify";
          break;
        }
      // Fall through to abort if no partial work

      case "abort":
      default:
        const abortThought = `❌ 복구 불가: ${state.error}`;
        state.thoughts.push(abortThought);
        this.onThoughtCallback?.(abortThought);
        this.onProgressCallback?.(`오류: ${state.error}`, "error");

        state.currentStep = "__end__";
        state.isComplete = true;
        break;
    }

    return state;
  }

  // Helper: Categorize error type
  private categorizeError(error: string): string {
    if (error.includes("Planning") || error.includes("전략")) {
      return "planning";
    } else if (error.includes("Design") || error.includes("디자인")) {
      return "figma-design";
    } else if (error.includes("생성") || error.includes("Generate")) {
      return "generation";
    } else if (error.includes("검증") || error.includes("Validation")) {
      return "validation";
    } else if (error.includes("실행") || error.includes("Execute")) {
      return "execution";
    } else {
      return "unknown";
    }
  }

  // Helper: Analyze error patterns
  private analyzeErrorPattern(errorHistory: any[]): string {
    if (!errorHistory || errorHistory.length === 0) {
      return "first_error";
    }

    // Check for repeating errors
    const lastError = errorHistory[errorHistory.length - 1];
    const similarErrors = errorHistory.filter(
      (e) => e.errorType === lastError.errorType,
    );

    if (similarErrors.length > 2) {
      return "recurring_error";
    } else if (errorHistory.length > 5) {
      return "persistent_failures";
    } else {
      return "isolated_error";
    }
  }

  // Helper: Determine recovery strategy
  private determineRecoveryStrategy(
    errorType: string,
    retryCount: number,
    errorPattern: string,
  ): "retry_with_learning" | "partial_recovery" | "abort" {
    // Abort if too many retries or persistent failures
    if (retryCount >= 3 || errorPattern === "persistent_failures") {
      return "abort";
    }

    // Try partial recovery for execution errors
    if (errorType === "execution" && retryCount > 1) {
      return "partial_recovery";
    }

    // Retry with learning for most errors
    if (errorPattern === "first_error" || errorPattern === "isolated_error") {
      return "retry_with_learning";
    }

    // Abort for recurring errors
    return "abort";
  }

  // Helper: Generate learning context from error
  private generateLearningContext(errorType: string, error: string): string {
    const learningTemplates: Record<string, string> = {
      planning: `Planning 에러 발생: ${error}\n전략 수립 시 다음 사항 주의:\n- 사용자 요청 정확히 파악\n- CREATE/MODIFY/HYBRID 전략 올바르게 선택\n- TODO 리스트 구체적으로 작성`,
      design: `Design 에러 발생: ${error}\n디자인 결정 시 다음 사항 주의:\n- TODO별 구체적인 디자인 결정\n- 적절한 컴포넌트 선택과 매핑\n- description으로 내부 수정사항 명시`,
      generation: `Generation 에러 발생: ${error}\n코드 생성 시 다음 사항 주의:\n- 각 TODO 완전히 구현\n- 안전한 코드 패턴 사용\n- TypeScript 타입 정확히`,
      validation: `Validation 에러 발생: ${error}\n검증 실패 원인:\n- TypeScript 타입 에러 확인\n- Figma API 올바른 사용\n- TODO 구현 누락 확인`,
      execution: `Execution 에러 발생: ${error}\n실행 시 주의사항:\n- null 체크 필수\n- 읽기 전용 노드 체크\n- Promise 에러 처리`,
      unknown: `알 수 없는 에러: ${error}\n일반적인 주의사항 적용`,
    };

    return learningTemplates[errorType] || learningTemplates.unknown;
  }

  private tryParseLearningJSON(value: string): any | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn("⚠️ Failed to parse learning JSON", error);
      return null;
    }
  }

  private buildLearningGuidance(
    learning?: string | null,
    depth = 0,
  ): LearningPromptContext | undefined {
    if (!learning || typeof learning !== "string") {
      return undefined;
    }
    if (depth > 2) {
      return undefined;
    }

    const trimmed = learning.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = this.tryParseLearningJSON(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { summary: trimmed, raw: trimmed };
    }

    const payload = parsed as Record<string, any>;
    const guides: string[] = [];
    let summary: string | undefined;

    const payloadType =
      typeof payload.type === "string" ? payload.type : undefined;

    if (payloadType === "missing_todos") {
      summary =
        typeof payload.summary === "string"
          ? payload.summary
          : "이전 실행에서 누락된 TODO를 반드시 처리하세요.";
      if (Array.isArray(payload.todos)) {
        payload.todos.forEach((todo: any) => {
          if (!todo) return;
          const todoType = todo.todoType || todo.type || "TODO";
          const id = todo.id || todo.todoId || todo.todo_id || "";
          const task = todo.task || todo.description || todo.summary || "";
          const reason = todo.reason || todo.detail || todo.message || "";
          const bulletParts = [
            todoType ? `[${todoType}]` : undefined,
            id ? `#${id}` : undefined,
            task,
          ].filter(Boolean);
          let bullet = bulletParts.join(" ");
          if (reason) {
            bullet = `${bullet} — ${reason}`;
          }
          bullet = bullet.trim();
          if (bullet) {
            guides.push(bullet);
          }
        });
      }
    } else if (payloadType === "validation_failure") {
      summary =
        typeof payload.summary === "string"
          ? payload.summary
          : "검증 단계에서 발생한 실패 원인을 해결하세요.";
      if (Array.isArray(payload.failures)) {
        payload.failures.forEach((failure: any) => {
          if (typeof failure === "string" && failure.trim()) {
            guides.push(failure.trim());
          } else if (
            failure &&
            typeof failure.message === "string" &&
            failure.message.trim()
          ) {
            guides.push(failure.message.trim());
          }
        });
      }
    } else if (payloadType) {
      summary =
        typeof payload.summary === "string"
          ? payload.summary
          : typeof payload.message === "string"
            ? payload.message
            : `이전 실행에서 '${payloadType}' 유형 이슈가 발생했습니다. 대응 전략을 반영하세요.`;
      const listFields = [payload.guides, payload.hints, payload.actions];
      listFields.forEach((field) => {
        if (Array.isArray(field)) {
          field.forEach((item) => {
            if (typeof item === "string" && item.trim()) {
              guides.push(item.trim());
            }
          });
        }
      });
    }

    if (!summary) {
      summary =
        (typeof payload.summary === "string" && payload.summary) ||
        (typeof payload.message === "string" && payload.message) ||
        (typeof payload.description === "string" && payload.description) ||
        "이전 실행에서 학습된 교훈을 반영하세요.";
    }

    if (payload.previous && depth < 2) {
      const nestedRaw =
        typeof payload.previous === "string"
          ? payload.previous
          : JSON.stringify(payload.previous);
      const nested = this.buildLearningGuidance(nestedRaw, depth + 1);
      if (nested) {
        if (nested.summary) {
          guides.push(`이전 참고: ${nested.summary}`);
        }
        if (nested.guides?.length) {
          nested.guides.forEach((guide) => {
            guides.push(`이전 참고: ${guide}`);
          });
        }
      }
    }

    const dedupedGuides = Array.from(
      new Set(
        guides
          .map((guide) => (typeof guide === "string" ? guide.trim() : ""))
          .filter(Boolean),
      ),
    );

    return {
      summary: summary?.trim() || undefined,
      guides: dedupedGuides.length > 0 ? dedupedGuides : undefined,
      raw: JSON.stringify(parsed, null, 2),
    };
  }

  private applyCodeGuards(code: string): string {
    if (!code) {
      return code;
    }

    let patched = code;

    const insertChildPattern =
      /([A-Za-z0-9_.$]+)\.insertChild\(([^,]+),\s*([^\)]+)\)/g;
    const hasInsertChild = /\.insertChild\(/.test(patched);

    if (hasInsertChild) {
      patched = patched.replace(
        insertChildPattern,
        (_match, parent, index, node) => {
          return `safeInsertChild(${parent.trim()}, ${node.trim()}, ${index.trim()})`;
        },
      );

      if (!/function\s+safeInsertChild\s*\(/.test(patched)) {
        const helper = `function safeInsertChild(parent, node, index) {\n  if (typeof index === "number" && index >= 0 && index <= parent.children.length) {\n    parent.insertChild(index, node);\n  } else {\n    parent.appendChild(node);\n  }\n}\n\n`;
        patched = `${helper}${patched}`;
      }

      // 중첩 선언된 const safeInsertChild 방지 (헬퍼 재귀 제거)
      patched = patched.replace(
        /const\s+safeInsertChild\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*;/g,
        "",
      );
    }

    const tokenConstants: Array<{ name: string; value: string }> = [
      {
        name: "THEME_COLLECTION_KEY",
        value: "39e0c2b9cd40942595f053c590c74e1123f4e317",
      },
      {
        name: "RADIUS_COLLECTION_KEY",
        value: "8e172dafc41cff80fc32c6ef5b2519ea51091ff7",
      },
      {
        name: "PRIMITIVE_COLLECTION_KEY",
        value: "d6673925cad31c3f25349c1469ca4288495979e2",
      },
    ];

    tokenConstants.forEach(({ name, value }) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*"([^"]+)"`, "g");
      patched = patched.replace(regex, `const ${name} = "${value}"`);
    });

    return patched;
  }

  // Node 6: Verify TODO Completion
  private async verifyExecution(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const verifyStartThought = `✅ TODO 완료 검증 중...`;
    state.thoughts.push(verifyStartThought);
    this.onThoughtCallback?.(verifyStartThought);
    this.onProgressCallback?.("실행 결과를 검증하고 있습니다...", "thinking");

    const executionReport = state.collectedContext.assets?.execution_report as
      | ExecutionReport
      | undefined;

    if (!executionReport) {
      state.requestedContext = {
        nodeIds: [],
        assets: [
          {
            type: "execution_report",
            description: "최근 코드 실행 결과",
          },
        ],
        questions: [],
      };
      return state;
    }

    state.executionReport = executionReport;
    this.clearRequestedContext(state);

    if (!state.plan?.todoList) {
      state.currentStep = "complete";
      state.isComplete = true;
      return state;
    }

    if (state.executionResult && !(state.executionResult as any).nodes) {
      const legacyError = (state.executionResult as any).error;
      state.executionResult = {
        success: !executionReport.error,
        nodes: {
          created: [],
          modified: [],
          deleted: [],
        },
        logs: {
          info: [],
          warnings: [],
          errors: legacyError
            ? [
                {
                  message: legacyError,
                  type: "execution",
                },
              ]
            : [],
        },
        performance: {
          totalTime: executionReport.durationMs,
          apiCallTime: executionReport.durationMs,
          renderTime: 0,
          memoryUsage: 0,
        },
        promises: {
          resolved: 0,
          rejected: legacyError ? 1 : 0,
          rejectionReasons: legacyError ? [legacyError] : [],
        },
        report: executionReport,
      };
    }

    const planTodos = state.plan.todoList;
    const designTodos = state.design?.todoDesigns || [];
    const designTodoMap = new Map(
      designTodos.map((todo) => [todo.todoId, todo]),
    );
    const createdNodes = executionReport.createdNodes || [];
    const updatedNodes = executionReport.updatedNodes || [];
    const deletedNodeIds = executionReport.deletedNodeIds || [];

    const todoPropertyHints: Record<string, string[]> = {
      style: ["fills", "text", "effects", "variables", "strokes"],
      modify: [
        "layout",
        "size",
        "constraints",
        "component",
        "variables",
        "text",
        "fills",
        "effects",
      ],
      delete: [],
      create: ["name", "layout", "component", "text", "fills"],
    };

    const planTodoMap = new Map(planTodos.map((todo) => [todo.id, todo]));
    const todoNodeMatches = new Map<
      string,
      { nodeId: string; scenarioId?: string }
    >();
    const nodeIdToCreateTodo = new Map<string, string>();
    const nodeIdToModifyTodo = new Map<string, string>();
    const assignedNodeIds = new Set<string>();

    const getScenarioId = (todoId: string): string | undefined => {
      const planTodo = planTodoMap.get(todoId);
      const designTodo = designTodoMap.get(todoId);
      return (
        planTodo?.scenarioId ??
        designTodo?.scenarioId ??
        state.plan?.defaultScenarioId
      );
    };

    const compareVariantProps = (
      actual: Record<string, string> | undefined,
      expected: Record<string, string> | undefined,
    ): boolean | undefined => {
      if (!expected || Object.keys(expected).length === 0) {
        return undefined;
      }
      if (!actual) {
        return false;
      }
      return Object.entries(expected).every(([key, value]) => {
        const actualValue = actual[key];
        if (actualValue === undefined) {
          return false;
        }
        return actualValue.toLowerCase() === String(value).toLowerCase();
      });
    };

    const evaluations: Array<{
      todo: TodoItem;
      matched: boolean;
      reason: string;
      matchedNodeId?: string;
    }> = [];

    for (const todo of planTodos) {
      const designTodo = designTodoMap.get(todo.id);
      const rawName =
        typeof designTodo?.design?.nodeName === "string"
          ? designTodo?.design?.nodeName
          : undefined;
      const nodeName = rawName?.trim();
      const targetNodeId =
        todo.targetNodeId ||
        todo.targetNode ||
        designTodo?.targetNodeId ||
        designTodo?.targetNode;
      const expectedProps = todoPropertyHints[todo.type] || [];
      const expectedVariantProps =
        todo.expectedVariantProps || designTodo?.design?.expectedVariantProps;

      let matched = false;
      let matchedNodeId: string | undefined;
      let reason = "조건을 충족하는 노드를 찾지 못했습니다.";

      const scenarioId = getScenarioId(todo.id);

      const checkProperties = (node: {
        changedProperties?: string[];
        variantProps?: Record<string, string>;
      }) => {
        const propertyMatch =
          expectedProps.length === 0 ||
          (node.changedProperties || []).some((prop) =>
            expectedProps.includes(prop),
          );
        if (!propertyMatch) {
          return false;
        }
        const variantResult = compareVariantProps(
          node.variantProps,
          expectedVariantProps,
        );
        if (variantResult === undefined) {
          return true;
        }
        return variantResult;
      };

      const recordMatch = (
        nodeId: string,
        lockNode = false,
        matchType:
          | "create"
          | "modify"
          | "style"
          | "delete"
          | "unknown" = "unknown",
      ) => {
        matched = true;
        matchedNodeId = nodeId;
        todoNodeMatches.set(todo.id, { nodeId, scenarioId });
        switch (matchType) {
          case "create":
            if (!nodeIdToCreateTodo.has(nodeId)) {
              nodeIdToCreateTodo.set(nodeId, todo.id);
            }
            break;
          case "modify":
          case "style":
            nodeIdToModifyTodo.set(nodeId, todo.id);
            break;
          default:
            break;
        }
        if (lockNode) {
          assignedNodeIds.add(nodeId);
        }
        reason = "matched";
      };

      switch (todo.type) {
        case "delete": {
          if (!targetNodeId) {
            reason = "삭제 대상 nodeId가 정의되지 않았습니다.";
          } else if (deletedNodeIds.includes(targetNodeId)) {
            recordMatch(targetNodeId, false, "delete");
          } else {
            reason = "대상 노드가 삭제되지 않았습니다.";
          }
          break;
        }
        case "modify":
        case "style": {
          if (targetNodeId) {
            const updatedTarget = updatedNodes.find(
              (node) => node.id === targetNodeId,
            );
            if (updatedTarget && checkProperties(updatedTarget)) {
              recordMatch(
                updatedTarget.id,
                false,
                todo.type === "style" ? "style" : "modify",
              );
              break;
            }
            if (updatedTarget) {
              const changed = (updatedTarget.changedProperties || []).join(
                ", ",
              );
              reason = `변경 속성(${changed})이 기대값(${expectedProps.join(", ")})과 다릅니다.`;
            } else {
              reason = "대상 노드가 수정되지 않았습니다.";
            }
          }

          if (matched || !nodeName) {
            break;
          }

          const lowerName = nodeName.toLowerCase();
          const updatedByName = updatedNodes.find((node) => {
            if (nodeIdToModifyTodo.has(node.id)) {
              return false;
            }
            const target = node.name || "";
            return (
              target === nodeName || target.toLowerCase().includes(lowerName)
            );
          });

          if (updatedByName && checkProperties(updatedByName)) {
            recordMatch(
              updatedByName.id,
              false,
              todo.type === "style" ? "style" : "modify",
            );
          } else if (updatedByName) {
            const changed = (updatedByName.changedProperties || []).join(", ");
            reason = `변경 속성(${changed})이 기대값(${expectedProps.join(", ")})과 다릅니다.`;
          }
          break;
        }
        default: {
          const parentInfo = designTodo?.design.parent;
          const expectedParentId = parentInfo?.existingNodeId
            ? parentInfo.existingNodeId
            : parentInfo?.todoId
              ? todoNodeMatches.get(parentInfo.todoId)?.nodeId
              : undefined;

          const pickCreatedNode = () => {
            if (!nodeName) {
              return undefined;
            }
            const lowerName = nodeName.toLowerCase();
            const candidates = createdNodes.filter((node) => {
              const target = node.name || "";
              const nameMatch =
                target === nodeName || target.toLowerCase().includes(lowerName);
              if (!nameMatch) {
                return false;
              }
              if (assignedNodeIds.has(node.id)) {
                return false;
              }
              if (expectedParentId && node.parentId !== expectedParentId) {
                return false;
              }
              return true;
            });

            if (candidates.length > 0) {
              return candidates[0];
            }

            return createdNodes.find((node) => {
              if (assignedNodeIds.has(node.id)) {
                return false;
              }
              const target = node.name || "";
              return (
                target === nodeName || target.toLowerCase().includes(lowerName)
              );
            });
          };

          if (nodeName) {
            const createdMatch = pickCreatedNode();
            if (createdMatch) {
              recordMatch(createdMatch.id, true, "create");
            } else {
              reason = "요구된 이름의 노드를 생성하지 않았습니다.";
            }
          }

          if (!matched && targetNodeId) {
            const directMatch = createdNodes.find(
              (node) => node.id === targetNodeId,
            );
            if (directMatch && !assignedNodeIds.has(directMatch.id)) {
              recordMatch(directMatch.id, true, "create");
            } else if (!directMatch) {
              reason = "생성된 노드 ID와 일치하지 않습니다.";
            }
          }
          break;
        }
      }

      evaluations.push({ todo, matched, reason, matchedNodeId });
    }

    const matchedTodoIds = new Set(
      evaluations.filter((ev) => ev.matched).map((ev) => ev.todo.id),
    );

    const totalTodos = planTodos.length || designTodos.length || 1;
    const completedCount = matchedTodoIds.size;
    const completionRate = (completedCount / totalTodos) * 100;

    const verifyThought = `📊 검증 완료: ${completedCount}/${totalTodos} TODO 완료 (${completionRate.toFixed(1)}%) - 생성 노드 ${executionReport.createdNodeIds.length}개`;
    state.thoughts.push(verifyThought);
    this.onThoughtCallback?.(verifyThought);

    const createdNodeEntries = createdNodes.map((node) => {
      const todoId = nodeIdToCreateTodo.get(node.id) || "";
      const planTodo = todoId ? planTodoMap.get(todoId) : undefined;
      const designTodo = todoId ? designTodoMap.get(todoId) : undefined;
      const scenarioId =
        todoNodeMatches.get(todoId)?.scenarioId ||
        planTodo?.scenarioId ||
        designTodo?.scenarioId;

      return {
        id: node.id,
        name: node.name,
        type: node.type,
        todoId,
        timestamp: executionReport.timestamp,
        scenarioId,
        componentKey: node.componentKey ?? null,
        componentName: node.componentName ?? null,
        variantProps: node.variantProperties
          ? { ...node.variantProperties }
          : undefined,
      };
    });

    const modifiedEntries = updatedNodes.map((node) => {
      const todoId = nodeIdToModifyTodo.get(node.id) || "";
      const planTodo = todoId ? planTodoMap.get(todoId) : undefined;
      const designTodo = todoId ? designTodoMap.get(todoId) : undefined;
      const expectedVariantProps =
        planTodo?.expectedVariantProps ||
        designTodo?.design?.expectedVariantProps;
      const scenarioId =
        todoNodeMatches.get(todoId)?.scenarioId ||
        planTodo?.scenarioId ||
        designTodo?.scenarioId;
      const variantProps = node.variantProps
        ? { ...node.variantProps }
        : undefined;
      const variantMatch = expectedVariantProps
        ? compareVariantProps(node.variantProps, expectedVariantProps)
        : undefined;

      return {
        id: node.id,
        changes: node.changedProperties || [],
        todoId,
        scenarioId,
        variantMatch,
        variantProps,
        componentKey: node.componentKey ?? null,
        componentName: node.componentName ?? null,
      };
    });
    const deletedEntries = executionReport.deletedNodeIds || [];

    if (!state.executionResult) {
      state.executionResult = {
        success: !executionReport.error,
        nodes: {
          created: createdNodeEntries,
          modified: modifiedEntries,
          deleted: deletedEntries,
        },
        logs: {
          info: [],
          warnings: [],
          errors: executionReport.error
            ? [
                {
                  message: executionReport.error,
                  type: "execution",
                },
              ]
            : [],
        },
        performance: {
          totalTime: executionReport.durationMs,
          apiCallTime: executionReport.durationMs,
          renderTime: 0,
          memoryUsage: 0,
        },
        promises: {
          resolved: 0,
          rejected: executionReport.error ? 1 : 0,
          rejectionReasons: executionReport.error
            ? [executionReport.error]
            : [],
        },
        report: executionReport,
      };
    } else {
      state.executionResult.success = !executionReport.error;
      state.executionResult.nodes = state.executionResult.nodes || {
        created: [],
        modified: [],
        deleted: [],
      };
      state.executionResult.nodes.created = createdNodeEntries;
      state.executionResult.nodes.modified = modifiedEntries;
      state.executionResult.nodes.deleted = deletedEntries;
      state.executionResult.logs = state.executionResult.logs || {
        info: [],
        warnings: [],
        errors: [],
      };
      state.executionResult.logs.errors = executionReport.error
        ? [
            {
              message: executionReport.error,
              type: "execution",
            },
          ]
        : [];
      state.executionResult.report = executionReport;
    }

    // If completion rate is low, retry failed TODOs
    const missingEvaluations = evaluations.filter((ev) => !ev.matched);
    if (missingEvaluations.length > 0) {
      const missingSummary = missingEvaluations
        .map((ev) => `- [${ev.todo.type}] ${ev.todo.task} :: ${ev.reason}`)
        .join("\n");
      const warningThought = `⚠️ 미완료 TODO ${missingEvaluations.length}개:\n${missingSummary}`;
      state.thoughts.push(warningThought);
      this.onThoughtCallback?.(warningThought);
      const learningPayload = {
        type: "missing_todos",
        previous: state.learning ?? null,
        todos: missingEvaluations.map((ev) => ({
          id: ev.todo.id,
          task: ev.todo.task,
          todoType: ev.todo.type,
          reason: ev.reason,
        })),
      };
      state.learning = JSON.stringify(learningPayload, null, 2);
      state.runLog?.push({
        step: "verify:missing",
        timestamp: Date.now(),
        summary: JSON.stringify(learningPayload, null, 2),
        requestedContext: this.cloneRequestedContext(
          state.requestedContext ?? EMPTY_REQUESTED_CONTEXT,
        ),
      });
    }

    if (completionRate < 80 && state.retryCount < 1) {
      state.partialRetry = true;
      state.retryCount += 1;

      const retryThought = `🔄 실패한 TODO 재시도 중...`;
      state.thoughts.push(retryThought);
      this.onThoughtCallback?.(retryThought);

      state.currentStep = "generate";
    } else {
      state.currentStep = "complete";
      state.isComplete = true;
    }

    return state;
  }

  // Node 7: Complete
  private async complete(
    state: FigmaCodeWorkflowState,
  ): Promise<FigmaCodeWorkflowState> {
    const completeThought = `✨ 워크플로우 완료! 총 ${state.thoughts.length}개 사고 과정`;
    state.thoughts.push(completeThought);
    this.onThoughtCallback?.(completeThought);
    this.onProgressCallback?.("디자인 생성이 완료되었습니다!", "complete");

    state.isComplete = true;
    state.currentStep = "complete";
    this.clearRequestedContext(state);

    // complete 노드는 직접 END로 연결되므로 currentStep 설정 불필요
    return state;
  }

  // Create Workflow
  createWorkflow() {
    const workflow = new StateGraph<FigmaCodeWorkflowState>({
      channels: {
        // Input
        userPrompt: null,
        figmaContext: null,
        conversationHistory: null,
        // Node results
        plan: null,
        analysis: null, // Legacy - kept for compatibility
        design: null, // New design decision system
        generation: null,
        validation: null,
        execution: null,
        verification: null,
        stateVersion: null,
        stepHistory: null,
        lastStepCompleted: null,
        lastUpdatedAt: null,
        requestedContext: null,
        collectedContext: null,
        // Legacy fields
        analysisResult: null,
        generatedCode: null,
        validationResult: null,
        executionResult: null,
        previousErrors: null,
        executionErrors: null,
        // Control
        currentStep: null,
        retryCount: null,
        maxRetries: null,
        partialRetry: null,
        // Learning
        learning: null,
        errorHistory: null,
        successPatterns: null,
        // Tracking
        thoughts: null,
        messages: null,
        isComplete: null,
        error: null,
        runLog: null,
        executionReport: null,
      },
    })

      // Add nodes
      .addNode("planning", this.planStrategy.bind(this))
      .addNode("figma-design", this.designTodos.bind(this))
      .addNode("generate", this.generateCode.bind(this))
      .addNode("validate", this.validateCode.bind(this))
      .addNode("execute", this.executeCode.bind(this))
      .addNode("verify", this.verifyExecution.bind(this))
      .addNode("handleError", this.handleError.bind(this))
      .addNode("complete", this.complete.bind(this))

      // Add edges
      // Conditional edge from planning
      .addConditionalEdges(
        "planning",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          "figma-design": "figma-design",
          error: "handleError",
        },
      )

      // Conditional edge from design
      .addConditionalEdges(
        "figma-design",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          generate: "generate",
          error: "handleError",
        },
      )

      // Conditional edge from generate
      .addConditionalEdges(
        "generate",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          validate: "validate",
          error: "handleError",
        },
      )

      // Conditional edge from validate
      .addConditionalEdges(
        "validate",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          execute: "execute",
          generate: "generate", // 실패 시 재생성
          error: "handleError",
        },
      )

      // Conditional edge from execute
      .addConditionalEdges(
        "execute",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          complete: "complete",
          error: "handleError",
        },
      )

      // Conditional edge from verify
      .addConditionalEdges(
        "verify",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          generate: "generate", // Retry failed TODOs
          complete: "complete",
          error: "handleError",
        },
      )

      // Conditional edge from handleError
      .addConditionalEdges(
        "handleError",
        (state: FigmaCodeWorkflowState) => state.currentStep,
        {
          planning: "planning",
          generate: "generate",
          verify: "verify",
          __end__: END,
        },
      )
      .addEdge("complete", END)

      // Set entry point
      .setEntryPoint("planning");

    return workflow;
  }

  // 실행 에러 추가 메서드 (클라이언트에서 호출)
  addExecutionError(
    state: FigmaCodeWorkflowState,
    errorData: {
      code: string;
      errorMessage: string;
      errorType:
        | "readonly"
        | "null_node"
        | "promise_rejection"
        | "api"
        | "unknown";
      promiseRejections?: Array<{ reason: string; stack: string }>;
    },
  ) {
    if (!state.executionErrors) {
      state.executionErrors = [];
    }

    state.executionErrors.push({
      ...errorData,
      timestamp: Date.now(),
    });
  }

  // Execute Workflow
  async executeWorkflow(
    userPrompt: string,
    figmaContext?: FigmaContext,
    conversationHistory?: Array<any>,
    previousError?: string,
    executionError?: {
      code: string;
      errorMessage: string;
      errorType:
        | "readonly"
        | "null_node"
        | "promise_rejection"
        | "api"
        | "unknown";
      promiseRejections?: Array<{ reason: string; stack: string }>;
    },
  ): Promise<FigmaCodeWorkflowState> {
    let state = this.createInitialState(
      userPrompt,
      figmaContext,
      conversationHistory,
      previousError,
    );

    if (executionError) {
      this.addExecutionError(state, executionError);
    }

    let safetyCounter = 0;

    while (!state.isComplete && !state.error) {
      const previousStep = state.currentStep;
      const result = await this.executeStep(state, { autoAdvance: true });
      state = result.state;

      if (result.completed) {
        break;
      }

      if (result.nextStep === "error" && !state.error) {
        state.error = state.error ?? "워크플로우가 오류 상태로 전환되었습니다";
        break;
      }

      if (previousStep === result.nextStep) {
        // 더 이상 진행할 수 없는 상태이므로 루프 종료
        break;
      }

      safetyCounter += 1;
      if (safetyCounter > 20) {
        state.error = "워크플로우가 안전 한도를 초과했습니다";
        state.currentStep = "error";
        break;
      }
    }

    return state;
  }

  // Utility Methods
  private extractCode(content: string): string {
    // Extract code from markdown code blocks
    const codeMatch = content.match(
      /```(?:javascript|js|typescript|ts)?\n([\s\S]*?)\n```/,
    );

    if (codeMatch) {
      // 코드 블록에서 추출된 내용
      let code = codeMatch[1].trim();

      // 실제 JavaScript 코드가 아닌 설명 텍스트 제거
      // executeCode() 이후의 설명 텍스트 제거
      const executeIndex = code.lastIndexOf("executeCode();");
      if (executeIndex !== -1) {
        code = code.substring(0, executeIndex + "executeCode();".length);
      }

      // 코드가 아닌 한글 설명 라인 제거
      const lines = code.split("\n");
      const codeLines = lines.filter((line) => {
        // 순수 한글 설명 라인 제거
        const trimmedLine = line.trim();
        if (!trimmedLine) return true; // 빈 줄은 유지

        // JavaScript 코드 패턴 확인
        const isCode =
          trimmedLine.startsWith("//") || // 주석
          trimmedLine.startsWith("/*") || // 블록 주석
          trimmedLine.startsWith("*") || // 블록 주석 계속
          trimmedLine.includes("=") || // 할당
          trimmedLine.includes("(") || // 함수 호출
          trimmedLine.includes("{") || // 객체/블록
          trimmedLine.includes(";") || // 문장 종료
          trimmedLine.includes("const ") || // 변수 선언
          trimmedLine.includes("let ") ||
          trimmedLine.includes("var ") ||
          trimmedLine.includes("function ") ||
          trimmedLine.includes("async ") ||
          trimmedLine.includes("await ") ||
          trimmedLine.includes("figma.") || // Figma API
          trimmedLine.includes("}") || // 블록 종료
          trimmedLine.includes("]") || // 배열 종료
          /^[a-zA-Z_$]/.test(trimmedLine); // 영문으로 시작

        // 한글 설명 패턴 확인
        const isDescription =
          /^[가-힣]/.test(trimmedLine) && // 한글로 시작
          !trimmedLine.includes("=") &&
          !trimmedLine.includes("(") &&
          !trimmedLine.includes("{");

        return isCode && !isDescription;
      });

      return codeLines.join("\n").trim();
    }

    // 코드 블록이 없는 경우 전체 내용 반환
    return content.trim();
  }

  // ============================================
  // Validation Helper Methods
  // ============================================

  // Helper: Validate Figma API usage
  private validateFigmaApi(code: string) {
    const validApiPatterns = [
      /figma\.createFrame/g,
      /figma\.createText/g,
      /figma\.createRectangle/g,
      /figma\.createComponent/g,
      /figma\.createInstance/g,
      /figma\.getNodeById/g,
      /figma\.currentPage/g,
    ];

    const invalidApiPatterns = [
      /figma\.deleteNode/g, // deprecated
      /node\.remove\(\)/g, // should use node.remove() carefully
    ];

    const validCalls: string[] = [];
    const invalidCalls: string[] = [];
    const deprecatedUsage: string[] = [];
    const performanceIssues: string[] = [];

    validApiPatterns.forEach((pattern) => {
      const matches = code.match(pattern);
      if (matches) {
        validCalls.push(...matches);
      }
    });

    invalidApiPatterns.forEach((pattern) => {
      const matches = code.match(pattern);
      if (matches) {
        invalidCalls.push(...matches);
      }
    });

    // Check for performance issues
    if (code.match(/for\s*\(.*\)\s*{[\s\S]*?figma\.create/)) {
      performanceIssues.push(
        "Creating nodes in loop - consider batch creation",
      );
    }

    return {
      validCalls,
      invalidCalls,
      deprecatedUsage,
      performanceIssues,
    };
  }

  // Helper: Validate TODO implementation
  private validateTodoImplementation(
    code: string,
    todoList: TodoItem[],
    todoImplementation: Map<string, any>,
  ) {
    let implementedCount = 0;
    const missingImplementations: string[] = [];

    todoList.forEach((todo) => {
      // Check if TODO is mentioned in code
      const todoPattern = new RegExp(`TODO_${todo.id.split("_")[1]}`, "g");
      if (code.match(todoPattern)) {
        implementedCount++;
      } else {
        missingImplementations.push(todo.task);
      }
    });

    const coverage =
      todoList.length > 0
        ? Math.round((implementedCount / todoList.length) * 100)
        : 0;

    return {
      totalTodos: todoList.length,
      implementedTodos: implementedCount,
      coverage,
      missingImplementations,
    };
  }

  // Helper: Validate safety checks
  private validateSafety(code: string) {
    return {
      nullChecks: code.includes("if (!") || code.includes("if (node)"),
      errorHandling: code.includes("try") && code.includes("catch"),
      asyncHandling: code.includes("async") && code.includes("await"),
      memoryLeaks: [], // Would need more sophisticated analysis
    };
  }

  // 제거됨: calculateValidationScore (불필요)

  // Helper: Record validation error
  private recordValidationError(
    state: FigmaCodeWorkflowState,
    tsValidation: any,
  ) {
    if (!state.previousErrors) {
      state.previousErrors = [];
    }
    state.previousErrors.push({
      code: state.generatedCode!,
      error: tsValidation.errors.map((e: any) => e.message).join(", "),
      timestamp: Date.now(),
    });
  }
}

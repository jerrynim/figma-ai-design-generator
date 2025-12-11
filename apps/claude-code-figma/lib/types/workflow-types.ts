// ============================================
// Figma Code Generate Workflow Type Definitions
// ============================================

import { FigmaContext } from "../figma/figma-client";

// ============================================
// Scenario Types
// ============================================

export type ScenarioLayoutStrategy = "variant" | "duplicate_page" | "hybrid";

export interface ScenarioSpec {
  id: string;
  name: string;
  description?: string;
  /**
   * variant: 동일 페이지 내 컴포넌트/프레임 variant로 구분
   * duplicate_page: 시나리오마다 별도 페이지/프레임 생성
   * hybrid: 일부는 variant, 일부는 별도 페이지 (세부 결정은 Designer가 수행)
   */
  strategy: ScenarioLayoutStrategy;
  /** 기본이 되는 프레임/페이지 노드 ID (variant 전략 시 참조) */
  baseNodeId?: string;
  /** variant 전략일 때 기준이 되는 시나리오 */
  variantOf?: string;
  /** 별도 페이지 전략일 때 생성/수정 대상 페이지 이름 */
  pageName?: string;
  /** 별도 페이지 전략일 때 주요 프레임 이름 */
  frameName?: string;
}

// ============================================
// Blueprint & Context Types
// ============================================

export interface BlueprintScreen {
  id: string;
  name: string;
  intent: string;
  description?: string;
  type: "existing" | "new" | "modified";
  relatedNodeIds: string[];
}

export interface BlueprintFlow {
  id: string;
  name: string;
  description?: string;
  steps: string[];
  primaryScreenIds: string[];
}

export interface BlueprintDataContract {
  id: string;
  name: string;
  description?: string;
  dataSources: string[];
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
}

export interface RequestedContext {
  nodeIds: string[];
  assets: Array<{
    type:
      | "thumbnail"
      | "screenshot"
      | "component"
      | "token"
      | "execution_report"
      | "unknown";
    id?: string;
    description: string;
  }>;
  questions: string[];
}

export interface CollectedContext {
  nodeDetails: Record<string, any>;
  assets: Record<string, any> & {
    execution_report?: ExecutionReport | null;
  };
  answers: Record<string, string>;
}

export interface ProductBlueprint {
  screens: BlueprintScreen[];
  flows: BlueprintFlow[];
  dataContracts: BlueprintDataContract[];
  requiredContext: RequestedContext;
  summary: string;
}

export interface ComponentGuideMap {
  [componentName: string]: string;
}

export interface RunLogEntry {
  step: string;
  timestamp: number;
  summary: string;
  requestedContext?: RequestedContext;
}

// ============================================
// Planning Node Types
// ============================================

export interface TodoItem {
  id: string;
  order: number;
  task: string;
  type:
    | "check"
    | "find"
    | "create"
    | "modify"
    | "delete"
    | "style"
    | "validate";
  /** @deprecated targetNode → targetNodeId */
  targetNode?: string;
  targetNodeId?: string;
  scenarioId?: string;
  expectedVariantProps?: Record<string, string>;
  dependencies?: string[];
}

export interface PlanningResult {
  // Strategy
  intent: string;
  strategy: "create" | "modify" | "hybrid";
  confidence: number;
  scenarioStrategy?: ScenarioLayoutStrategy;
  scenarios?: ScenarioSpec[];
  defaultScenarioId?: string;

  // Scope
  scope: {
    targetNodes?: Array<{
      id: string;
      name: string;
      type: string;
      action: "modify" | "delete" | "keep";
    }>;
    newComponents: string[];
    reusableNodes?: string[];
  };

  // Execution plan
  todoList: TodoItem[];

  // Risk management
  risks: Array<{
    type: "data_loss" | "breaking_change" | "performance";
    description: string;
    mitigation: string;
  }>;

  rollbackStrategy?: string;
}

// ============================================
// Analysis Node Types
// ============================================

export interface DesignSpecs {
  layout: {
    type: "VERTICAL" | "HORIZONTAL" | "GRID";
    spacing: number;
    padding: number;
    alignment: string;
  };
  dimensions: {
    width: "FILL" | "HUG" | number;
    height: "FILL" | "HUG" | number;
  };
  colorScheme?: {
    primary?: string;
    background?: string;
    text?: string;
  };
  typography?: {
    title?: string;
    body?: string;
    label?: string;
  };
}




// ============================================
// Design Node Types
// ============================================

export interface TodoDesign {
  todoId: string;
  task: string; // Planning에서 가져온 TODO 작업 설명
  /** @deprecated targetNode → targetNodeId */
  targetNode?: string; // 수정 대상 노드 ID (modify 전략일 경우)
  targetNodeId?: string;
  scenarioId?: string;
  design: {
    // 노드 기본 정보 (필수)
    nodeType: "INSTANCE" | "FRAME" | "TEXT" | "GROUP";
    nodeName: string;

    // 구현 시 세부 지시사항 (핵심: 컴포넌트 내부 수정사항)
    description?: string; // "버튼 내부 텍스트를 '가입하기'로 설정합니다"

    // 컴포넌트 관련 (INSTANCE일 경우만)
    component?: {
      key: string;
      name: string;
      properties?: Record<string, any>; // 실제 Figma properties만 (variant, size 등)
    };

    // Figma API 속성 직접 매핑 (선택적 - modify 전략일 때는 필요한 속성만)
    layout?: {
      layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
      primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
      counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
      primaryAxisSizingMode?: "FIXED" | "AUTO";
      counterAxisSizingMode?: "FIXED" | "AUTO";
      layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
      layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
      itemSpacing?: number | string; // 16 또는 "space/200"
      paddingTop?: number | string;
      paddingRight?: number | string;
      paddingBottom?: number | string;
      paddingLeft?: number | string;
      width?: number; // layoutSizingHorizontal이 없는 경우
      height?: number; // layoutSizingVertical이 없는 경우
    };

    // 스타일 (선택적 - modify 전략일 때는 필요한 속성만)
    styles?: {
      textStyleName?: string; // "headline/01", "body/01" 등
      textStyleKey?: string; // "8ad7c86610f8d9fbc65b19f591fe7e5ad0527919", "body/01" 등
      fills?: string; // "semantic/color/primary/500"
      strokes?: string;
      effects?: string;
      cornerRadius?: number | string;
    };

    // TEXT 노드 전용 (nodeType이 "TEXT"일 경우)
    textContent?: string;

    // 부모-자식 관계 (create 전략일 때만)
    parent?: {
      todoId?: string; // 다른 TODO가 부모인 경우
      existingNodeId?: string; // 기존 Figma 노드가 부모인 경우
      insertIndex?: number; // 삽입 위치 (appendChild일 경우 생략)
    };
    expectedVariantProps?: Record<string, string>;
  };
}



// ============================================
// Generation Node Types
// ============================================

export interface GenerationResult {
  code: string;

  metadata: {
    apiCalls: Array<{
      type: string;
      count: number;
      async: boolean;
    }>;

    nodeOperations: Array<{
      operation: "create" | "modify" | "delete";
      nodeType: string;
      todoId: string;
    }>;

    estimatedExecutionTime: number;
    estimatedNodeCount: number;

    codePatterns: string[];
    safetyChecks: string[];
  };

  todoImplementation: Map<
    string,
    {
      todoId: string;
      codeLines: [number, number];
      implemented: boolean;
    }
  >;
}

// ============================================
// Validation Node Types
// ============================================

export interface ValidationResult {
  // TypeScript validation
  typescript: {
    success: boolean;
    errors: Array<{
      type: string;
      message: string;
      line: number;
      column?: number;
    }>;
    warnings: Array<{
      message: string;
      line?: number;
    }>;
    suggestions: string[];
  };

  // Figma API validation
  figmaApi: {
    validCalls: string[];
    invalidCalls: string[];
    deprecatedUsage: string[];
    performanceIssues: string[];
  };

  // TODO implementation validation
  todoValidation: {
    totalTodos: number;
    implementedTodos: number;
    coverage: number;
    missingImplementations: string[];
  };

  // Safety validation
  safety: {
    nullChecks: boolean;
    errorHandling: boolean;
    asyncHandling: boolean;
    memoryLeaks: string[];
  };

  overallScore: number;
  recommendation: "proceed" | "retry" | "abort";
}

// ============================================
// Execution Node Types
// ============================================

export interface ExecutionReport {
  timestamp: number;
  durationMs: number;
  executedCodeLength: number;
  createdNodes: Array<{
    id: string;
    name: string;
    type: string;
    parentId?: string | null;
    scenarioId?: string;
    componentKey?: string | null;
    componentName?: string | null;
    variantProperties?: Record<string, string>;
  }>;
  updatedNodes: Array<{
    id: string;
    name: string;
    type: string;
    parentId?: string | null;
    changedProperties: string[];
    componentKey?: string | null;
    componentName?: string | null;
    scenarioId?: string;
    variantProps?: Record<string, string>;
  }>;
  deletedNodeIds: string[];
  selection: Array<{
    id: string;
    name: string;
    type: string;
    parentId?: string | null;
    scenarioId?: string;
  }>;
  createdNodeIds: string[];
  message?: string;
  error?: string;
  scenarios?: ScenarioSpec[];
}

export interface ExecutionResult {
  success: boolean;

  // Node tracking
  nodes: {
    created: Array<{
      id: string;
      name: string;
      type: string;
      todoId: string;
      timestamp: number;
      scenarioId?: string;
      componentKey?: string | null;
      componentName?: string | null;
      variantProps?: Record<string, string>;
    }>;
    modified: Array<{
      id: string;
      changes: string[];
      todoId: string;
      scenarioId?: string;
      variantMatch?: boolean;
      variantProps?: Record<string, string>;
      componentKey?: string | null;
      componentName?: string | null;
    }>;
    deleted: string[];
  };

  // Execution logs
  logs: {
    info: string[];
    warnings: string[];
    errors: Array<{
      message: string;
      type: string;
      stack?: string;
    }>;
  };

  // Performance metrics
  performance: {
    totalTime: number;
    apiCallTime: number;
    renderTime: number;
    memoryUsage: number;
  };

  // Promise tracking
  promises: {
    resolved: number;
    rejected: number;
    rejectionReasons: string[];
  };

  report?: ExecutionReport;
}

// ============================================
// Verification Node Types
// ============================================

export interface VerificationResult {
  // TODO completion
  todoCompletion: {
    total: number;
    completed: number;
    partial: number;
    failed: number;

    details: Array<{
      todoId: string;
      task: string;
      status: "completed" | "partial" | "failed";
      actualResult: any;
      expectedResult: any;
      match: boolean;
    }>;
  };

  // Quality assessment
  quality: {
    layoutCorrectness: number;
    visualConsistency: number;
    accessibilityScore: number;
    performanceScore: number;
  };

  // Improvement suggestions
  suggestions: Array<{
    type: "improvement" | "fix" | "optimization";
    description: string;
    priority: "low" | "medium" | "high";
    autoFixAvailable: boolean;
  }>;

  // Final verdict
  verdict: {
    acceptable: boolean;
    requiresManualReview: boolean;
    criticalIssues: string[];
  };
}

// ============================================
// Main Workflow State
// ============================================

export interface FigmaCodeWorkflowState {
  // Input data
  userPrompt: string;
  figmaContext?: FigmaContext;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
  }>;

  // Node results
  plan?: PlanningResult;
  analysis?: AnalysisResult; // Legacy - replaced by design
  design?: DesignResult; // New: TodoDesign-based design decisions
  generation?: GenerationResult;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  verification?: VerificationResult;
  blueprint?: ProductBlueprint;
  componentGuides?: ComponentGuideMap;

  // Legacy fields (for backward compatibility)
  analysisResult?: any; // Legacy
  generatedCode?: string; // Legacy
  validationResult?: {
    isValid: boolean;
    errors?: string[];
    warnings?: string[];
  }; // Legacy
  executionResult?: ExecutionResult;
  previousErrors?: Array<{
    code: string;
    error: string;
    timestamp: number;
  }>; // Legacy
  executionErrors?: Array<{
    code: string;
    errorMessage: string;
    errorType:
      | "readonly"
      | "null_node"
      | "promise_rejection"
      | "api"
      | "unknown";
    timestamp: number;
    promiseRejections?: Array<{ reason: string; stack: string }>;
  }>; // Legacy

  // Workflow control
  currentStep: string;
  retryCount: number;
  maxRetries: number;
  partialRetry: boolean;
  stateVersion: string;
  stepHistory: string[];
  lastStepCompleted?: string;
  lastUpdatedAt?: number;
  requestedContext?: RequestedContext;
  collectedContext: CollectedContext;

  // Learning and improvement
  learning?: string;
  errorHistory: Array<{
    code: string;
    errorMessage: string;
    errorType: string;
    timestamp: number;
  }>;
  successPatterns: Array<{
    pattern: string;
    frequency: number;
    averageTime: number;
  }>;

  // Real-time tracking
  thoughts: string[];
  messages: any[];
  isComplete: boolean;
  error?: string;
  runLog: RunLogEntry[];
  executionReport?: ExecutionReport;
}

// ============================================
// Error Recovery Types
// ============================================

export interface ErrorPattern {
  pattern: RegExp;
  type: "syntax" | "runtime" | "api" | "validation" | "unknown";
  suggestedFix: string;
  successRate: number;
  occurrences: number;
}

export interface LearningContext {
  errorPatterns: Map<string, ErrorPattern>;
  successPatterns: Map<string, any>;
  componentUsage: Map<string, number>;
  apiCallFrequency: Map<string, number>;

  // Error recovery strategies
  recoveryStrategies: Map<
    string,
    {
      detection: RegExp;
      solution: string;
      preventionCode: string;
    }
  >;
}

import { readFileSync } from "fs";
import path from "path";

import { FigmaContext } from "../figma/figma-client";
import {
  DesignResult,
  PlanningResult,
  TodoDesign,
} from "../types/workflow-types";

export interface LearningPromptContext {
  summary?: string;
  guides?: string[];
  raw?: string;
}

const extractSpacingTokens = (layout: Record<string, any> = {}): string[] => {
  const spacingFields = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "itemSpacing",
    "counterAxisSpacing",
  ];
  const tokens = new Set<string>();
  spacingFields.forEach((field) => {
    const value = layout[field];
    if (typeof value === "string" && value.includes("space/")) {
      tokens.add(value);
    }
  });
  return [...tokens];
};

const extractSurfaceTokens = (styles: Record<string, any> = {}): string[] => {
  const tokens = new Set<string>();
  if (typeof styles.fills === "string" && styles.fills.includes("semantic/")) {
    tokens.add(styles.fills);
  }
  return [...tokens];
};

const extractEffectTokens = (styles: Record<string, any> = {}): string[] => {
  const tokens = new Set<string>();
  if (typeof styles.effects === "string" && styles.effects) {
    tokens.add(styles.effects);
  }
  return [...tokens];
};

const buildTodoChecklist = (todo: TodoDesign): string[] => {
  const checklist: string[] = [];
  const design = todo.design || ({} as TodoDesign["design"]);

  if (design.component?.properties) {
    checklist.push(
      `컴포넌트 프로퍼티를 setProperties로 설정 (${JSON.stringify(design.component.properties)})`,
    );
  }

  if (design.layout) {
    const layout = design.layout as Record<string, any>;
    Object.entries(layout).forEach(([key, value]) => {
      if (typeof value === "number") {
        checklist.push(`[Layout] ${key} = ${value}`);
      }
    });
    extractSpacingTokens(layout).forEach((token) => {
      checklist.push(
        `[Layout] ${token} 변수를 import하여 padding/spacing에 적용 (space 토큰)`,
      );
    });
  }

  if (design.styles) {
    const styles = design.styles as Record<string, any>;
    if (styles.cornerRadius) {
      checklist.push(
        `[Style] radius 토큰 '${styles.cornerRadius}'를 setBoundVariable 또는 cornerRadius에 적용`,
      );
    }
    extractSurfaceTokens(styles).forEach((token) => {
      checklist.push(`[Style] fill 토큰 '${token}'을 boundVariables로 연결`);
    });
    extractEffectTokens(styles).forEach((token) => {
      checklist.push(`[Style] effect 스타일 '${token}' import 후 적용`);
    });
  }

  if (typeof design.description === "string" && design.description.trim()) {
    const sentences = design.description
      .split(/\n|\.\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    sentences.forEach((sentence) => {
      checklist.push(`설명 구현: ${sentence}`);
      if (
        /type\s*=\s*'password'/i.test(sentence) ||
        /비밀번호.*type/i.test(sentence)
      ) {
        checklist.push(
          "FormField 또는 내부 Input 인스턴스에 password 타입을 적용 (setProperties 또는 setPropertiesInParent)",
        );
      }
    });
  }

  if (design.parent?.insertIndex !== undefined) {
    checklist.push(
      "safeInsertChild(parent, node, insertIndex)를 사용해 인덱스 유효성 검증 후 삽입",
    );
  }

  return checklist;
};

export const generationPrompt = ``;

// TODO 타입별 동적 예시
const TODO_TYPE_EXAMPLES = {
  modify: `
/** MODIFY 예시 - 기존 노드 수정 */
const targetNode = figma.currentPage.findOne(node => node.name === "대상이름");
targetNode['property'] = "새값";
  `,
  create: `
/** CREATE 예시 - 새 노드 생성 및 삽입 */
const component = await figma.importComponentByKeyAsync("key");
const instance = component.createInstance();
safeInsertChild(container, instance, index); // 인덱스 검증 후 삽입 (범위 밖이면 append)
  `,
  delete: `
/** DELETE 예시 - 노드 제거 */
const nodeToRemove = container.findOne(child => child.id === "제거할ID");
if (nodeToRemove) nodeToRemove.remove();
  `,
};

export const createGenerationPrompt = (
  userPrompt: string,
  plan: PlanningResult,
  design: DesignResult,
  learning?: string | LearningPromptContext,
  figmaContext?: FigmaContext,
  componentGuides?: Record<string, string>,
) => {
  const pluginApiPath = path.resolve(
    process.cwd(),
    "type-assets/plugin-api.d.ts",
  );
  let figmaPluginTypeDoc = "\n\n=== Figma Plugin API 레퍼런스 ===\n";
  figmaPluginTypeDoc += readFileSync(pluginApiPath, "utf8");

  // TODO 타입별 동적 예시 선택
  const todoTypes = [
    ...new Set(plan.todoList?.map((todo: any) => todo.type) || []),
  ];
  let dynamicExamples = "";

  todoTypes.forEach((type) => {
    if (TODO_TYPE_EXAMPLES[type as keyof typeof TODO_TYPE_EXAMPLES]) {
      dynamicExamples +=
        TODO_TYPE_EXAMPLES[type as keyof typeof TODO_TYPE_EXAMPLES];
    }
  });

  const helperSnippet = `\n\n=== 안전한 삽입 & 토큰 유틸 ===\nfunction safeInsertChild(parent, node, index) {\n  if (typeof index === "number" && index >= 0 && index <= parent.children.length) {\n    parent.insertChild(index, node);\n  } else {\n    parent.appendChild(node);\n  }\n}\n\nasync function importSpacingVariable(name) {\n  const collection = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(PRIMITIVE_COLLECTION_KEY);\n  const match = collection.find((variable) => variable.name === name);\n  if (!match) throw new Error(\`Spacing variable not found: \${name}\`);\n  return figma.variables.importVariableByKeyAsync(match.key);\n}\n\nasync function importSurfaceVariable(name) {\n  const collection = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(THEME_COLLECTION_KEY);\n  const match = collection.find((variable) => variable.name === name);\n  if (!match) throw new Error(\`Surface variable not found: \${name}\`);\n  return figma.variables.importVariableByKeyAsync(match.key);\n}\n`;

  let contextInfo = "\n\n=== Planning 결과 ===\n";
  contextInfo += `전략: ${plan.strategy}\n`;
  contextInfo += `시나리오 전략: ${plan.scenarioStrategy ?? "(미정)"}\n`;
  if (Array.isArray(plan.scenarios) && plan.scenarios.length > 0) {
    contextInfo += "시나리오 요약:\n";
    plan.scenarios.forEach((scenario) => {
      const pieces = [
        scenario.strategy,
        scenario.baseNodeId ? `base=${scenario.baseNodeId}` : undefined,
        scenario.variantOf ? `variantOf=${scenario.variantOf}` : undefined,
        scenario.pageName ? `page=${scenario.pageName}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
      contextInfo += `- (${scenario.id}) ${scenario.name}: ${pieces}`;
      if (scenario.description) {
        contextInfo += ` — ${scenario.description}`;
      }
      contextInfo += "\n";
    });
  }

  contextInfo += "\nTODO 리스트:\n";

  if (plan.todoList && plan.todoList.length > 0) {
    plan.todoList.forEach((todo: any) => {
      const scenarioLabel = todo.scenarioId ?? "(scenario 미지정)";
      contextInfo += `- [${todo.id}] ${scenarioLabel} :: ${todo.type}: ${todo.task}\n`;
      if (todo.targetNodeId || todo.targetNode) {
        contextInfo += `  targetNodeId: ${todo.targetNodeId || todo.targetNode}\n`;
      }
      if (todo.expectedVariantProps) {
        contextInfo += `  expectedVariantProps: ${JSON.stringify(todo.expectedVariantProps)}\n`;
      }
      if (todo.validation) {
        contextInfo += `  검증: ${todo.validation.checkMethod} - ${todo.validation.expectedResult}\n`;
      }
    });
  }

  // selectedNodes 정보 추가
  if (figmaContext?.selectedNodes && figmaContext.selectedNodes.length > 0) {
    contextInfo += "\n=== 선택된 노드 정보 ===\n";
    figmaContext.selectedNodes.forEach((node: any) => {
      contextInfo += `- ID: ${node.id}, 이름: ${node.name}, 타입: ${node.type}\n`;
      // 텍스트 노드의 현재 내용 정보
      if (node.type === "TEXT" && node.characters) {
        contextInfo += `  현재 텍스트: "${node.characters}"\n`;
      }
      // 프레임 노드의 레이아웃 정보
      if (node.type === "FRAME" && node.layoutMode) {
        contextInfo += `  레이아웃: ${node.layoutMode}\n`;
      }
    });
    contextInfo +=
      "\n**중요**: MODIFY 작업 시 위 노드 ID를 정확히 사용하여 figma.getNodeById()로 찾아서 수정하세요.\n";
  }

  contextInfo += "\n=== Design 결과 ===\n";
  contextInfo += `설계 복잡도: ${design.metadata.complexityScore}/10\n`;
  contextInfo += `디자인 시스템 컴포넌트: ${design.metadata.designSystemComponents}개\n`;
  contextInfo += `커스텀 요소: ${design.metadata.customElements}개\n`;
  contextInfo += `실행 순서: ${design.dependencies.executionOrder.join(" → ")}\n\n`;

  contextInfo += "TODO별 구체적인 디자인 결정:\n";
  design.todoDesigns.forEach((todoDesign) => {
    contextInfo += `\n[${todoDesign.todoId}] ${todoDesign.task}\n`;
    if (todoDesign.scenarioId) {
      contextInfo += `  시나리오: ${todoDesign.scenarioId}\n`;
    }
    contextInfo += `  노드타입: ${todoDesign.design.nodeType}\n`;
    contextInfo += `  노드이름: ${todoDesign.design.nodeName}\n`;
    if (todoDesign.targetNodeId || todoDesign.targetNode) {
      contextInfo += `  targetNodeId: ${todoDesign.targetNodeId || todoDesign.targetNode}\n`;
    }

    // Description (핵심!)
    if (todoDesign.design.description) {
      contextInfo += `  📝 구현지침: ${todoDesign.design.description}\n`;
    }

    // 컴포넌트 정보
    if (todoDesign.design.component) {
      contextInfo += `  컴포넌트: ${todoDesign.design.component.name} (key: ${todoDesign.design.component.key})\n`;
      if (todoDesign.design.component.properties) {
        contextInfo += `  properties: ${JSON.stringify(todoDesign.design.component.properties)}\n`;
      }
    }

    // 레이아웃 정보
    if (todoDesign.design.layout) {
      const layout = todoDesign.design.layout;
      contextInfo += `  레이아웃: ${layout.layoutMode || "NONE"}\n`;
      if (layout.primaryAxisAlignItems) {
        contextInfo += `  주축정렬: ${layout.primaryAxisAlignItems}\n`;
      }
      if (layout.counterAxisAlignItems) {
        contextInfo += `  교차축정렬: ${layout.counterAxisAlignItems}\n`;
      }
      if (layout.itemSpacing) {
        contextInfo += `  간격: ${layout.itemSpacing}\n`;
      }
    }

    // 스타일 정보
    if (todoDesign.design.styles) {
      const styles = todoDesign.design.styles;
      if (styles.textStyleName) {
        contextInfo += `  텍스트스타일: ${styles.textStyleName} \n`;
      }
      if (styles.textStyleKey) {
        contextInfo += `  텍스트스타일키: ${styles.textStyleKey}\n`;
      }
      if (styles.fills) {
        contextInfo += `  채우기: ${styles.fills}\n`;
      }
    }

    // TEXT 노드 전용
    if (todoDesign.design.textContent) {
      contextInfo += `  텍스트내용: "${todoDesign.design.textContent}"\n`;
    }

    // 부모 관계
    if (todoDesign.design.parent) {
      const parent = todoDesign.design.parent;
      if (parent.todoId) {
        contextInfo += `  부모TODO: ${parent.todoId}\n`;
      }
      if (parent.existingNodeId) {
        contextInfo += `  부모노드ID: ${parent.existingNodeId}\n`;
      }
      if (parent.insertIndex !== undefined) {
        contextInfo += `  삽입위치: ${parent.insertIndex}\n`;
      }
    }

    if (todoDesign.design.expectedVariantProps) {
      contextInfo += `  Expected Variant Props: ${JSON.stringify(todoDesign.design.expectedVariantProps)}\n`;
    }

    const checklist = buildTodoChecklist(todoDesign);
    if (checklist.length > 0) {
      contextInfo += `  ✅ 구현 체크리스트:\n    - ${checklist.join("\n    - ")}`;
    }
  });

  const normalizedLearning: LearningPromptContext | undefined =
    typeof learning === "string"
      ? learning.trim()
        ? { summary: learning.trim(), raw: learning }
        : undefined
      : learning;

  if (normalizedLearning) {
    contextInfo += "\n=== 이전 실행 학습 가이드 ===\n";
    if (normalizedLearning.summary) {
      contextInfo += `${normalizedLearning.summary}\n`;
    }
    if (normalizedLearning.guides && normalizedLearning.guides.length > 0) {
      normalizedLearning.guides.forEach((guide) => {
        contextInfo += `- ${guide}\n`;
      });
    }
    if (normalizedLearning.raw) {
      contextInfo += `\n[원본 학습 데이터]\n${normalizedLearning.raw}\n`;
    }
  }


  console.log("learning", normalizedLearning);

  return (
    figmaPluginTypeDoc +
    generationPrompt +
    helperSnippet +
    dynamicExamples +
    contextInfo
  );
};

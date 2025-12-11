/**
 * Figma 코드 검증기
 * AI가 생성한 코드의 타입 안전성과 API 정확성을 검증
 */

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  suggestions: string[];
}

export interface ValidationError {
  line?: number;
  code: string;
  message: string;
  suggestion?: string;
}

export class CodeValidator {
  private static instance: CodeValidator;

  // 존재하지 않는 Figma API 속성들
  private readonly invalidProperties = [
    "primaryAxisSpacing", // -> itemSpacing
    "padding", // -> paddingLeft, paddingRight, paddingTop, paddingBottom
    "margin", // 존재하지 않음
    "gap", // -> itemSpacing
    "align", // -> layoutAlign
    "justify", // 존재하지 않음
    "flexDirection", // -> layoutMode
    "display", // 존재하지 않음
    "position", // 존재하지 않음
    "fillColor", // -> fills 사용
  ];

  // 타입별 유효한 속성
  private readonly validPropertiesByType: Record<string, string[]> = {
    TEXT: [
      "characters",
      "fontSize",
      "fontName",
      "textAlignHorizontal",
      "textAlignVertical",
      "lineHeight",
      "letterSpacing",
    ],
    FRAME: [
      "layoutMode",
      "itemSpacing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "layoutAlign",
      "layoutGrow",
      "primaryAxisSizingMode",
      "counterAxisSizingMode",
    ],
    RECTANGLE: ["fills", "strokes", "strokeWeight", "cornerRadius"],
    COMPONENT: [
      "layoutMode",
      "itemSpacing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "componentPropertyDefinitions",
    ],
  };

  // 필수 타입 체크 패턴
  private readonly typeCheckPatterns = [
    /\.characters\s*=/, // characters 접근
    /\.fontSize\s*=/, // fontSize 접근
    /\.fontName\s*=/, // fontName 접근
    /\.layoutMode\s*=/, // layoutMode 접근
    /\.itemSpacing\s*=/, // itemSpacing 접근
  ];

  private constructor() {}

  static getInstance(): CodeValidator {
    if (!CodeValidator.instance) {
      CodeValidator.instance = new CodeValidator();
    }
    return CodeValidator.instance;
  }

  /**
   * Figma 코드 검증
   */
  validateFigmaCode(code: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // 1. 존재하지 않는 속성 체크
    this.checkInvalidProperties(code, errors);

    // 2. 타입 체크 누락 검증
    this.checkTypeGuards(code, errors, warnings);

    // 3. 폰트 로드 체크
    this.checkFontLoading(code, errors, warnings);

    // 4. null 체크
    this.checkNullHandling(code, warnings);

    // 5. findOne vs findChild 올바른 사용
    this.checkFindMethods(code, warnings, suggestions);

    // 6. Auto Layout 속성 올바른 사용
    this.checkAutoLayoutProperties(code, errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * 존재하지 않는 속성 체크
   */
  private checkInvalidProperties(
    code: string,
    errors: ValidationError[],
  ): void {
    this.invalidProperties.forEach((prop) => {
      const regex = new RegExp(`\\.${prop}\\s*=`, "g");
      const matches = code.match(regex);

      if (matches) {
        const suggestions: Record<string, string> = {
          primaryAxisSpacing: "itemSpacing",
          padding:
            "paddingLeft, paddingRight, paddingTop, paddingBottom을 개별 설정",
          gap: "itemSpacing",
          align: "layoutAlign",
          flexDirection: "layoutMode",
        };

        errors.push({
          code: `INVALID_PROPERTY_${prop.toUpperCase()}`,
          message: `'${prop}'는 Figma API에 존재하지 않는 속성입니다.`,
          suggestion: suggestions[prop]
            ? `'${suggestions[prop]}' 사용`
            : undefined,
        });
      }
    });
  }

  /**
   * 타입 가드 체크
   */
  private checkTypeGuards(
    code: string,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    // characters 속성 접근 시 타입 체크 확인
    if (code.includes(".characters")) {
      if (!code.includes("type === 'TEXT'") && !code.includes("as TextNode")) {
        errors.push({
          code: "MISSING_TYPE_CHECK",
          message: "characters 속성 접근 전 TextNode 타입 체크가 필요합니다.",
          suggestion:
            "if (node.type === 'TEXT') { (node as TextNode).characters = '텍스트'; }",
        });
      }
    }

    // layoutMode 접근 시 타입 체크
    if (code.includes(".layoutMode") || code.includes(".itemSpacing")) {
      if (
        !code.includes("type === 'FRAME'") &&
        !code.includes("type === 'COMPONENT'") &&
        !code.includes("as FrameNode")
      ) {
        warnings.push(
          "Auto Layout 속성 접근 시 FrameNode 타입 체크를 권장합니다.",
        );
      }
    }
  }

  /**
   * 폰트 로드 체크
   */
  private checkFontLoading(
    code: string,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    if (code.includes(".characters =") || code.includes(".fontSize =")) {
      if (!code.includes("loadFontAsync") && !code.includes("loadFont")) {
        errors.push({
          code: "MISSING_FONT_LOAD",
          message:
            "TextNode의 characters나 fontSize 설정 전 폰트 로드가 필요합니다.",
          suggestion:
            'await figma.loadFontAsync({ family: "Pretendard", style: "Regular" });',
        });
      }
    }
  }

  /**
   * null 체크
   */
  private checkNullHandling(code: string, warnings: string[]): void {
    // findOne, findChild 사용 시 null 체크
    if (code.includes("findOne(") || code.includes("findChild(")) {
      const hasNullCheck =
        code.includes("if (") &&
        (code.includes("!== null") || code.includes("&& "));
      if (!hasNullCheck) {
        warnings.push("findOne/findChild 결과에 대한 null 체크를 권장합니다.");
      }
    }
  }

  /**
   * find 메서드 올바른 사용
   */
  private checkFindMethods(
    code: string,
    warnings: string[],
    suggestions: string[],
  ): void {
    // 직접 자식만 검색해야 하는 경우
    if (code.includes(".findOne(")) {
      suggestions.push(
        "직접 자식만 검색하려면 findChild()를 사용하세요. findOne()은 전체 서브트리를 검색합니다.",
      );
    }

    // 잘못된 findOne 사용 (존재하지 않는 메서드가 아니라 사용법 문제)
    const findOnePattern = /(\w+)\.findOne\(/g;
    let match;
    while ((match = findOnePattern.exec(code)) !== null) {
      const varName = match[1];
      if (!code.includes(`${varName}.type`) && !code.includes("as FrameNode")) {
        warnings.push(`'${varName}'가 ChildrenMixin을 구현하는지 확인하세요.`);
      }
    }
  }

  /**
   * Auto Layout 속성 체크
   */
  private checkAutoLayoutProperties(
    code: string,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    // layoutMode 없이 itemSpacing 설정
    if (code.includes(".itemSpacing") && !code.includes(".layoutMode")) {
      warnings.push("itemSpacing 설정 전 layoutMode 확인을 권장합니다.");
    }

    // TextNode 생성 시 폰트 로드 체크
    if (code.includes("createText")) {
      if (!code.includes("await figma.loadFontAsync")) {
        errors.push({
          code: "MISSING_FONT_LOAD",
          message:
            "TextNode 생성 시 폰트 로드 필수 (await figma.loadFontAsync)",
          suggestion:
            'await figma.loadFontAsync({ family: "Pretendard", style: "Regular" });',
        });
      }
    }

    // 잘못된 padding 설정
    if (code.match(/\.padding\s*=\s*\d+/)) {
      errors.push({
        code: "INVALID_PADDING",
        message:
          "padding 속성은 존재하지 않습니다. paddingLeft, paddingRight, paddingTop, paddingBottom을 개별 설정하세요.",
        suggestion:
          "frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = 20;",
      });
    }
  }

  /**
   * 코드 수정 제안
   */
  fixCode(code: string): string {
    let fixedCode = code;

    // primaryAxisSpacing -> itemSpacing
    fixedCode = fixedCode.replace(/\.primaryAxisSpacing/g, ".itemSpacing");

    // padding 일괄 설정 수정
    fixedCode = fixedCode.replace(
      /(\w+)\.padding\s*=\s*(\d+)/g,
      "$1.paddingLeft = $1.paddingRight = $1.paddingTop = $1.paddingBottom = $2",
    );

    // gap -> itemSpacing
    fixedCode = fixedCode.replace(/\.gap/g, ".itemSpacing");

    // flexDirection -> layoutMode
    fixedCode = fixedCode.replace(
      /\.flexDirection\s*=\s*['"]row['"]/g,
      ".layoutMode = 'HORIZONTAL'",
    );
    fixedCode = fixedCode.replace(
      /\.flexDirection\s*=\s*['"]column['"]/g,
      ".layoutMode = 'VERTICAL'",
    );

    // fillColor -> fills (TextNode의 색상 설정)
    fixedCode = fixedCode.replace(
      /(\w+)\.fillColor\s*=\s*\{r:\s*([\d.]+),\s*g:\s*([\d.]+),\s*b:\s*([\d.]+)\}/g,
      '$1.fills = [{type: "SOLID", color: {r: $2, g: $3, b: $4}}]',
    );

    return fixedCode;
  }

  /**
   * 검증 결과를 사용자 친화적 메시지로 변환
   */
  formatValidationMessage(result: ValidationResult): string {
    if (result.isValid) {
      return "✅ 코드 검증 통과";
    }

    let message = "❌ 코드 검증 실패\n\n";

    if (result.errors.length > 0) {
      message += "**오류:**\n";
      result.errors.forEach((error) => {
        message += `- ${error.message}`;
        if (error.suggestion) {
          message += ` (제안: ${error.suggestion})`;
        }
        message += "\n";
      });
    }

    if (result.warnings.length > 0) {
      message += "\n**경고:**\n";
      result.warnings.forEach((warning) => {
        message += `- ${warning}\n`;
      });
    }

    if (result.suggestions.length > 0) {
      message += "\n**개선 제안:**\n";
      result.suggestions.forEach((suggestion) => {
        message += `- ${suggestion}\n`;
      });
    }

    return message;
  }
}

// 싱글톤 인스턴스 export
export const codeValidator = CodeValidator.getInstance();

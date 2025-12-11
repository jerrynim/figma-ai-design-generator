import fs from "fs";
import path from "path";
import ts from "typescript";

/**
 * TypeScript-based validator for Figma API code
 * Uses TypeScript compiler API to validate code against plugin-api.d.ts
 */
export class TypeScriptValidator {
  private compilerOptions: ts.CompilerOptions;

  constructor() {
    this.compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      lib: ["ES2015", "ES2020", "DOM"],
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      noResolve: false,
      suppressOutputPathCheck: true,
      allowJs: true,
      checkJs: false,
      noLib: false,
    };
  }

  /**
   * Main validation method
   * @param codeString - JavaScript/TypeScript code to validate
   * @returns Validation result with detailed errors and suggestions
   */
  async validateFigmaCode(codeString: string): Promise<ValidationResult> {
    try {
      // Create source file for both syntax and semantic checking
      const fileName = "temp-validation.ts";
      const sourceFile = ts.createSourceFile(
        fileName,
        codeString,
        ts.ScriptTarget.ES2020,
        true,
      );

      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];

      // Skip basic syntax checking as we'll do comprehensive checking below

      // TypeScript semantic checking with Figma types
      if (errors.length === 0) {
        try {
          const program = this.createProgram(fileName, codeString);

          const programSourceFile = program.getSourceFile(fileName);
          if (programSourceFile) {
            // Get semantic diagnostics
            const semanticDiagnostics =
              program.getSemanticDiagnostics(programSourceFile);

            for (const diagnostic of semanticDiagnostics) {
              const line = diagnostic.start
                ? programSourceFile.getLineAndCharacterOfPosition(
                    diagnostic.start,
                  ).line + 1
                : 0;

              const message = ts.flattenDiagnosticMessageText(
                diagnostic.messageText,
                "\n",
              );

              // Skip JavaScript dynamic property errors that are common and acceptable
              if (this.shouldIgnoreTypeError(message)) {
                continue;
              }

              errors.push({
                type: "TYPE_ERROR",
                message: message,
                line: line,
                suggestion: this.getSuggestionForError(message),
                code: this.extractCodeFragment(codeString, line),
              });
            }
          }
        } catch (typeError: any) {
          console.warn(
            `TypeScript semantic analysis failed: ${typeError.message}`,
          );
        }
      }

      // Add Figma-specific validations
      const figmaErrors = this.validateFigmaSpecifics(sourceFile, codeString);
      const allErrors = [...errors, ...figmaErrors];

      // Generate learning context for AI
      const learningContext = this.generateLearningContext(allErrors, warnings);

      return {
        success: allErrors.length === 0,
        errors: allErrors,
        warnings: warnings,
        learningContext: learningContext,
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [
          {
            type: "VALIDATION_ERROR",
            message: `TypeScript validation failed: ${error.message}`,
            line: 0,
            suggestion: "Check code syntax and structure",
            code: "",
          },
        ],
        warnings: [],
        learningContext:
          "Validation system error occurred. Please check the code syntax.",
      };
    }
  }

  /**
   * Create TypeScript program with Figma type definitions
   */
  private createProgram(fileName: string, codeString: string): ts.Program {
    const files = new Map<string, string>();

    // plugin-api.d.ts 파일 읽기
    let figmaGlobals = "";
    // plugin-api.d.ts 파일 경로 설정
    const pluginApiPath = path.resolve(
      process.cwd(),
      "type-assets/plugin-api.d.ts",
    );
    const figmaIndexPath = path.resolve(
      process.cwd(),
      "type-assets/figma-plugin-index.d.ts",
    );
    if (fs.existsSync(pluginApiPath)) {
      figmaGlobals += fs.readFileSync(figmaIndexPath, "utf-8");
      figmaGlobals += fs.readFileSync(pluginApiPath, "utf-8");
    } else {
      console.warn(
        `plugin-api.d.ts not found at ${pluginApiPath}, using fallback types`,
      );
    }

    files.set("figma-globals.d.ts", figmaGlobals);
    files.set(fileName, codeString);

    // Promise와 기본 타입 정의 추가
    const promiseDefinition = `
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}

interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T>(values: readonly T[]): Promise<T[]>;
  race<T>(values: readonly T[]): Promise<T>;
}

declare var Promise: PromiseConstructor;

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}
`;

    // Promise 정의를 먼저 추가
    files.set("promise.d.ts", promiseDefinition);

    const host: ts.CompilerHost = {
      getSourceFile: (name, target) => {
        try {
          // TypeScript 내장 라이브러리 파일 처리
          if (name.includes("lib.") && name.endsWith(".d.ts")) {
            return ts.createSourceFile(
              name,
              "",
              target || ts.ScriptTarget.ES2020,
              false,
            );
          }

          const content = files.get(name);
          if (content !== undefined) {
            return ts.createSourceFile(
              name,
              content,
              target || ts.ScriptTarget.ES2020,
              true,
            );
          }
          return undefined;
        } catch (error: any) {
          return undefined;
        }
      },
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getDirectories: () => [],
      fileExists: (name) => {
        // 라이브러리 파일은 존재한다고 가정
        if (name.includes("lib.") && name.endsWith(".d.ts")) {
          return true;
        }
        return files.has(name);
      },
      readFile: (name) => files.get(name) || undefined,
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      getDefaultLibFileName: (options) => ts.getDefaultLibFileName(options),
      resolveModuleNames: () => [],
    };

    return ts.createProgram(
      ["promise.d.ts", "figma-globals.d.ts", fileName],
      this.compilerOptions,
      host,
    );
  }

  /**
   * Figma-specific validations
   */
  private validateFigmaSpecifics(
    sourceFile: ts.SourceFile,
    codeString: string,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for common Figma API mistakes
    const patterns = [
      {
        regex:
          /\.appendChild\([^)]+\)[\s\S]*?\.layoutSizingHorizontal\s*=\s*["']FILL["']/g,
        error: "Setting layout properties after appendChild",
        suggestion: "Set layout properties before adding to parent",
      },
    ];

    patterns.forEach(({ regex, error, suggestion }) => {
      const matches = codeString.match(regex);
      if (matches) {
        matches.forEach((match) => {
          const line = this.getLineNumber(codeString, match);
          errors.push({
            type: "FIGMA_API_ERROR",
            message: error,
            line: line,
            suggestion: suggestion,
            code: match.substring(0, 100),
          });
        });
      }
    });

    // Walk the AST to find specific patterns
    const visit = (node: ts.Node) => {
      // Check for color format issues
      if (ts.isObjectLiteralExpression(node)) {
        const colorError = this.validateColorFormat(node, sourceFile);
        if (colorError) errors.push(colorError);
      }

      // Check for Figma API patterns
      if (ts.isPropertyAccessExpression(node)) {
        const figmaError = this.validateFigmaApiUsage(node, sourceFile);
        if (figmaError) errors.push(figmaError);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return errors;
  }

  /**
   * Validate color format {r, g, b} with 0-1 range
   */
  private validateColorFormat(
    node: ts.ObjectLiteralExpression,
    sourceFile: ts.SourceFile,
  ): ValidationError | null {
    const properties = node.properties;
    const hasR = properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "r",
    );
    const hasG = properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "g",
    );
    const hasB = properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "b",
    );
    const hasA = properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "a",
    );

    if (hasR && hasG && hasB) {
      if (hasA) {
        return {
          type: "COLOR_FORMAT",
          message: 'Color objects must not include "a" (alpha) property',
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          suggestion:
            'Remove "a" property, use only {r, g, b} format. Set opacity separately.',
          code: node.getText().substring(0, 100),
        };
      }

      // Check for values outside 0-1 range
      for (const prop of properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          if (["r", "g", "b"].includes(prop.name.text)) {
            if (ts.isNumericLiteral(prop.initializer)) {
              const value = parseFloat(prop.initializer.text);
              if (value < 0 || value > 1) {
                return {
                  type: "COLOR_FORMAT",
                  message: `Color values must be between 0 and 1, got ${value}`,
                  line:
                    sourceFile.getLineAndCharacterOfPosition(node.getStart())
                      .line + 1,
                  suggestion: `Convert ${value} to 0-1 range (divide by 255 if needed)`,
                  code: node.getText().substring(0, 100),
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Validate Figma API usage patterns
   */
  private validateFigmaApiUsage(
    node: ts.PropertyAccessExpression,
    sourceFile: ts.SourceFile,
  ): ValidationError | null {
    if (ts.isIdentifier(node.expression) && node.expression.text === "figma") {
      const methodName = node.name.text;

      // Extended Figma API method checks
      const validMethods = [
        "currentPage",
        "root",
        "viewport",
        "mixed",
        "ui",
        "clientStorage",
        "parameters",
        "teamLibrary",
        "createFrame",
        "createRectangle",
        "createText",
        "createEllipse",
        "createLine",
        "createPolygon",
        "createStar",
        "createVector",
        "createGroup",
        "createSlice",
        "createComponent",
        "createComponentSet",
        "createInstance",
        "createBooleanOperation",
        "createPage",
        "closePlugin",
        "notify",
        "showUI",
        "importComponentByKeyAsync",
        "importStyleByKeyAsync",
        "importComponentSetByKeyAsync",
        "getLocalPaintStyles",
        "getLocalTextStyles",
        "getLocalEffectStyles",
        "getLocalGridStyles",
        "createPaintStyle",
        "createTextStyle",
        "createEffectStyle",
        "createGridStyle",
        "getNodeById",
        "getNodeByIdAsync",
        "getStyleById",
        "loadFontAsync",
        "listAvailableFontsAsync",
        "exportAsync",
        "getImageAsync",
        "loadAsync",
        "saveAsync",
        "createImage",
        "createImagePaint",
        "createSolidPaint",
        "createGradientPaint",
        "variables",
        "createVariable",
        "createVariableCollection",
      ];

      if (!validMethods.includes(methodName)) {
        return {
          type: "FIGMA_API",
          message: `Unknown Figma API method: figma.${methodName}`,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          suggestion: `Check Figma Plugin API documentation for correct method name. Common methods include: createFrame, createRectangle, createText, importComponentByKeyAsync`,
          code: node.getText().substring(0, 100),
        };
      }
    }

    return null;
  }

  /**
   * Check if a TypeScript error should be ignored
   */
  private shouldIgnoreTypeError(message: string): boolean {
    const ignoredPatterns = [
      // 기존 패턴들
      /Property '(findOne|find|length|characters)' does not exist on type/,
      /Cannot find name 'mainFrame'/,
      /Cannot find name 'selection'/,
      /Cannot find name 'Error'/,
      /Cannot find name 'console'/,

      // Figma 속성 관련 에러들 (브라켓 표기법 사용 위해 무시)
      /Property '[^']+' does not exist on type '(SceneNode|PageNode|DocumentNode)'/,
      /Property '(textStyleId|fontName|fontSize|letterSpacing|lineHeight|textDecoration|paragraphIndent|paragraphSpacing|textCase)' does not exist on type/,
      /Property '(fills|strokes|effects|constraints|cornerRadius|topLeftRadius|topRightRadius|bottomLeftRadius|bottomRightRadius)' does not exist on type/,
      /Property '(layoutMode|primaryAxisSizingMode|counterAxisSizingMode|itemSpacing|paddingTop|paddingRight|paddingBottom|paddingLeft)' does not exist on type/,
      /Property '(resize|resizeWithoutConstraints|rotation|opacity|blendMode|isMask|visible|locked)' does not exist on type/,
      /Property '(width|height|x|y|relativeTransform|absoluteTransform)' does not exist on type/,
      /Property '(children|appendChild|insertChild|findChild)' does not exist on type/,
      /Property '(parent|remove|clone|createInstance)' does not exist on type/,

      // VariableValue 타입 관련 에러들 (Figma 변수 시스템 사용 위해 무시)
      /Type 'VariableValue' is not assignable to type 'number'/,
      /Type 'string' is not assignable to type 'number'/,
      /Type 'VariableValue' is not assignable to type/,

      // Iterator 관련 에러들 (for...of 구문에서 발생하는 타입 에러 무시)
      /Type '\{\}' must have a '\[Symbol\.iterator\]\(\)' method that returns an iterator/,
      /Type '.*?' must have a '\[Symbol\.iterator\]\(\)' method that returns an iterator/,
      /Property '\[Symbol\.iterator\]' is missing in type/,
      /Type 'unknown' must have a '\[Symbol\.iterator\]\(\)' method/,
    ];

    return ignoredPatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Generate suggestions for common errors
   */
  private getSuggestionForError(message: string): string {
    if (message.includes("Property") && message.includes("does not exist")) {
      return "Check property name spelling and Figma API documentation";
    }

    if (message.includes("Type") && message.includes("is not assignable")) {
      return "Check type compatibility with Figma API interfaces";
    }

    if (message.includes("Cannot find name")) {
      return "Ensure all variables and functions are properly defined";
    }

    if (message.includes("await") || message.includes("Promise")) {
      return "Async methods require await keyword. Store result in variable before using.";
    }

    return "Review TypeScript and Figma API documentation";
  }

  /**
   * Extract code fragment around error line
   */
  private extractCodeFragment(code: string, line: number): string {
    const lines = code.split("\n");
    const startLine = Math.max(0, line - 2);
    const endLine = Math.min(lines.length, line + 1);

    return lines.slice(startLine, endLine).join("\n").substring(0, 200);
  }

  /**
   * Get line number for a match in code
   */
  private getLineNumber(code: string, match: string): number {
    const index = code.indexOf(match);
    if (index === -1) return 0;

    return code.substring(0, index).split("\n").length;
  }

  /**
   * Generate learning context for AI from errors
   */
  private generateLearningContext(
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): string {
    if (errors.length === 0 && warnings.length === 0) {
      return "Code validation successful. No issues found.";
    }

    let context = "=== 코드 검증 결과 ===\n\n";

    if (errors.length > 0) {
      context += "❌ 에러 발견:\n";
      errors.forEach((error, index) => {
        context += `\n${index + 1}. ${error.type} (${error.line}번 줄)\n`;
        context += `   문제: ${error.message}\n`;
        context += `   해결방법: ${error.suggestion}\n`;
        if (error.code) {
          context += `   코드: ${error.code}\n`;
        }
      });
    }

    if (warnings.length > 0) {
      context += "\n⚠️ 경고:\n";
      warnings.forEach((warning, index) => {
        context += `${index + 1}. ${warning.message}\n`;
      });
    }

    context += "\n위 문제들을 모두 수정하여 다시 코드를 생성해주세요.";
    context += "\n특히 async/await 사용, 변수 할당, 타입 호환성에 주의하세요.";

    return context;
  }
}

// Type definitions for validation results
export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  learningContext: string;
}

export interface ValidationError {
  type:
    | "SYNTAX_ERROR"
    | "TYPE_ERROR"
    | "FIGMA_API_ERROR"
    | "COLOR_FORMAT"
    | "FIGMA_API"
    | "VALIDATION_ERROR";
  message: string;
  line: number;
  suggestion: string;
  code: string;
}

export interface ValidationWarning {
  message: string;
}

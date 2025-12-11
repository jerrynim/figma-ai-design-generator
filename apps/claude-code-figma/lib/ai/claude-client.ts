import Anthropic from "@anthropic-ai/sdk";
import { codeValidator } from "./code-validator";

export interface ClaudeStreamingOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface ClaudeMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ClaudeCompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

class ClaudeClient {
  private client: Anthropic;

  constructor() {
    if (!process.env.NEXT_ANTHROPIC_API_KEY) {
      throw new Error("NEXT_ANTHROPIC_API_KEY is not set");
    }

    this.client = new Anthropic({
      apiKey: process.env.NEXT_ANTHROPIC_API_KEY,
    });
  }

  // 기본 완료 메서드
  async complete(
    messages: ClaudeMessage[],
    options: ClaudeCompletionOptions = {},
  ): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: options.model || "claude-4-5-haiku",
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature || 0.1,
        messages: messages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        ...(options.systemPrompt && { system: options.systemPrompt }),
      });

      const content = response.content[0];
      if (content.type === "text") {
        return content.text;
      } else {
        throw new Error("Unexpected response type");
      }
    } catch (error) {
      console.error("Claude API error:", error);
      throw error;
    }
  }

  // 코드 추출 유틸리티
  extractCode(response: string): string {
    // 코드 블록이 있다면 추출
    const codeBlockMatch = response.match(
      /```(?:javascript|js)?\n([\s\S]*?)\n```/,
    );
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // 코드 블록이 없으면 그대로 반환
    return response.trim();
  }

  // 코드 유효성 검증
  async validateCode(code: string): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    try {
      const result = await codeValidator.validateFigmaCode(code);
      return {
        isValid: result.isValid,
        errors: result.errors.map((error) => error.message),
        warnings: result.warnings,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [
          `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
        warnings: [],
      };
    }
  }
}

export const claudeClient = new ClaudeClient();

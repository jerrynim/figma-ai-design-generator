import { NextResponse } from "next/server";

import { FigmaContext } from "@/lib/figma/figma-client";
import {
  FigmaCodeWorkflowState,
  RequestedContext,
} from "@/lib/types/workflow-types";
import { FigmaCodeGenerateWorkflow } from "@/lib/workflows/figma-code-generate-workflow";

type WorkflowAction = "start" | "continue" | "resume";

interface WorkflowStepRequest {
  action: WorkflowAction;
  userPrompt?: string;
  figmaContext?: FigmaContext;
  conversationHistory?: Array<any>;
  previousError?: string;
  state?: FigmaCodeWorkflowState;
  contextUpdate?: {
    nodeDetails?: Record<string, any>;
    assets?: Record<string, any>;
    answers?: Record<string, string>;
  };
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

function badRequest(error: string) {
  return NextResponse.json<WorkflowStepResponse>(
    {
      success: false,
      completed: false,
      step: "error",
      nextStep: "error",
      state: undefined,
      requestedContext: { nodeIds: [], assets: [], questions: [] },
      timestamp: Date.now(),
      error,
    },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WorkflowStepRequest;
    const workflow = new FigmaCodeGenerateWorkflow();

    if (!body?.action) {
      return badRequest("action 필드가 필요합니다.");
    }

    let result;

    switch (body.action) {
      case "start": {
        if (!body.userPrompt) {
          return badRequest("userPrompt가 필요합니다.");
        }

        const initialState = workflow.createInitialState(
          body.userPrompt,
          body.figmaContext,
          body.conversationHistory,
          body.previousError,
        );
        result = await workflow.executeStep(initialState);
        break;
      }

      case "continue":
      case "resume": {
        if (!body.state) {
          return badRequest("state가 필요합니다.");
        }

        result = await workflow.executeStep(body.state, {
          contextUpdate: body.contextUpdate,
        });
        break;
      }

      default:
        return badRequest(`지원하지 않는 action입니다: ${body.action}`);
    }

    const response: WorkflowStepResponse = {
      success: true,
      completed: result.completed,
      step: result.step,
      nextStep: result.nextStep,
      state: result.state,
      requestedContext: result.requestedContext,
      timestamp: Date.now(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ [workflow/step] 요청 처리 실패:", error);
    return NextResponse.json<WorkflowStepResponse>(
      {
        success: false,
        completed: false,
        step: "error",
        nextStep: "error",
        state: undefined,
        requestedContext: { nodeIds: [], assets: [], questions: [] },
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

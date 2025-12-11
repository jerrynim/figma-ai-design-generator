import { FigmaCodeGenerateWorkflow } from "../../../../lib/workflows/figma-code-generate-workflow";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userMessage, figmaContext, conversationHistory, previousError } =
      body;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          // thought를 SSE로 전송하는 콜백
          const onThoughtCallback = (thought: string) => {
            const data = JSON.stringify({
              type: "thought",
              content: thought,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          // progress를 SSE로 전송하는 콜백
          const onProgressCallback = (
            message: string,
            type: "thinking" | "complete" | "error",
          ) => {
            const data = JSON.stringify({
              type: "status",
              content: message,
              statusType: type,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          // 워크플로우 생성 및 실행
          const workflow = new FigmaCodeGenerateWorkflow(
            onThoughtCallback,
            onProgressCallback,
          );

          // 워크플로우 실행 (figmaContext는 이미 전달받음)
          const result = await workflow.executeWorkflow(
            userMessage,
            figmaContext,
            conversationHistory,
            previousError,
          );

          // 최종 결과 전송
          if (result.generatedCode && result.isComplete) {
            // 성공적으로 코드 생성됨
            const finalData = JSON.stringify({
              type: "complete",
              result: {
                figmaCode: result.generatedCode,
                thoughts: result.thoughts,
                validationWarnings: result.validationResult?.warnings,
                analysisResult: result.analysisResult,
              },
            });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          } else if (result.error) {
            // 에러 발생
            const errorData = JSON.stringify({
              type: "error",
              error: result.error,
              thoughts: result.thoughts,
              retryCount: result.retryCount,
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          } else {
            // 예상치 못한 상태
            const unexpectedData = JSON.stringify({
              type: "error",
              error: "워크플로우가 예상치 못한 상태로 종료되었습니다",
              state: {
                currentStep: result.currentStep,
                isComplete: result.isComplete,
                hasGeneratedCode: !!result.generatedCode,
              },
            });
            controller.enqueue(encoder.encode(`data: ${unexpectedData}\n\n`));
          }

          controller.close();
        } catch (error) {
          console.error("❌ [Figma Generate Code API] Stream error:", error);

          // 에러 전송
          const errorData = JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));

          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Nginx buffering 비활성화
      },
    });
  } catch (error) {
    console.error("❌ [Figma Generate Code API] POST handler error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

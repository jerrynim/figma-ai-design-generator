import React, { useEffect, useState } from "react";
import { FigmaBridge } from "../services/figma-bridge";
import "./App.css";

/**
 * Figma Plugin UI - 단순히 AI App을 iframe으로 로드
 */
export const App: React.FC = () => {
  const [aiAppStatus, setAiAppStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [figmaBridge] = useState(() => new FigmaBridge());

  useEffect(() => {
    console.log(
      "🔗 [Plugin UI] FigmaBridge initialized for bidirectional routing",
    );
  }, [figmaBridge]);

  const handleIframeLoad = () => {
    setAiAppStatus("ready");
    console.log("✅ AI App loaded successfully");
  };

  const handleIframeError = () => {
    setAiAppStatus("error");
    console.error("❌ Failed to load AI App");
  };

  if (aiAppStatus === "error") {
    return (
      <div className="error-container">
        <h3>⚠️ AI App 연결 오류</h3>
        <p>localhost:3000에서 Claude Code Figma를 먼저 실행해주세요.</p>
        <code>pnpm dev:claude-code</code>
        <button onClick={() => window.location.reload()}>🔄 다시 시도</button>
      </div>
    );
  }

  return (
    <div className="plugin-container">
      {aiAppStatus === "loading" && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>AI App 로드 중...</p>
        </div>
      )}

      <iframe
        id="pluginIframe"
        src="http://localhost:3000"
        title="AI Design Assistant"
        width="100%"
        height="100%"
        frameBorder="0"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        style={{
          display: aiAppStatus === "ready" ? "block" : "none",
          border: "none",
        }}
      />
    </div>
  );
};

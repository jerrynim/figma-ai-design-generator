"use client";

import { ChatInterface } from "@/components/ChatInterface";
import { useTabsDB } from "@/hooks/useTabsDB";

import { useEffect } from "react";
export default function HomePage() {
  const {
    tabs,
    activeTabId,
    isInitialized,
    createTab,
    setActiveTab,
    deleteTab,
  } = useTabsDB();

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case "t":
            e.preventDefault();
            createTab();
            break;
          case "w":
            e.preventDefault();
            if (activeTab) {
              deleteTab(activeTab.id);
            }
            break;
          default:
            if (/^[1-9]$/.test(e.key)) {
              e.preventDefault();
              const tabIndex = parseInt(e.key) - 1;
              if (tabs[tabIndex]) {
                setActiveTab(tabs[tabIndex].id);
              }
            }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tabs, activeTab, createTab, deleteTab, setActiveTab]);

  // 데이터베이스 초기화 중 표시
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold" style={{ marginBottom: 16 }}>
            🚀 Claude Code for Figma
          </h1>
          <p className="text-sm text-gray-500">데이터베이스 초기화 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen text-white">
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          background: "white",
        }}
      >
          <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <div key={tab.id}>
              {tab.title}
                <div>
                  <p onClick={() => deleteTab(tab.id)} />
                </div>
            </div>
          ))}
          <div onClick={() => createTab()}>
            +
          </div>
        </div>
      </div>

      {/* 메인 채팅 인터페이스 */}
      {activeTab && <ChatInterface tab={activeTab} />}
    </div>
  );
}

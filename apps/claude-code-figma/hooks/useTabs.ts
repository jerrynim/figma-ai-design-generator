import type { ConversationTab, TabsState, Message } from "@/types/tabs";
import { v4 as uuidv4 } from "uuid";
import { useLocalStorage } from "./useLocalStorage";
const INITIAL_STATE: TabsState = {
  tabs: [],
  activeTabId: "",
};

export const useTabs = () => {
  const [tabsState, setTabsState] = useLocalStorage(
    "claude-figma-tabs",
    INITIAL_STATE,
  );
  // 초기화 (첫 방문 시 기본 탭 생성)
  const initializeTabs = () => {
    if (tabsState.tabs.length === 0) {
      const firstTab = createNewTabData("New Chat");
      setTabsState({
        tabs: [firstTab],
        activeTabId: firstTab.id,
      });
    }
  };

  // 새 탭 생성
  const createNewTab = (initialMessage?: string) => {
    const title = initialMessage
      ? generateTabTitle(initialMessage)
      : `Chat ${tabsState.tabs.length + 1}`;

    const newTab = createNewTabData(title, initialMessage);
    setTabsState((prev) => ({
      tabs: [...prev.tabs, newTab],
      activeTabId: newTab.id,
    }));

    return newTab.id;
  };

  // 탭 전환
  const switchToTab = (tabId: string) => {
    setTabsState((prev) => ({
      ...prev,
      activeTabId: tabId,
      tabs: prev.tabs.map((tab) => ({
        ...tab,
      })),
    }));
  };

  // 탭 닫기
  const closeTab = (tabId: string) => {
    setTabsState((prev) => {
      const remainingTabs = prev.tabs.filter((tab) => tab.id !== tabId);

      // 마지막 탭은 닫을 수 없음
      if (remainingTabs.length === 0) {
        const newTab = createNewTabData("New Chat");
        return {
          tabs: [newTab],
          activeTabId: newTab.id,
        };
      }

      // 닫힌 탭이 활성 탭이었다면 다른 탭 활성화
      let newActiveTabId = prev.activeTabId;
      if (tabId === prev.activeTabId) {
        const closedIndex = prev.tabs.findIndex((tab) => tab.id === tabId);
        const newActiveIndex = Math.min(closedIndex, remainingTabs.length - 1);
        newActiveTabId = remainingTabs[newActiveIndex].id;
      }

      return {
        tabs: remainingTabs.map((tab) => ({
          ...tab,
          isActive: tab.id === newActiveTabId,
        })),
        activeTabId: newActiveTabId,
      };
    });
  };

  // 탭 제목 업데이트 (첫 번째 메시지 기반)
  const updateTabTitle = (tabId: string, title: string) => {
    setTabsState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, title: generateTabTitle(title) } : tab,
      ),
    }));
  };

  // 메시지 추가
  const addMessage = (
    tabId: string,
    message: Omit<Message, "id" | "timestamp">,
  ) => {
    const newMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date(),
    };

    setTabsState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              messages: [...(tab.messages || []), newMessage],
            }
          : tab,
      ),
    }));

    return newMessage.id;
  };

  // 메시지 업데이트
  const updateMessage = (
    tabId: string,
    messageId: string,
    updates: Partial<Message>,
  ) => {
    setTabsState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              messages: (tab.messages || []).map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg,
              ),
            }
          : tab,
      ),
    }));
  };

  // Figma 컨텍스트 업데이트
  const updateFigmaContext = (tabId: string, context: any) => {
    setTabsState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              lastFigmaContext: context,
            }
          : tab,
      ),
    }));
  };

  // 탭의 메시지 목록 가져오기
  const getTabMessages = (tabId: string): Message[] => {
    const tab = tabsState.tabs.find((t) => t.id === tabId);
    return tab?.messages || [];
  };

  // 현재 활성 탭
  const activeTab = tabsState.tabs.find(
    (tab) => tab.id === tabsState.activeTabId,
  );

  return {
    // 상태
    tabs: tabsState.tabs,
    activeTab,

    // 탭 관리
    initializeTabs,
    createNewTab,
    switchToTab,
    closeTab,
    updateTabTitle,

    // 메시지 관리
    addMessage,
    updateMessage,
    getTabMessages,

    // 컨텍스트 관리
    updateFigmaContext,
  };
};

// 유틸리티 함수들
const createNewTabData = (
  title: string,
  initialMessage?: string,
): ConversationTab => {
  return {
    id: uuidv4(),
    title: initialMessage ? generateTabTitle(initialMessage) : title,
    createdAt: new Date(),
    messages: [],
    lastFigmaContext: null,
  };
};

const generateTabTitle = (message: string): string => {
  const words = message.trim().split(" ").slice(0, 3);
  let title = words.join(" ");

  if (title.length > 20) {
    title = title.substring(0, 17) + "...";
  }

  return title || "New Chat";
};

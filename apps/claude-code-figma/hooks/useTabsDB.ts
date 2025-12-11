import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ConversationTab, Message, TabsState } from "@/types/tabs";
import { db, type ConversationTabDB, type MessageDB } from "@/lib/db";

export const useTabsDB = () => {
  const [tabsState, setTabsState] = useState<TabsState>({
    tabs: [],
    activeTabId: "",
  });
  const [isInitialized, setIsInitialized] = useState(false);

  // IndexedDB에서 탭 목록 로드
  const loadTabs = useCallback(async () => {
    try {
      const dbTabs = await db.getAllTabs();
      const convertedTabs: ConversationTab[] = dbTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        createdAt: tab.createdAt,
        messages: [],
        lastFigmaContext: tab.lastFigmaContext,
      }));

      setTabsState((prev) => ({
        tabs: convertedTabs,
        activeTabId: prev.activeTabId || (convertedTabs[0]?.id ?? ""),
      }));
    } catch (error) {
      console.error("Failed to load tabs:", error);
    }
  }, []);

  // 초기화
  useEffect(() => {
    const initialize = async () => {
      try {
        await db.open();
        await db.migrateFromLocalStorage();
        await loadTabs();
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize DB:", error);
      }
    };

    initialize();
  }, [loadTabs]);

  // 새 탭 생성
  const createTab = useCallback(
    async (title?: string): Promise<string> => {
      const newTab: ConversationTab = {
        id: uuidv4(),
        title: title || `대화 ${tabsState.tabs.length + 1}`,
        createdAt: new Date(),
        messages: [],
      };

      try {
        const tabDB: ConversationTabDB = {
          id: newTab.id,
          title: newTab.title,
          createdAt: newTab.createdAt,
          lastFigmaContext: null,
        };

        await db.createTab(tabDB);

        setTabsState((prev) => ({
          tabs: [...prev.tabs, newTab],
          activeTabId: newTab.id,
        }));

        return newTab.id;
      } catch (error) {
        console.error("Failed to create tab:", error);
        throw error;
      }
    },
    [tabsState.tabs.length],
  );

  // 탭 삭제
  const deleteTab = useCallback(async (tabId: string) => {
    try {
      await db.deleteTab(tabId);

      setTabsState((prev) => {
        const filteredTabs = prev.tabs.filter((tab) => tab.id !== tabId);
        const newActiveTabId =
          prev.activeTabId === tabId
            ? (filteredTabs[0]?.id ?? "")
            : prev.activeTabId;

        return {
          tabs: filteredTabs,
          activeTabId: newActiveTabId,
        };
      });
    } catch (error) {
      console.error("Failed to delete tab:", error);
    }
  }, []);

  // 탭 활성화
  const setActiveTab = useCallback((tabId: string) => {
    setTabsState((prev) => ({
      ...prev,
      activeTabId: tabId,
    }));
  }, []);

  // 탭 제목 업데이트
  const updateTabTitle = useCallback(async (tabId: string, title: string) => {
    try {
      await db.updateTab(tabId, { title });

      setTabsState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, title } : tab,
        ),
      }));
    } catch (error) {
      console.error("Failed to update tab title:", error);
    }
  }, []);

  // 메시지 추가
  const addMessage = useCallback(
    async (
      tabId: string,
      message: Omit<Message, "id" | "timestamp">,
    ): Promise<string> => {
      try {
        const newMessage: Message = {
          id: uuidv4(),
          timestamp: new Date(),
          ...message,
        };

        const messageDB: Omit<MessageDB, "tabId"> = {
          id: newMessage.id,
          role: newMessage.role,
          content: newMessage.content,
          timestamp: newMessage.timestamp,
          streaming: newMessage.streaming,
          figmaContext: newMessage.figmaContext,
        };

        await db.addMessage(tabId, messageDB);
        return newMessage.id;
      } catch (error) {
        console.error("Failed to add message:", error);
        throw error;
      }
    },
    [],
  );

  // 탭의 메시지 목록 가져오기
  const getTabMessages = useCallback(
    async (tabId: string): Promise<Message[]> => {
      try {
        const dbMessages = await db.getTabMessages(tabId);
        return dbMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          streaming: msg.streaming,
          figmaContext: msg.figmaContext,
        }));
      } catch (error) {
        console.error("Failed to get tab messages:", error);
        return [];
      }
    },
    [],
  );

  // Figma 컨텍스트 업데이트
  const updateFigmaContext = useCallback(
    async (tabId: string, figmaContext: any) => {
      try {
        await db.updateTab(tabId, { lastFigmaContext: figmaContext });

        setTabsState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, lastFigmaContext: figmaContext } : tab,
          ),
        }));
      } catch (error) {
        console.error("Failed to update figma context:", error);
      }
    },
    [],
  );

  return {
    // 상태
    tabs: tabsState.tabs,
    activeTabId: tabsState.activeTabId,
    isInitialized,

    // 탭 관리
    createTab,
    deleteTab,
    setActiveTab,
    updateTabTitle,

    // 메시지 관리
    addMessage,
    getTabMessages,

    // Figma 컨텍스트
    updateFigmaContext,
  };
};

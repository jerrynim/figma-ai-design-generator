import type { ConversationTab, Message } from "@/types/tabs";
import Dexie, { type Table } from "dexie";

export interface ConversationTabDB extends Omit<ConversationTab, "messages"> {
  id: string;
  title: string;
  createdAt: Date;
  messages?: string[]; // 메시지 ID 목록
  lastFigmaContext?: any;
}

export interface MessageDB extends Message {
  tabId: string; // 어느 탭에 속하는지
}

export class ClaudeFigmaDatabase extends Dexie {
  // 테이블 정의
  tabs!: Table<ConversationTabDB>;
  messages!: Table<MessageDB>;

  constructor() {
    super("ClaudeFigmaDatabase");

    this.version(1).stores({
      tabs: "id, title, createdAt",
      messages: "++id, tabId, role, timestamp, [tabId+timestamp]",
    });
  }

  // 탭 관련 메서드
  async createTab(tab: Omit<ConversationTabDB, "messages">): Promise<string> {
    const tabWithMessages = { ...tab, messages: [] };
    await this.tabs.add(tabWithMessages);
    return tab.id;
  }

  async getAllTabs(): Promise<ConversationTabDB[]> {
    return await this.tabs.orderBy("createdAt").reverse().toArray();
  }

  async getTab(id: string): Promise<ConversationTabDB | undefined> {
    return await this.tabs.get(id);
  }

  async updateTab(
    id: string,
    changes: Partial<ConversationTabDB>,
  ): Promise<void> {
    await this.tabs.update(id, changes);
  }

  async deleteTab(id: string): Promise<void> {
    await this.transaction("rw", this.tabs, this.messages, async () => {
      await this.tabs.delete(id);
      await this.messages.where("tabId").equals(id).delete();
    });
  }

  // 메시지 관련 메서드
  async addMessage(
    tabId: string,
    message: Omit<MessageDB, "tabId">,
  ): Promise<string> {
    const messageWithTab = { ...message, tabId };
    const messageId = await this.messages.add(messageWithTab);

    // 탭의 메시지 목록 업데이트
    const tab = await this.getTab(tabId);
    if (tab) {
      const messageIds = tab.messages || [];
      messageIds.push(messageId.toString());
      await this.updateTab(tabId, { messages: messageIds });
    }

    return messageId.toString();
  }

  async getTabMessages(tabId: string): Promise<MessageDB[]> {
    return await this.messages
      .where("tabId")
      .equals(tabId)
      .toArray()
      .then((messages) =>
        messages.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ),
      );
  }

  async updateMessage(
    messageId: string,
    changes: Partial<MessageDB>,
  ): Promise<void> {
    await this.messages.update(messageId, changes);
  }

  // 데이터 정리 메서드
  async cleanupOldData(olderThanDays: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await this.transaction("rw", this.tabs, this.messages, async () => {
      const oldTabs = await this.tabs
        .where("createdAt")
        .below(cutoffDate)
        .toArray();
      const oldTabIds = oldTabs.map((tab) => tab.id);

      for (const tabId of oldTabIds) {
        await this.deleteTab(tabId);
      }
    });
  }

  // 데이터 사이즈 확인
  async getDatabaseSize(): Promise<{
    tabs: number;
    messages: number;
  }> {
    return {
      tabs: await this.tabs.count(),
      messages: await this.messages.count(),
    };
  }

  // 마이그레이션: LocalStorage에서 IndexedDB로
  async migrateFromLocalStorage(): Promise<void> {
    try {
      // LocalStorage에서 기존 탭 데이터 가져오기
      const existingTabsData = localStorage.getItem("claude-figma-tabs");
      if (!existingTabsData) return;

      const tabsState = JSON.parse(existingTabsData);

      // IndexedDB가 비어있는지 확인
      const existingCount = await this.tabs.count();
      if (existingCount > 0) {
        return;
      }

      // 탭 데이터 마이그레이션
      for (const tab of tabsState.tabs || []) {
        const tabDB: ConversationTabDB = {
          id: tab.id,
          title: tab.title,
          createdAt: new Date(tab.createdAt),
          messages: [],
          lastFigmaContext: null,
        };

        await this.tabs.add(tabDB);
      }

      console.log(
        `Migrated ${tabsState.tabs?.length || 0} tabs from LocalStorage`,
      );
    } catch (error) {
      console.error("Migration from LocalStorage failed:", error);
    }
  }
}

// 싱글톤 데이터베이스 인스턴스
export const db = new ClaudeFigmaDatabase();

// 데이터베이스 초기화
export async function initializeDatabase(): Promise<void> {
  try {
    await db.open();
    await db.migrateFromLocalStorage();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

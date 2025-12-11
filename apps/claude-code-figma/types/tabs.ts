export interface ConversationTab {
  id: string;
  title: string;
  createdAt: Date;
  messages?: Message[];
  lastFigmaContext?: any;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  figmaContext?: any;
}

export interface TabsState {
  tabs: ConversationTab[];
  activeTabId: string;
}

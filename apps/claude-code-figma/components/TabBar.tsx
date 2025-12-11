"use client";

import type { ConversationTab } from "@/types/tabs";

interface TabBarProps {
  tabs: ConversationTab[];
  activeTabId: string;
  onNewTab: () => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onNewTab,
  onSwitchTab,
  onCloseTab,
}: TabBarProps) {
  return (
    <div className="flex items-center bg-gray-800 border-b border-gray-700 px-4 py-2 min-h-[48px]">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSwitch={() => onSwitchTab(tab.id)}
            onClose={tabs.length > 1 ? () => onCloseTab(tab.id) : undefined}
          />
        ))}
      </div>

      <button
        className="flex items-center gap-1 px-2 py-2 text-gray-400 hover:text-gray-300 hover:bg-gray-700 rounded transition-colors"
        onClick={onNewTab}
      >
        <span className="text-lg">+</span>
      </button>
    </div>
  );
}

function TabButton({
  tab,
  isActive,
  onSwitch,
  onClose,
}: {
  tab: ConversationTab;
  isActive: boolean;
  onSwitch: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={`
        group flex items-center gap-2 px-3 py-2 rounded cursor-pointer
        transition-colors max-w-[200px] min-w-[120px]
        ${
          isActive
            ? "bg-gray-700 text-white"
            : "text-gray-400 hover:bg-gray-700 hover:text-gray-300"
        }
      `}
      onClick={onSwitch}
    >
      <span className="text-sm">💬</span>

      <span className="truncate text-sm font-medium">{tab.title}</span>

      {onClose && (
        <button
          className={`
            opacity-0 group-hover:opacity-100 hover:bg-gray-600 
            rounded p-1 transition-opacity text-xs
            ${isActive ? "opacity-100" : ""}
          `}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

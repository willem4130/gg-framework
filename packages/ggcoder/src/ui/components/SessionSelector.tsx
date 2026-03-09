import React from "react";
import type { SessionInfo } from "../../core/session-manager.js";
import { Overlay } from "./Overlay.js";
import { SelectList } from "./SelectList.js";

interface SessionSelectorProps {
  sessions: SessionInfo[];
  onSelect: (sessionPath: string) => void;
  onCancel: () => void;
}

export function SessionSelector({ sessions, onSelect, onCancel }: SessionSelectorProps) {
  const items = sessions.map((s) => ({
    label: `${s.id.slice(0, 8)} — ${s.timestamp}`,
    value: s.path,
    description: `${s.messageCount} messages`,
  }));

  return (
    <Overlay title="Select Session">
      <SelectList items={items} onSelect={onSelect} onCancel={onCancel} />
    </Overlay>
  );
}

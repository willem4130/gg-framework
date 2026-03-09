import React from "react";
import type { Settings } from "../../core/settings-manager.js";
import { Overlay } from "./Overlay.js";
import { SelectList } from "./SelectList.js";

interface SettingsSelectorProps {
  settings: Settings;
  onSelect: (key: string) => void;
  onCancel: () => void;
}

export function SettingsSelector({ settings, onSelect, onCancel }: SettingsSelectorProps) {
  const items = Object.entries(settings).map(([key, value]) => ({
    label: key,
    value: key,
    description: String(value),
  }));

  return (
    <Overlay title="Settings">
      <SelectList items={items} onSelect={onSelect} onCancel={onCancel} />
    </Overlay>
  );
}

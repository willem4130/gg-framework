import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/theme.js";

interface SelectListItem {
  label: string;
  value: string;
  description?: string;
}

interface SelectListProps {
  items: SelectListItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  initialIndex?: number;
}

export function SelectList({ items, onSelect, onCancel, initialIndex = 0 }: SelectListProps) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) || item.value.toLowerCase().includes(lower),
    );
  }, [items, filter]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (filtered.length > 0) {
        onSelect(filtered[selectedIndex].value);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setFilter((f) => f + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column">
      {filter && (
        <Box marginBottom={1}>
          <Text color={theme.textDim}>Filter: {filter}</Text>
        </Box>
      )}
      {filtered.map((item, index) => (
        <Box key={item.value}>
          <Text color={index === selectedIndex ? theme.primary : theme.text}>
            {index === selectedIndex ? "❯ " : "  "}
            {item.label}
          </Text>
          {item.description && <Text color={theme.textDim}> — {item.description}</Text>}
        </Box>
      ))}
      {filtered.length === 0 && <Text color={theme.textDim}>No matches</Text>}
      <Box marginTop={1}>
        <Text color={theme.textDim}>↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}

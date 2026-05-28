import React from "react";
import type { BossDisplayItem } from "./boss-ui-items.js";
import { BossTranscriptRow } from "./boss-transcript-rows.js";

interface RenderBossTranscriptItemOptions {
  item: BossDisplayItem;
  index: number;
  items: BossDisplayItem[];
  pendingHistoryFlushLastItem?: BossDisplayItem;
  historyLastItem?: BossDisplayItem;
}

export function renderBossTranscriptItem({
  item,
  index,
  items,
  pendingHistoryFlushLastItem,
  historyLastItem,
}: RenderBossTranscriptItemOptions): React.ReactNode {
  const previousRow =
    index > 0 ? items[index - 1] : (pendingHistoryFlushLastItem ?? historyLastItem);
  return <BossTranscriptRow row={item} previousRow={previousRow} />;
}

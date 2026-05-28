import { useTranscriptHistory } from "@kenkaiiii/ggcoder/ui/hooks/transcript-history";
import type { TerminalHistoryContext } from "@kenkaiiii/ggcoder/ui/terminal-history";
import type { BossDisplayItem } from "./boss-ui-items.js";
import type { BossTerminalHistoryPrinter } from "./boss-terminal-history.js";

interface UseBossTranscriptHistoryOptions {
  terminalHistoryPrinter?: BossTerminalHistoryPrinter;
  terminalHistoryContext: TerminalHistoryContext;
  writeStdout: (data: string) => void;
  history: readonly BossDisplayItem[];
  setHistory: React.Dispatch<React.SetStateAction<BossDisplayItem[]>>;
  setLiveItems: React.Dispatch<React.SetStateAction<BossDisplayItem[]>>;
  sessionStore?: {
    history?: BossDisplayItem[];
    liveItems?: BossDisplayItem[];
  };
}

export function useBossTranscriptHistory({
  terminalHistoryPrinter,
  terminalHistoryContext,
  writeStdout,
  history,
  setHistory,
  setLiveItems,
  sessionStore,
}: UseBossTranscriptHistoryOptions) {
  return useTranscriptHistory<BossDisplayItem>({
    terminalHistoryPrinter,
    terminalHistoryContext,
    writeStdout,
    sessionPathRef: { current: undefined },
    sessionManagerRef: { current: null },
    sessionStore,
    history,
    setHistory,
    setLiveItems,
    compactHistoryItems: (items: BossDisplayItem[]) => items,
    trimFlushItems: (items: BossDisplayItem[]) =>
      items.filter((item) => item.kind !== "compacting"),
  });
}

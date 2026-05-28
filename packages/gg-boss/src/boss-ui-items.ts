import type { WorkerStatus } from "./types.js";

export interface BossUserItem {
  kind: "user";
  id: string;
  text: string;
  timestamp: number;
}

export interface BossAssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  durationMs?: number;
  thinking?: string;
  thinkingMs?: number;
  continuation?: boolean;
}

export interface BossToolStartItem {
  kind: "tool_start";
  id: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  startedAt: number;
  animateUntil: number;
  progressOutput?: string;
}

export interface BossToolDoneItem {
  kind: "tool_done";
  id: string;
  toolCallId?: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
  details?: unknown;
}

export interface BossWorkerEventItem {
  kind: "worker_event";
  id: string;
  project: string;
  status: WorkerStatus;
  finalText: string;
  toolsUsed: { name: string; ok: boolean }[];
  turnIndex: number;
  timestamp: string;
}

export interface BossWorkerErrorItem {
  kind: "worker_error";
  id: string;
  project: string;
  message: string;
  timestamp: string;
}

export interface BossInfoItem {
  kind: "info";
  id: string;
  text: string;
  level?: "info" | "warning" | "error";
}

export interface BossTaskDispatchItem {
  kind: "task_dispatch";
  id: string;
  tasks: { project: string; title: string }[];
  timestamp: number;
}

export interface BossUpdateNoticeItem {
  kind: "update_notice";
  id: string;
  text: string;
}

export interface BossCompactingItem {
  kind: "compacting";
  id: string;
}

export interface BossCompactedItem {
  kind: "compacted";
  id: string;
  originalCount: number;
  newCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface BossStoppedItem {
  kind: "stopped";
  id: string;
  text: string;
}

export interface BossBannerItem {
  kind: "banner";
  id: string;
}

export type BossDisplayItem =
  | BossUserItem
  | BossAssistantItem
  | BossToolStartItem
  | BossToolDoneItem
  | BossWorkerEventItem
  | BossWorkerErrorItem
  | BossInfoItem
  | BossTaskDispatchItem
  | BossUpdateNoticeItem
  | BossCompactingItem
  | BossCompactedItem
  | BossStoppedItem;

export type BossTranscriptItem = BossBannerItem | BossDisplayItem;

/**
 * Context Manager 核心。
 *
 * 职责（README 第一阶段）：
 * - Token 计算与 Context Window 限制（暂定 32K）
 * - 保留 System Prompt 与最近相关消息
 * - 超限时以整轮为单位裁剪旧历史，保证工具调用/结果配对完整
 * - 将被裁剪的历史压缩成 Summary 并注入 Context
 */
import type { AgentInputItem } from '@openai/agents';
import type OpenAI from 'openai';
import { estimateItemsTokens, estimateTokens } from './tokenizer.js';
import { Summarizer } from './summarizer.js';
import {
  DEFAULT_CONTEXT_CONFIG,
  type ContextBuildResult,
  type ContextConfig,
  type ContextStats,
} from './types.js';

/** 一轮对话 = 一条用户消息及其后的全部条目，直到下一条用户消息之前 */
function splitRounds(items: AgentInputItem[]): AgentInputItem[][] {
  const rounds: AgentInputItem[][] = [];
  let current: AgentInputItem[] = [];
  for (const item of items) {
    if (item.type === 'message' && item.role === 'user' && current.length > 0) {
      rounds.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) rounds.push(current);
  return rounds;
}

export class ContextManager {
  private config: ContextConfig;
  private summarizer: Summarizer;
  private summary: string | null = null;
  private lastStats: ContextStats | null = null;

  constructor(client: OpenAI, config?: Partial<ContextConfig>) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    this.summarizer = new Summarizer(client);
  }

  /** 输入预算 = 总窗口 - 预留输出 */
  get inputBudget(): number {
    return this.config.maxTokens - this.config.reservedOutputTokens;
  }

  /** 最近一次构建的统计信息（/context 调试命令用） */
  getStats(): ContextStats | null {
    return this.lastStats;
  }

  /** 当前摘要内容（/summary 调试命令用） */
  getSummary(): string | null {
    return this.summary;
  }

  /** 清空摘要与统计（/clear 命令时调用） */
  reset(): void {
    this.summary = null;
    this.lastStats = null;
  }

  /** 构建本轮发送给模型的上下文：裁剪 + 摘要注入 + 统计 */
  async build(
    historyItems: AgentInputItem[],
    systemPrompt: string,
  ): Promise<ContextBuildResult> {
    const inputBudget = this.inputBudget;
    const systemTokens = estimateTokens(systemPrompt);
    const summaryTokens = this.summary ? estimateTokens(this.summary) : 0;
    const baseTokens = summaryTokens + systemTokens;

    const rounds = splitRounds(historyItems);

    // 始终完整保留最近 N 轮（含工具调用/结果，保证配对与最近相关性）
    const keepCount = Math.min(this.config.keepRecentRounds, rounds.length);
    const recent = rounds.slice(rounds.length - keepCount);
    const older = rounds.slice(0, rounds.length - keepCount);

    const recentTokens = estimateItemsTokens(recent.flat());
    const olderTokens = older.map((round) => estimateItemsTokens(round));
    let keptTokens = baseTokens + recentTokens + olderTokens.reduce((a, b) => a + b, 0);

    // 从最旧处逐轮移出，直到满足输入预算（仅发生在轮之间，单轮超限时容忍）
    const trimmed: AgentInputItem[] = [];
    let keptOlderCount = older.length;
    while (keptOlderCount > 0 && keptTokens > inputBudget) {
      trimmed.push(...older[older.length - keptOlderCount]);
      keptTokens -= olderTokens[older.length - keptOlderCount];
      keptOlderCount--;
    }
    const trimmedRounds = older.length - keptOlderCount;

    // 有被裁剪的内容时，生成或合并摘要（不阻塞主流程：摘要失败则沿用旧摘要或跳过）
    if (trimmedRounds > 0) {
      try {
        const newSummary = await this.summarizer.summarize(trimmed, this.summary);
        if (newSummary) this.summary = newSummary;
      } catch (err) {
        console.error(
          `[摘要生成失败] ${err instanceof Error ? err.message : err}（继续使用未摘要的历史发送）`,
        );
      }
    }

    // 组装待发送 items：摘要(system message) + 保留的旧轮 + 最近轮
    const items: AgentInputItem[] = [];
    if (this.summary) {
      items.push({ type: 'message', role: 'system', content: this.summary });
    }
    for (let i = 0; i < keptOlderCount; i++) {
      items.push(...older[i]);
    }
    for (const round of recent) {
      items.push(...round);
    }

    const sentTokens = estimateItemsTokens(items) + systemTokens;
    this.lastStats = {
      totalTokens: estimateItemsTokens(historyItems) + systemTokens,
      sentTokens,
      inputBudget,
      sentItems: items.length,
      trimmedRounds,
      hasSummary: this.summary !== null,
      trimmed: trimmedRounds > 0,
    };

    return { items, stats: this.lastStats };
  }
}

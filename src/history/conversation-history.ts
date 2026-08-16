/**
 * 内存版对话历史存储。
 *
 * 现阶段只在内存中保存全部对话条目（用户消息、助手消息、工具调用与结果等），
 * 不写入磁盘。后续阶段可在此基础上扩展：token 计算、裁剪、摘要、持久化等。
 */
import type { AgentInputItem } from '@openai/agents';
import type { HistoryStats, ItemCategory } from './types.js';

/**
 * 历史数据的来源：只需提供 history 字段即可同步。
 * 与 RunState 泛型解耦，便于后续其他来源（如持久化恢复）复用。
 */
export interface HistorySource {
  history: AgentInputItem[];
}

/** 将条目归类，用于分类统计 */
function categorize(item: AgentInputItem): ItemCategory {
  if (item.type === 'message') {
    if (item.role === 'user') return 'user';
    if (item.role === 'assistant') return 'assistant';
    if (item.role === 'system') return 'system';
  }
  if (item.type === 'function_call' || item.type === 'hosted_tool_call') {
    return 'tool_call';
  }
  if (item.type === 'function_call_result') {
    return 'tool_result';
  }
  return 'other';
}

export class ConversationHistory {
  /** 全部历史条目（按时间顺序） */
  private items: AgentInputItem[] = [];

  /** 追加一条用户消息（进入一轮对话前调用） */
  addUserMessage(content: string): void {
    this.items.push({ type: 'message', role: 'user', content });
  }

  /**
   * 同步本轮 run 的结果。
   *
   * state.history 的结构为「本次发送给模型的 items（SDK 原样保留在前部）+ 本轮新增条目（追加在后部）」。
   * 因此传入 sentItems 时采用增量合并：完整历史 = 当前已有历史（含被裁剪部分）+ 新增条目，
   * 从而保证 Context 裁剪不会导致旧历史丢失。
   * 若前缀校验失败（SDK 行为变化），回退为全量替换。
   *
   * @param source   run 结果（含 history）
   * @param sentItems 本次实际发送给模型的 items（Context 裁剪后）；不传则全量替换
   */
  syncFromState(source: HistorySource, sentItems?: AgentInputItem[]): void {
    if (sentItems && source.history.length >= sentItems.length) {
      const prefixMatches = sentItems.every((item, i) => {
        const got = source.history[i];
        return got === item || JSON.stringify(got) === JSON.stringify(item);
      });
      if (prefixMatches) {
        this.items.push(...source.history.slice(sentItems.length));
        return;
      }
    }
    this.items = source.history;
  }

  /** 获取当前全部历史条目的副本（避免外部直接修改内部状态） */
  getItems(): AgentInputItem[] {
    return [...this.items];
  }

  /** 清空历史（/clear 命令） */
  clear(): void {
    this.items = [];
  }

  /** 条目总数 */
  get size(): number {
    return this.items.length;
  }

  /** 分类统计，用于查看当前内存中保存了哪些条目 */
  getStats(): HistoryStats {
    const stats: HistoryStats = {
      total: this.items.length,
      userMessages: 0,
      assistantMessages: 0,
      systemMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      other: 0,
    };
    for (const item of this.items) {
      switch (categorize(item)) {
        case 'user':
          stats.userMessages++;
          break;
        case 'assistant':
          stats.assistantMessages++;
          break;
        case 'system':
          stats.systemMessages++;
          break;
        case 'tool_call':
          stats.toolCalls++;
          break;
        case 'tool_result':
          stats.toolResults++;
          break;
        default:
          stats.other++;
          break;
      }
    }
    return stats;
  }

  // TODO(后续阶段)：实现 save()/load()，将历史持久化到文本
}

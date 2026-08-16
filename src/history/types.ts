/**
 * History 模块的类型定义
 */

/** 历史条目分类 */
export type ItemCategory =
  | 'user' // 用户消息
  | 'assistant' // 助手消息
  | 'system' // 系统消息
  | 'tool_call' // 工具调用（function_call / hosted_tool_call 等）
  | 'tool_result' // 工具结果
  | 'other'; // 其他条目

/** 历史条目分类统计 */
export interface HistoryStats {
  /** 条目总数 */
  total: number;
  /** 用户消息条数 */
  userMessages: number;
  /** 助手消息条数 */
  assistantMessages: number;
  /** 系统消息条数 */
  systemMessages: number;
  /** 工具调用条数 */
  toolCalls: number;
  /** 工具结果条数 */
  toolResults: number;
  /** 其他条目条数（如 reasoning） */
  other: number;
}

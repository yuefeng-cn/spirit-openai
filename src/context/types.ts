/**
 * Context Manager 的类型定义
 */
import type { AgentInputItem } from '@openai/agents';

/** Context 预算配置 */
export interface ContextConfig {
  /** 上下文窗口总上限（token），暂定 32K */
  maxTokens: number;
  /** 为模型输出预留的 token，输入预算 = maxTokens - reservedOutputTokens */
  reservedOutputTokens: number;
  /** 裁剪时始终完整保留的最近轮数（轮 = 一条用户消息及其全部助手输出） */
  keepRecentRounds: number;
  /** 摘要输出 token 上限 */
  summaryMaxTokens: number;
}

/** 默认配置：8K 窗口（便于快速测试触发上限），预留 4K 输出，保留最近 1 轮 */
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 8192,
  reservedOutputTokens: 4096,
  keepRecentRounds: 1,
  summaryMaxTokens: 1024,
};

/** 每次构建 Context 的统计信息（供 /context 调试命令展示） */
export interface ContextStats {
  /** 全部历史的估算 token（裁剪前） */
  totalTokens: number;
  /** 实际发送的估算 token（含摘要与 System Prompt） */
  sentTokens: number;
  /** 输入预算（maxTokens - reservedOutputTokens） */
  inputBudget: number;
  /** 发送的条目数 */
  sentItems: number;
  /** 被裁剪的轮数 */
  trimmedRounds: number;
  /** 是否有摘要生效 */
  hasSummary: boolean;
  /** 是否发生过裁剪 */
  trimmed: boolean;
}

/** 构建结果：待发送的 items + 统计 */
export interface ContextBuildResult {
  items: AgentInputItem[];
  stats: ContextStats;
}

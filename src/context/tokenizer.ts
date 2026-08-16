/**
 * Token 计算。
 *
 * 使用 tiktoken 的 cl100k_base 编码对 token 数做估算。
 * DeepSeek 官方建议使用 cl100k_base 近似其 tokenizer，与 GPT-4 系同源，
 * 对本项目的上下文裁剪已足够准确。
 */
import { get_encoding, type Tiktoken } from 'tiktoken';
import type { AgentInputItem } from '@openai/agents';

/** 编码实例（懒加载、全局复用） */
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('cl100k_base');
  }
  return encoder;
}

/** 估算一段文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

/** 将一条历史条目序列化为文本，用于估算 token */
function serializeItem(item: AgentInputItem): string {
  switch (item.type) {
    case 'message':
      // 用户 / 助手 / 系统消息
      if (typeof item.content === 'string') {
        return `${item.role}: ${item.content}`;
      }
      return `${item.role}: ${JSON.stringify(item.content)}`;
    case 'function_call':
      return `function_call ${item.name}(${item.arguments ?? ''})`;
    case 'function_call_result':
      return `function_call_result ${item.name}: ${JSON.stringify(item.output)}`;
    case 'hosted_tool_call':
      return `hosted_tool_call ${item.name}(${item.arguments ?? ''})`;
    case 'reasoning':
      return `reasoning: ${JSON.stringify(item.content)}`;
    default:
      return JSON.stringify(item);
  }
}

/** 估算一条历史条目的 token 数 */
export function estimateItemTokens(item: AgentInputItem): number {
  return estimateTokens(serializeItem(item));
}

/** 估算多条历史条目的 token 数 */
export function estimateItemsTokens(items: AgentInputItem[]): number {
  let total = 0;
  for (const item of items) {
    total += estimateItemTokens(item);
  }
  return total;
}

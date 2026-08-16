/**
 * 历史摘要生成。
 * 将裁剪掉的历史对话压缩成 Summary，并在多次裁剪时与旧摘要合并。
 */
import type { AgentInputItem } from '@openai/agents';
import type OpenAI from 'openai';
import { DEFAULT_CONTEXT_CONFIG } from './types.js';

/** 提取条目中的用户/助手文本消息（工具调用噪音不计入摘要） */
function extractDialogueText(items: AgentInputItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
      const content =
        typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      lines.push(`${item.role === 'user' ? '用户' : '助手'}: ${content}`);
    }
  }
  return lines;
}

export class Summarizer {
  constructor(private client: OpenAI) {}

  /**
   * 生成或合并摘要。
   * @param trimmedItems 本轮被裁剪掉的历史条目
   * @param previousSummary 已有的旧摘要；无则为 null
   * @returns 新的摘要文本（可能为空字符串）
   */
  async summarize(
    trimmedItems: AgentInputItem[],
    previousSummary: string | null,
  ): Promise<string> {
    const dialogue = extractDialogueText(trimmedItems);
    if (dialogue.length === 0) {
      // 被裁剪部分没有可摘要的对话文本（如全是工具条目），保留旧摘要
      return previousSummary ?? '';
    }

    const content =
      previousSummary
        ? `【已有的历史摘要】\n${previousSummary}\n\n【本次新增的被裁剪对话】\n${dialogue.join('\n')}`
        : `【被裁剪的对话】\n${dialogue.join('\n')}`;

    const completion = await this.client.chat.completions.create({
      model: process.env.OPENAI_MODEL_ID ?? '',
      messages: [
        { role: 'system', content: '你是一个专业的对话摘要助手。' },
        {
          role: 'user',
          content:
            '请把以下对话压缩成简洁的摘要，保留：\n' +
            '1. 用户提出的关键问题与需求\n' +
            '2. 助手给出的关键结论、事实与建议\n' +
            '3. 对后续对话有价值的上下文（如用户偏好、进行中的任务）\n' +
            '\n' +
            '要求：\n' +
            '- 直接输出摘要内容，不要任何前缀或解释\n' +
            '- 若提供了"已有的历史摘要"，需与新增内容合并、去重后输出一份完整摘要\n' +
            '- 使用中文\n' +
            '- 控制长度，只保留重要信息\n' +
            `\n${content}`,
        },
      ],
      max_tokens: DEFAULT_CONTEXT_CONFIG.summaryMaxTokens,
    });

    const summary = completion.choices[0]?.message?.content?.trim() ?? '';
    return summary || (previousSummary ?? '');
  }
}

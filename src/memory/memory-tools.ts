/**
 * Memory 工具：模型自主读写长期记忆。
 * - remember：遇到长期有效决策或项目关键事实时保存（零额外 API 调用，嵌入主 run）
 * - retrieve_memory：需要回忆之前保存的信息时按需检索（不每轮注入 Context）
 */
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { MemoryStore } from './memory-store.js';
import type { MemoryCategory } from './types.js';

const RememberSchema = z.object({
  category: z.enum(['decision', 'fact']).describe('记忆类别：decision 长期有效决策，fact 项目关键事实'),
  topic: z.string().describe('主题/关键词，简洁，用于索引与检索（如"前端框架"）'),
  content: z.string().describe('记忆内容，完整描述要保存的信息'),
});

const RetrieveSchema = z.object({
  query: z.string().describe('要查找的记忆主题或关键词'),
});

/** 创建记忆读写工具（绑定指定的记忆仓库） */
export function createMemoryTools(store: MemoryStore) {
  const rememberTool = tool({
    name: 'remember',
    description:
      '保存一条长期记忆。仅当出现以下情况时调用：用户做出的长期有效决策（如风格偏好、既定方案），' +
      '或项目的关键事实（如技术栈、重要约定）。一次性的问答信息不值得保存。' +
      '若与已保存记忆主题相同，会自动合并更新。',
    parameters: RememberSchema,
    execute: async (args: z.infer<typeof RememberSchema>) => {
      const result = store.add({ category: args.category as MemoryCategory, topic: args.topic, content: args.content });
      return result.added ? '已保存到记忆仓库。' : '该记忆已存在，已合并更新。';
    },
  });

  const retrieveTool = tool({
    name: 'retrieve_memory',
    description:
      '按需检索长期记忆。当需要回忆用户之前告知的偏好、项目关键事实或长期决策时调用，' +
      '传入查询主题即可返回相关记忆内容。',
    parameters: RetrieveSchema,
    execute: async (args: z.infer<typeof RetrieveSchema>) => {
      const results = store.search(args.query);
      if (results.length === 0) return '没有找到相关记忆。';
      return results
        .map((m) => `[${m.category}] 主题：${m.topic}\n${m.content}`)
        .join('\n\n');
    },
  });

  return [rememberTool, retrieveTool] as const;
}

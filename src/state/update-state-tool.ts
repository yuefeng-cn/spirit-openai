/**
 * update_state 工具：模型在对话中维护任务状态的入口。
 * 模型在用户提出新任务、任务推进、步骤完成或产生关键决策时调用。
 * 参数用 zod 定义（strict 模式），模型每次调用给出完整的最新状态，SDK 自动解析校验。
 */
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { TaskStateStore } from './task-state.js';
import type { TaskStateUpdate } from './types.js';

/** update_state 参数：完整最新状态（全部必填，列表为空表示清空） */
const UpdateStateSchema = z.object({
  task: z.string().describe('当前任务的简要描述（无任务时传空字符串）'),
  step: z.string().describe('当前正在执行的步骤（无步骤时传空字符串）'),
  completed: z.array(z.string()).describe('已完成事项列表（整体替换）'),
  pending: z.array(z.string()).describe('待完成事项列表（整体替换）'),
  decisions: z.array(z.string()).describe('关键决策列表（整体替换）'),
});

/** 创建 update_state 工具（绑定指定的状态存储） */
export function createUpdateStateTool(store: TaskStateStore) {
  return tool({
    name: 'update_state',
    description:
      '更新当前任务的执行状态。当用户提出新任务、任务推进、步骤完成、事项变化或产生关键决策时调用。' +
      '每次调用请给出完整的最新状态：task 为当前任务（无任务传空字符串）、step 为当前步骤（无步骤传空字符串）、' +
      'completed 为已完成事项列表、pending 为待完成事项列表、decisions 为关键决策列表。' +
      '列表字段整体替换当前值，传空数组表示清空。',
    parameters: UpdateStateSchema,
    execute: async (args: z.infer<typeof UpdateStateSchema>) => {
      store.apply(args as TaskStateUpdate);
      return '任务状态已更新。';
    },
  });
}

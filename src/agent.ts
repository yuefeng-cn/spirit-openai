/**
 * Agent 定义与初始化。
 * 环境变量直接通过 process.env 读取（不单独建 config 模块）。
 */
import { OpenAI } from 'openai';
import { Agent, setDefaultOpenAIClient, type Tool } from '@openai/agents';
import { TaskStateStore, createUpdateStateTool } from './state/index.js';

// 读取环境变量并校验，返回确定类型
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[启动失败] 缺少环境变量 ${name}，请检查 .env`);
    process.exit(1);
  }
  return value;
}

// 使用 .env 中配置的自定义客户端（如 DeepSeek 的兼容端点），供 Agent 与摘要请求共享
// eslint-disable-next-line
const customClient = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});
setDefaultOpenAIClient(customClient);

/** 共享的 OpenAI 客户端（Agent 内部与摘要生成等均使用） */
export const openaiClient = customClient;

const model = requireEnv('OPENAI_MODEL_ID');

// 内置联网搜索工具：由模型在请求期间直接执行（hosted_tool），无需本地代码。
// 仅 Responses API 路径支持（官方 Codex 集成声明 web_search_tool_type: "text"）。
const webSearchTool: Tool = {
  type: 'hosted_tool',
  name: 'web_search',
  providerData: { type: 'web_search' },
};

// 任务状态存储（与 History 解耦）与更新工具
const taskStateStore = new TaskStateStore();
const updateStateTool = createUpdateStateTool(taskStateStore);

/** 共享的任务状态存储（供主循环注入 Context、调试命令使用） */
export { taskStateStore };

export const agent = new Agent({
  name: 'History Tutor',
  instructions:
    'You provide assistance with historical queries. Explain important events and context clearly. ' +
    'If the question involves recent, uncertain or unknown information, use the built-in web_search tool to verify before answering. ' +
    'When the user proposes a new task, advances a task, completes a step, or makes a key decision, ' +
    'call the update_state tool to keep the task state current.',
  model,
  tools: [updateStateTool, webSearchTool],
});

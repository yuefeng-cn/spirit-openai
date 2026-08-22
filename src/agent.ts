/**
 * Agent 定义与初始化。
 * 环境变量直接通过 process.env 读取（不单独建 config 模块）。
 */
import { OpenAI } from 'openai';
import { Agent, setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents';
import type { Tool } from '@openai/agents';
import { TaskStateStore, createUpdateStateTool } from './state/index.js';
import { MemoryStore, createMemoryTools } from './memory/index.js';

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

// 切换到 Chat Completions API（/v1/chat/completions），兼容 DeepSeek 等第三方端点。
// 注意：Chat Completions 路径不支持 hosted web_search 工具，故本轮不启用联网工具。
setOpenAIAPI('chat_completions');

/** 共享的 OpenAI 客户端（Agent 内部与摘要生成等均使用） */
export const openaiClient = customClient;

const model = requireEnv('OPENAI_MODEL_ID');

// 任务状态存储（与 History 解耦）与更新工具
const taskStateStore = new TaskStateStore();
const updateStateTool = createUpdateStateTool(taskStateStore);

/** 共享的任务状态存储（供主循环注入 Context、调试命令使用） */
export { taskStateStore };

// 会话级长期记忆仓库（内存 + 主题索引 + 按需加载）与读写工具
const memoryStore = new MemoryStore();
const memoryTools = createMemoryTools(memoryStore);

/** 共享的记忆仓库（供主循环调试命令使用） */
export { memoryStore };

const BASE_INSTRUCTIONS =
  'You are a helpful assistant that can chat, answer questions, generate images, and edit images. ' +
  'For image generation, call generate_image. For image editing, call edit_image with the reference to the target image. ' +
  'If a user refers to an image ambiguously (e.g. "this image" but multiple candidates exist), ' +
  'return the clarification message from the tool rather than guessing. ' +
  'When the user proposes a new task, call update_state to keep task state current. ' +
  'When the user states long-term preferences or key facts, call remember. ' +
  'When you need to recall saved information, call retrieve_memory. ' +
  '请用中文回复用户。';

/**
 * 创建 Agent 实例，可追加额外工具（如图片工具）。
 * index.ts 在会话初始化后调用此工厂以注入 ImageService 绑定的工具。
 */
export function createAgent(extraTools: readonly Tool[] = []): Agent {
  return new Agent({
    name: 'Spirit',
    instructions: BASE_INSTRUCTIONS,
    model,
    tools: [...memoryTools, updateStateTool, ...extraTools] as Tool[],
  });
}

/** 不带图片工具的默认 agent（向后兼容，测试用） */
export const agent = createAgent();

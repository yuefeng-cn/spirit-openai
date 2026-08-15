import 'dotenv/config'; // 加载 .env 中的环境变量
import { OpenAI } from 'openai';
import { Agent, run, setDefaultOpenAIClient, getGlobalTraceProvider } from '@openai/agents';

// 禁用 trace 上报（自定义端点不支持 SDK 的遥测导出，避免非致命报错噪音）
getGlobalTraceProvider().setDisabled(true);

// 使用 .env 中配置的自定义客户端（如 DeepSeek 的兼容端点）
const customClient = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});
setDefaultOpenAIClient(customClient);

const agent = new Agent({
  name: 'History Tutor',
  instructions:
    'You provide assistance with historical queries. Explain important events and context clearly.',
  model: process.env.OPENAI_MODEL_ID, // 显式指定模型，避免 SDK 默认模型不适用于当前端点
});

const result = await run(agent, 'When did sharks first appear?');

console.log(result.finalOutput);

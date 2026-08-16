import 'dotenv/config'; // 加载 .env 中的环境变量
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OpenAI } from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  getGlobalTraceProvider,
  type AgentInputItem,
  type Tool,
} from '@openai/agents';

// 禁用 trace 上报（自定义端点不支持 SDK 的遥测导出，避免非致命报错噪音）
getGlobalTraceProvider().setDisabled(true);

// 读取环境变量并校验，返回确定类型
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[启动失败] 缺少环境变量 ${name}，请检查 .env`);
    process.exit(1);
  }
  return value;
}

// 使用 .env 中配置的自定义客户端（如 DeepSeek 的兼容端点）
const customClient = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});
setDefaultOpenAIClient(customClient);

const model = requireEnv('OPENAI_MODEL_ID');

// 内置联网搜索工具：由模型在请求期间直接执行（hosted_tool），无需本地代码。
// 仅 Responses API 路径支持（官方 Codex 集成声明 web_search_tool_type: "text"）。
const webSearchTool: Tool = {
  type: 'hosted_tool',
  name: 'web_search',
  providerData: { type: 'web_search' },
};

const agent = new Agent({
  name: 'History Tutor',
  instructions:
    'You provide assistance with historical queries. Explain important events and context clearly. ' +
    'If the question involves recent, uncertain or unknown information, use the built-in web_search tool to verify before answering.',
  model,
  tools: [webSearchTool],
});

// 终端配色
const color = {
  user: (s: string) => `\x1b[36m${s}\x1b[0m`, // 青色：用户
  assistant: (s: string) => `\x1b[32m${s}\x1b[0m`, // 绿色：助手
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`, // 暗色：提示
  error: (s: string) => `\x1b[31m${s}\x1b[0m`, // 红色：错误
};

// 帮助信息
const helpText = `
${color.dim('可用命令：')}
  /help            显示本帮助
  /clear           清空当前会话上下文，开启新一轮对话
  /exit, /quit     退出程序（也可按 Ctrl+C 或 Ctrl+D）
${color.dim('直接输入内容即可与助手对话；需要最新信息时助手会自动联网搜索。')}
`;

// 打印助手回复：非流式一次性输出。
// 注：@openai/agents 走 Responses API，该路径在 DeepSeek 端点上流式不生效（实测一次性返回），已接受此限制。
async function printResponse(history: AgentInputItem[]): Promise<AgentInputItem[]> {
  process.stdout.write(color.dim('正在处理（可能需要联网搜索）…\n'));
  const result = await run(agent, history);
  console.log(color.assistant('助手 > ') + (result.finalOutput ?? ''));
  return result.state.history;
}

// 主循环：readline REPL，多轮对话
async function main() {
  const rl = createInterface({ input, output, terminal: true });

  // 会话历史：每轮结束后用 state.history 同步，保证多轮上下文（含 web_search 调用等）完整
  let history: AgentInputItem[] = [];

  console.log(color.assistant('历史助教已启动，随时提问。') + helpText);

  try {
    while (true) {
      const line = await rl.question(color.user('你 > '));
      const text = line.trim();

      // 空输入：跳过
      if (text === '') continue;

      // 命令处理
      if (text === '/help') {
        console.log(helpText);
        continue;
      }
      if (text === '/clear') {
        history = [];
        console.log(color.dim('会话已清空，开始新对话。'));
        continue;
      }
      if (text === '/exit' || text === '/quit') {
        break;
      }

      // 将本轮用户消息追加到历史，构造完整上下文
      const turnHistory: AgentInputItem[] = [
        ...history,
        { role: 'user', content: text },
      ];

      try {
        history = await printResponse(turnHistory);
      } catch (err) {
        // 单轮失败不中断整个会话
        console.error(color.error(`\n[出错] ${err instanceof Error ? err.message : err}`));
      }
    }
  } catch {
    // Ctrl+C / Ctrl+D / EOF：正常退出循环
  } finally {
    rl.close();
    console.log(color.dim('\n再见！'));
  }
}

main();

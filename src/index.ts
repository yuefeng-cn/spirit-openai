import 'dotenv/config'; // 加载 .env 中的环境变量
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// 使用 .env 中配置的自定义客户端（如 DeepSeek 的兼容端点）
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

// 系统提示词（原 Agent.instructions，首条固定作为 system 消息）
const SYSTEM_INSTRUCTIONS =
  'You provide assistance with historical queries. Explain important events and context clearly.';

// 读取环境变量并校验，返回确定类型（避免 process.env 的 string | undefined 在函数间不传播收窄）
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[启动失败] 缺少环境变量 ${name}，请检查 .env`);
    process.exit(1);
  }
  return value;
}

const model = requireEnv('OPENAI_MODEL_ID');

// 是否开启流式输出（默认开启；可用环境变量 STREAM=false 关闭）
const enableStream = process.env.STREAM !== 'false';

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
${color.dim('直接输入内容即可与助手对话。')}
`;

// 调用模型并打印回复，返回助手完整回复（用于追加到历史）
async function ask(messages: ChatCompletionMessageParam[]): Promise<string> {
  const params = {
    model,
    messages,
  };

  if (enableStream) {
    // 流式模式：Chat Completions 的 SSE 增量，逐 token 打印（DeepSeek 兼容端点原生支持）
    const stream = await client.chat.completions.create({
      ...params,
      stream: true,
    });
    process.stdout.write(color.assistant('助手 > '));
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        full += delta;
        process.stdout.write(delta);
      }
    }
    process.stdout.write('\n');
    return full;
  }

  // 非流式模式：一次性获取完整回复
  const res = await client.chat.completions.create({
    ...params,
    stream: false,
  });
  const content = res.choices[0]?.message?.content ?? '';
  console.log(color.assistant('助手 > ') + content);
  return content;
}

// 主循环：readline REPL，多轮对话
async function main() {
  const rl = createInterface({ input, output, terminal: true });

  // 会话消息历史：首条固定为系统提示词，每轮追加 user/assistant 消息
  let messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_INSTRUCTIONS },
  ];

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
        messages = [{ role: 'system', content: SYSTEM_INSTRUCTIONS }];
        console.log(color.dim('会话已清空，开始新对话。'));
        continue;
      }
      if (text === '/exit' || text === '/quit') {
        break;
      }

      // 追加本轮用户消息
      messages.push({ role: 'user', content: text });

      try {
        const reply = await ask(messages);
        if (reply.trim() !== '') {
          // 仅成功且非空时，把助手回复加入历史，保证多轮上下文完整
          messages.push({ role: 'assistant', content: reply });
        } else {
          messages.pop(); // 模型无输出：回滚本轮 user 消息
        }
      } catch (err) {
        messages.pop(); // 本轮失败：回滚 user 消息，保持历史干净，不中断会话
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

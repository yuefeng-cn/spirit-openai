/**
 * spirit-openai 入口：REPL 多轮对话。
 * - 历史由 ConversationHistory（纯内存）保存全部对话条目，不写入文本文件
 * - Context 由 ContextManager 管理：32K 窗口限制、超限裁剪、历史摘要注入
 */
import 'dotenv/config'; // 加载 .env 中的环境变量
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { run, getGlobalTraceProvider } from '@openai/agents';
import { agent, openaiClient } from './agent.js';
import { color, helpText } from './ui.js';
import { ConversationHistory } from './history/index.js';
import { ContextManager } from './context/index.js';

// 禁用 trace 上报（自定义端点不支持 SDK 的遥测导出，避免非致命报错噪音）
getGlobalTraceProvider().setDisabled(true);

// Context 管理器：32K 窗口，超限时裁剪旧历史并生成摘要注入
const contextManager = new ContextManager(openaiClient);

// 打印助手回复：非流式一次性输出。
// 注：@openai/agents 走 Responses API，该路径在 DeepSeek 端点上流式不生效（实测一次性返回），已接受此限制。
async function printResponse(history: ConversationHistory): Promise<void> {
  process.stdout.write(color.dim('正在处理（可能需要联网搜索）…\n'));
  // 裁剪 + 摘要注入，构造本轮实际发送的上下文
  const systemPrompt = typeof agent.instructions === 'string' ? agent.instructions : '';
  const { items } = await contextManager.build(history.getItems(), systemPrompt);
  const result = await run(agent, items);
  console.log(color.assistant('助手 > ') + (result.finalOutput ?? ''));
  // 增量同步：保留被裁剪掉的旧历史，仅追加本轮新增条目
  history.syncFromState(result.state, items);
}

// 打印历史统计（/history 调试命令）
function printHistoryStats(history: ConversationHistory): void {
  const stats = history.getStats();
  console.log(color.dim(`历史条目统计（内存，共 ${stats.total} 条）：`));
  console.log(color.dim(`  用户消息 ${stats.userMessages} 条`));
  console.log(color.dim(`  助手消息 ${stats.assistantMessages} 条`));
  console.log(color.dim(`  工具调用 ${stats.toolCalls} 条`));
  console.log(color.dim(`  工具结果 ${stats.toolResults} 条`));
  console.log(color.dim(`  系统消息 ${stats.systemMessages} 条`));
  console.log(color.dim(`  其他（reasoning 等）${stats.other} 条`));
}

// 打印 Context 占用统计（/context 调试命令）
function printContextStats(): void {
  const stats = contextManager.getStats();
  if (!stats) {
    console.log(color.dim('尚未进行过对话，无统计数据。'));
    return;
  }
  console.log(color.dim(`Context 统计（输入预算 ${stats.inputBudget} token）：`));
  console.log(color.dim(`  全部历史 ${stats.totalTokens} token`));
  console.log(color.dim(`  实际发送 ${stats.sentTokens} token（含 System Prompt 与摘要）`));
  console.log(color.dim(`  发送条目 ${stats.sentItems} 条`));
  console.log(
    color.dim(`  裁剪：${stats.trimmed ? `已裁剪 ${stats.trimmedRounds} 轮` : '未裁剪'}`),
  );
  console.log(color.dim(`  摘要：${stats.hasSummary ? '生效中（/summary 查看内容）' : '无'}`));
}

// 主循环：readline REPL，多轮对话
async function main() {
  // terminal 模式仅当 stdin 是 TTY 时启用，管道/重定向输入也能正常工作
  const rl = createInterface({ input, output, terminal: input.isTTY });

  // 会话历史：纯内存保存全部对话条目（含工具调用与结果等）
  const history = new ConversationHistory();

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
      if (text === '/history') {
        printHistoryStats(history);
        continue;
      }
      if (text === '/context') {
        printContextStats();
        continue;
      }
      if (text === '/summary') {
        const summary = contextManager.getSummary();
        console.log(color.dim(summary ? `当前摘要：\n${summary}` : '当前无摘要。'));
        continue;
      }
      if (text === '/clear') {
        history.clear();
        contextManager.reset();
        console.log(color.dim('会话已清空，开始新对话。'));
        continue;
      }
      if (text === '/exit' || text === '/quit') {
        break;
      }

      // 将本轮用户消息追加到历史，构造完整上下文
      history.addUserMessage(text);

      try {
        await printResponse(history);
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

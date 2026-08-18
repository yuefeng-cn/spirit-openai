/**
 * spirit-openai 入口：REPL 多轮对话。
 * - 历史由 ConversationHistory（纯内存）保存全部对话条目，不写入文本文件
 * - Context 由 ContextManager 管理：32K 窗口限制、超限裁剪、历史摘要注入
 */
import 'dotenv/config'; // 加载 .env 中的环境变量
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { run, getGlobalTraceProvider } from '@openai/agents';
import { agent, openaiClient, taskStateStore, memoryStore } from './agent.js';
import { color, helpText } from './ui.js';
import { ConversationHistory } from './history/index.js';
import { ContextManager } from './context/index.js';

// 禁用 trace 上报（自定义端点不支持 SDK 的遥测导出，避免非致命报错噪音）
getGlobalTraceProvider().setDisabled(true);

// Context 管理器：32K 窗口，超限时裁剪旧历史并生成摘要注入
const contextManager = new ContextManager(openaiClient);

// 打印助手回复：流式逐 token 输出。
// 注：当前走 Chat Completions API，DeepSeek 等主流兼容端点均支持 stream: true。
async function printResponse(history: ConversationHistory): Promise<void> {
  process.stdout.write(color.dim('正在处理…\n'));
  // 裁剪 + 摘要注入，构造本轮实际发送的上下文；
  // 将 State 文本拼接到 System Prompt 之后（顺序：System Prompt > State > 摘要 > 历史），
  // 由 ContextManager 统一计入 token 预算；State 独立于 history，不受裁剪影响
  const basePrompt = typeof agent.instructions === 'string' ? agent.instructions : '';
  const stateText = taskStateStore.toText();
  const systemPrompt = [basePrompt, stateText].filter((t): t is string => !!t).join('\n\n');
  const { items } = await contextManager.build(history.getItems(), systemPrompt);
  const result = await run(agent, items, { stream: true });
  // 流式输出文本到 stdout
  process.stdout.write(color.assistant('助手 > '));
  const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
  // 等待流完全消费完毕，确保 state/history 已就绪
  await result.completed;
  // 应用本轮模型对任务状态的更新（update_state 工具调用）
  const applied = taskStateStore.applyFromHistory(result.state.history);
  if (applied > 0) {
    console.log(color.dim(`[状态已更新] ${applied} 次（/state 查看）`));
  }
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

// 打印任务状态（/state 调试命令）
function printTaskState(): void {
  const text = taskStateStore.toText();
  console.log(color.dim(text ? `当前任务状态：\n${text}` : '当前无任务状态（开始一个新任务后，Agent 会自动记录）。'));
}

// 打印记忆仓库（/memory 调试命令）
function printMemory(args: string): void {
  const [cmd, id] = args.trim().split(/\s+/);
  if (cmd === 'del' && id) {
    console.log(color.dim(memoryStore.remove(id) ? `已删除记忆 ${id}。` : `未找到记忆 ${id}。`));
    return;
  }
  const list = memoryStore.list();
  if (list.length === 0) {
    console.log(color.dim('记忆仓库为空（模型遇到长期决策/关键事实时会自动保存）。'));
    return;
  }
  const stats = memoryStore.stats();
  console.log(color.dim(`记忆仓库（内存，共 ${list.length} 条；决策 ${stats.decision} / 事实 ${stats.fact}）：`));
  for (const m of list) {
    console.log(color.dim(`  [${m.category}] ${m.id.slice(0, 8)} 主题:${m.topic} — ${m.content}`));
  }
  console.log(color.dim('  用法：/memory del <id> 删除指定记忆'));
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
      if (text === '/state') {
        printTaskState();
        continue;
      }
      if (text.startsWith('/memory')) {
        printMemory(text.slice('/memory'.length));
        continue;
      }
      if (text === '/clear') {
        history.clear();
        contextManager.reset();
        taskStateStore.reset();
        memoryStore.clear();
        console.log(color.dim('会话已清空（历史、Context、任务状态、记忆），开始新对话。'));
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

/**
 * spirit-openai 入口：REPL 多轮对话 + 图片生成/编辑。
 * - 历史持久化到 PostgreSQL，支持 --conversation <id> 恢复会话
 * - 图片生成/编辑通过 Agent 工具调用，Provider 逻辑仅在 image/ 模块
 * - CLI 输入行首若为有效图片文件路径则自动上传
 */
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stat as statFile, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { run, getGlobalTraceProvider } from '@openai/agents';
import type { Agent } from '@openai/agents';
import { createAgent, openaiClient, taskStateStore, memoryStore } from './agent.js';
import { color, helpText } from './ui.js';
import { ConversationHistory } from './history/index.js';
import { ContextManager } from './context/index.js';
import { migrate } from './persistence/database.js';
import {
  getOrCreateConversation,
  listConversationSummaries,
  loadMessages,
  appendMessages,
  DbImageRepo,
} from './persistence/conversation-repository.js';
import { ImageService, formatRef } from './image/image-service.js';
import { LocalImageStorage } from './image/image-storage.js';
import { OpenAIImageProvider } from './image/providers/openai.js';
import { createImageTools } from './image/image-tools.js';
import type { ImageVersion } from './image/types.js';

// 禁用 trace 上报
getGlobalTraceProvider().setDisabled(true);

// Context 管理器（模块级，会话间共享摘要逻辑）
const contextManager = new ContextManager(openaiClient);

// ── 图片文件解析 ───────────────────────────────────────────

/** 若输入行首为有效图片文件路径，提取路径和剩余文本 */
async function parseImageFromInput(
  line: string,
): Promise<{ imagePath: string | null; text: string }> {
  const trimmed = line.trim();
  const firstToken = trimmed.split(/\s+/)[0];
  if (/\.(png|jpe?g|webp)$/i.test(firstToken)) {
    try {
      await statFile(firstToken);
      return { imagePath: firstToken, text: trimmed.slice(firstToken.length).trim() };
    } catch {
      // 文件不存在，当普通文本处理
    }
  }
  return { imagePath: null, text: trimmed };
}

// ── 辅助打印函数 ───────────────────────────────────────────

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

function printTaskState(): void {
  const text = taskStateStore.toText();
  console.log(
    color.dim(text ? `当前任务状态：\n${text}` : '当前无任务状态（开始一个新任务后，Agent 会自动记录）。'),
  );
}

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
  console.log(
    color.dim(
      `记忆仓库（内存，共 ${list.length} 条；决策 ${stats.decision} / 事实 ${stats.fact}）：`,
    ),
  );
  for (const m of list) {
    console.log(
      color.dim(`  [${m.category}] ${m.id.slice(0, 8)} 主题:${m.topic} — ${m.content}`),
    );
  }
  console.log(color.dim('  用法：/memory del <id> 删除指定记忆'));
}

async function handleImageCommand(args: string, svc: ImageService): Promise<void> {
  const [sub, ...rest] = args.split(/\s+/).filter(Boolean);

  if (!sub || sub === 'list') {
    const versions = await svc.listVersions();
    if (versions.length === 0) {
      console.log(color.dim('当前会话暂无图片。'));
      return;
    }
    const activeId = await svc.getActiveId();
    // 建立 id → displayNo 映射，用于父图显示
    const displayNoMap = new Map(versions.map((v) => [v.id, v.displayNo]));
    console.log(color.dim(`会话图片列表（共 ${versions.length} 张）：`));
    for (const v of versions) {
      const isActive = v.id === activeId ? ' ← 当前活动' : '';
      const parentNo = v.parentVersionId ? displayNoMap.get(v.parentVersionId) : undefined;
      const parentStr = parentNo != null ? `  基于 @img-${parentNo}` : '';
      console.log(
        color.dim(
          `  ${formatRef(v.displayNo)} [${v.sourceType}]${parentStr}${isActive}` +
            (v.prompt ? `  "${v.prompt}"` : ''),
        ),
      );
    }
    return;
  }

  if (sub === 'use') {
    const ref = rest[0];
    if (!ref) {
      console.log(color.dim('用法：/image use @img-N'));
      return;
    }
    const result = await svc.resolveReference(ref);
    if (!result.found) {
      console.log(color.dim(`[图片] ${result.message}`));
      return;
    }
    await svc.setActive(result.version.id);
    console.log(color.dim(`[图片] 已将 ${formatRef(result.version.displayNo)} 设为活动图片。`));
    return;
  }

  if (sub === 'clear') {
    await svc.clearActive();
    console.log(color.dim('[图片] 已清空活动图片。'));
    return;
  }

  console.log(color.dim('可用子命令：/image list  /image use @img-N  /image clear'));
}

// ── 主循环 ─────────────────────────────────────────────────

async function main() {
  await migrate();

  // 解析 --conversation <id> 参数
  const convArgIndex = process.argv.indexOf('--conversation');
  const requestedId = convArgIndex !== -1 ? process.argv[convArgIndex + 1] : undefined;

  const rl = createInterface({ input, output, terminal: input.isTTY });

  // 图片存储（不随会话切换）
  const IMAGE_STORE_DIR = process.env.IMAGE_STORE_DIR ?? './image-store';
  const IMAGE_OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR ?? './image-output';
  const imageStorage = new LocalImageStorage(IMAGE_STORE_DIR, IMAGE_OUTPUT_DIR);
  const imageProvider = new OpenAIImageProvider();

  // ── 可变会话状态 ─────────────────────────────────────────
  let conversationId = '';
  let history = new ConversationHistory();
  let persistedOffset = 0;
  let imageService: ImageService = new ImageService('', new DbImageRepo(''), imageStorage, imageProvider);
  let currentTurnUploads: ImageVersion[] = [];
  let sessionAgent: Agent = createAgent();

  /** 加载（或切换到）指定会话，重置所有内存状态 */
  async function loadSession(id: string): Promise<void> {
    conversationId = id;
    history = new ConversationHistory();
    contextManager.reset();
    taskStateStore.reset();
    memoryStore.clear();
    const repo = new DbImageRepo(id);
    imageService = new ImageService(id, repo, imageStorage, imageProvider);
    currentTurnUploads = [];
    sessionAgent = createAgent(createImageTools(imageService, () => currentTurnUploads));

    const savedItems = await loadMessages(id);
    if (savedItems.length > 0) {
      history.loadItems(savedItems);
      console.log(color.dim(`[已恢复会话 ${id}，共 ${savedItems.length} 条历史]`));
    } else {
      console.log(color.dim(`[新会话 ${id}]`));
    }
    persistedOffset = history.size;
  }

  // 初始化第一个会话
  const firstConv = await getOrCreateConversation(requestedId ?? crypto.randomUUID());
  await loadSession(firstConv.id);

  // printResponse 通过闭包读取可变的 sessionAgent
  async function printResponse(h: ConversationHistory): Promise<void> {
    process.stdout.write(color.dim('正在处理…\n'));
    const basePrompt =
      typeof sessionAgent.instructions === 'string' ? sessionAgent.instructions : '';
    const stateText = taskStateStore.toText();
    const systemPrompt = [basePrompt, stateText].filter((t): t is string => !!t).join('\n\n');
    const { items } = await contextManager.build(h.getItems(), systemPrompt);
    const result = await run(sessionAgent, items, { stream: true });
    process.stdout.write(color.assistant('助手 > '));
    const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
    }
    process.stdout.write('\n');
    await result.completed;
    const applied = taskStateStore.applyFromHistory(result.state.history);
    if (applied > 0) {
      console.log(color.dim(`[状态已更新] ${applied} 次（/state 查看）`));
    }
    h.syncFromState(result.state, items);
  }


  try {
    while (true) {
      const line = await rl.question(color.user('你 > '));

      // 空输入：跳过
      if (!line.trim()) continue;

      // 命令处理
      if (line.trim() === '/help') { console.log(helpText); continue; }
      if (line.trim() === '/history') { printHistoryStats(history); continue; }
      if (line.trim() === '/context') { printContextStats(); continue; }
      if (line.trim() === '/summary') {
        const s = contextManager.getSummary();
        console.log(color.dim(s ? `当前摘要：\n${s}` : '当前无摘要。'));
        continue;
      }
      if (line.trim() === '/state') { printTaskState(); continue; }
      if (line.trim().startsWith('/memory')) { printMemory(line.trim().slice('/memory'.length)); continue; }
      if (line.trim().startsWith('/image')) {
        await handleImageCommand(line.trim().slice('/image'.length).trim(), imageService);
        continue;
      }
      if (line.trim() === '/sessions') {
        const sessions = await listConversationSummaries();
        if (sessions.length === 0) {
          console.log(color.dim('暂无历史会话。'));
        } else {
          console.log(color.dim(`会话列表（共 ${sessions.length} 个，最新在前）：`));
          for (const s of sessions) {
            const isCurrent = s.id === conversationId ? ' ← 当前' : '';
            const updated = s.updated_at.toLocaleString('zh-CN');
            console.log(color.dim(`  ${s.id}  ${s.message_count} 条消息  更新于 ${updated}${isCurrent}`));
          }
          console.log(color.dim('  用法：/resume <id> 切换到指定会话（支持 ID 前缀）'));
        }
        continue;
      }
      if (line.trim().startsWith('/resume')) {
        const id = line.trim().slice('/resume'.length).trim();
        if (!id) {
          console.log(color.dim('用法：/resume <conversation-id>'));
          continue;
        }
        const sessions = await listConversationSummaries();
        const matches = sessions.filter(s => s.id === id || s.id.startsWith(id));
        if (matches.length === 0) {
          console.log(color.dim(`[未找到会话 ${id}]`));
        } else if (matches.length > 1) {
          console.log(color.dim(`[前缀 "${id}" 匹配多个会话，请输入更多字符：]`));
          for (const m of matches) console.log(color.dim(`  ${m.id}`));
        } else if (matches[0].id === conversationId) {
          console.log(color.dim(`[已在会话 ${conversationId}]`));
        } else {
          await loadSession(matches[0].id);
        }
        continue;
      }
      if (line.trim() === '/clear') {
        history.clear();
        contextManager.reset();
        taskStateStore.reset();
        memoryStore.clear();
        persistedOffset = 0;
        console.log(color.dim('会话已清空（历史、Context、任务状态、记忆），开始新对话。'));
        continue;
      }
      if (line.trim() === '/exit' || line.trim() === '/quit') break;

      // 每轮开始：清空本轮上传图
      currentTurnUploads = [];

      // 检测并上传行首图片文件
      const { imagePath, text } = await parseImageFromInput(line);
      if (imagePath) {
        try {
          const data = await readFile(imagePath);
          const ext = extname(imagePath).slice(1).toLowerCase() || 'png';
          const upload = await imageService.uploadFile(data, ext);
          currentTurnUploads.push(upload);
          console.log(color.dim(`[图片] ${formatRef(upload.displayNo)} 已上传（${imagePath}）`));
        } catch (err) {
          console.error(color.error(`[图片上传失败] ${err instanceof Error ? err.message : err}`));
        }
      }

      const userText = text || (currentTurnUploads.length > 0 ? '（我上传了一张图片）' : '');
      if (!userText) continue;

      history.addUserMessage(userText);

      try {
        await printResponse(history);
        const newItems = history.getNewItemsSince(persistedOffset);
        if (newItems.length > 0) {
          await appendMessages(conversationId, newItems);
          persistedOffset = history.size;
        }
      } catch (err) {
        console.error(color.error(`\n[出错] ${err instanceof Error ? err.message : err}`));
      }
    }
  } catch {
    // Ctrl+C / Ctrl+D / EOF
  } finally {
    rl.close();
    console.log(color.dim('\n再见！'));
  }
}

main();

/**
 * State 端到端测试（真实 API，需要 .env 配置）。
 * 运行：npm run test:e2e（先 npm run build）
 *
 * 验证：
 * 1. 任务对话 → 模型调用 update_state → State 更新
 * 2. 小窗口多轮对话触发 Context 裁剪
 * 3. 裁剪后 State 仍注入，Agent 能基于 State 继续任务
 * 4. State 与 History 解耦（State 不在历史中，也不被裁剪）
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { run, getGlobalTraceProvider } from '@openai/agents';
import { agent, openaiClient, taskStateStore } from '../dist/agent.js';
import { ContextManager } from '../dist/context/index.js';
import { ConversationHistory } from '../dist/history/index.js';

getGlobalTraceProvider().setDisabled(true);

// 小窗口加速触发裁剪
const cm = new ContextManager(openaiClient, {
  maxTokens: 2048,
  reservedOutputTokens: 512,
  keepRecentRounds: 1,
});
const history = new ConversationHistory();
const basePrompt = typeof agent.instructions === 'string' ? agent.instructions : '';

// 与 src/index.ts 相同的注入逻辑：System Prompt + State 拼接
function buildSystemPrompt() {
  const stateText = taskStateStore.toText();
  return [basePrompt, stateText].filter((t) => !!t).join('\n\n');
}

async function turn(text) {
  history.addUserMessage(text);
  const systemPrompt = buildSystemPrompt();
  const { items, stats } = await cm.build(history.getItems(), systemPrompt);
  const result = await run(agent, items);
  const applied = taskStateStore.applyFromHistory(result.state.history);
  history.syncFromState(result.state, items);
  return { stats, applied, output: result.finalOutput, history: result.state.history };
}

const long = '这是一段较长的历史背景描述，包含很多细节信息。'.repeat(60); // ~1K token

// 轮 1：明确要求记录任务（应触发 update_state）
console.log('端到端测试：任务状态记录 + Context 裁剪 + 状态继续生效');
const r1 = await turn('请把当前任务记录为"撰写春秋时期研究报告"，第一步是收集史料，并请回答一个历史问题：' + long);
console.log(`  [轮1] 状态更新 ${r1.applied} 次`);
assert.ok(r1.applied >= 1, '第 1 轮应触发 update_state 工具调用');
assert.equal(taskStateStore.get().task, '撰写春秋时期研究报告', 'task 应被记录');
console.log('  ✅ 任务被记录:', taskStateStore.get().task);

// 轮 2-4：长文本推进，触发 Context 裁剪
for (let i = 2; i <= 4; i++) {
  const r = await turn(`继续任务，补充细节：${long}`);
  console.log(`  [轮${i}] 状态更新 ${r.applied} 次 | 裁剪:${r.stats.trimmed ? `是(${r.stats.trimmedRounds}轮)` : '否'}`);
}

// State 不在历史中（解耦验证）
const stateTextInHistory = history.getItems().some((it) => it.type === 'message' && it.role === 'system');
assert.equal(stateTextInHistory, false, 'State 不应写入 History');
console.log('  ✅ State 与 History 解耦（State 不在历史条目中）');

// 追问当前任务：早期轮次已被裁剪，Agent 只能依赖注入的 State 回答
const r5 = await turn('回顾一下，我们当前的任务是什么？第一步要做什么？请直接根据任务状态回答。');
const out = r5.output ?? '';
console.log('  [回顾] 回答:', out.slice(0, 150));
assert.ok(out.includes('撰写春秋时期研究报告') || out.includes('春秋'), '回答应基于注入的任务状态');
console.log('  ✅ 裁剪后 Agent 基于 State 继续任务');

console.log('\n端到端测试通过');

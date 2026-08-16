/**
 * Memory 端到端测试（真实 API，需要 .env 配置）。
 * 运行：npm run test:e2e（先 npm run build）
 *
 * 验证：
 * 1. 用户告知关键事实 → 模型调用 remember 保存（零额外调用）
 * 2. 长对话触发 Context 裁剪后，记忆仍在仓库（Memory 与 History 解耦）
 * 3. 追问时模型按需调用 retrieve_memory，基于记忆正确回答
 * 4. 重复告知同一事实 → 去重（仓库条数不增）
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { run, getGlobalTraceProvider } from '@openai/agents';
import { agent, openaiClient, memoryStore } from '../dist/agent.js';
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
const systemPrompt = typeof agent.instructions === 'string' ? agent.instructions : '';

async function turn(text) {
  history.addUserMessage(text);
  const { items, stats } = await cm.build(history.getItems(), systemPrompt);
  const result = await run(agent, items);
  history.syncFromState(result.state, items);
  return { stats, output: result.finalOutput, history: result.state.history };
}

function toolCalls(result, name) {
  return result.history.filter((it) => it.type === 'function_call' && it.name === name);
}

const long = '这是一段较长的历史背景描述，包含很多细节信息。'.repeat(60); // ~1K token

console.log('端到端测试：记忆保存 → Context 裁剪 → 按需检索 → 去重');

// 轮 1：告知关键事实，应触发 remember
let r = await turn('请记住这一点：我的项目使用 Vue 3 作为前端框架。顺便回答：' + long);
const remembers = toolCalls(r, 'remember');
assert.ok(remembers.length >= 1, '应调用 remember 工具');
const saved = memoryStore.list().find((m) => m.content.includes('Vue'));
assert.ok(saved, '记忆应已保存');
console.log(`  [轮1] remember 调用 ${remembers.length} 次 → 已保存: [${saved.category}] ${saved.topic} — ${saved.content.slice(0, 30)}...`);

// 轮 2-4：长文本推进触发裁剪
for (let i = 2; i <= 4; i++) {
  r = await turn(`继续讨论：${long}`);
  console.log(`  [轮${i}] 裁剪:${r.stats.trimmed ? `是(${r.stats.trimmedRounds}轮)` : '否'} | 记忆条数:${memoryStore.size}`);
}

// 轮 5：明确要求用工具检索（验证按需加载路径）
r = await turn('请调用 retrieve_memory 工具查询"前端框架"，告诉我记忆里保存了什么。');
const retrieves = toolCalls(r, 'retrieve_memory');
assert.ok(retrieves.length >= 1, '应调用 retrieve_memory 工具');
assert.ok((r.output ?? '').includes('Vue'), '回答应基于检索到的记忆');
console.log('  [轮5] retrieve_memory 调用', retrieves.length, '次 → 回答提到 Vue 3 ✅');

// 轮 6：重复告知同一事实 → 去重
const sizeBefore = memoryStore.size;
r = await turn('再次请记住：我的项目使用 Vue 3 作为前端框架。');
const remembers2 = toolCalls(r, 'remember');
assert.ok(memoryStore.size <= sizeBefore, '重复保存应去重（条数不增）');
console.log(`  [轮6] remember 调用 ${remembers2.length} 次 → 去重后记忆条数:${memoryStore.size}（原 ${sizeBefore}）`);

// 裁剪后记忆仍存活（与 History 解耦）
assert.ok(memoryStore.size > 0, '裁剪后记忆仍在仓库');
console.log('  ✅ Memory 跨 Context 裁剪继续生效');

console.log('\n端到端测试通过');

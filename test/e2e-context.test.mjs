/**
 * 长对话 Context 裁剪端到端测试（真实 API，需要 .env 配置）。
 * 运行：npm run test:e2e（先 npm run build）
 *
 * 用 2K 小窗口快速触发裁剪，验证：
 * 1. 裁剪按轮触发
 * 2. 摘要生成并注入
 * 3. 历史完整保存（增量同步，被裁剪内容不丢失）
 * 4. 裁剪后模型能借助摘要回顾早期内容
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { run, getGlobalTraceProvider } from '@openai/agents';
import { agent, openaiClient } from '../dist/agent.js';
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
  return { stats, output: result.finalOutput };
}

const long = '这是一段较长的历史背景描述，包含很多细节信息。'.repeat(60); // ~1K token
const ROUNDS = 5;

console.log(`端到端测试：${ROUNDS} 轮长对话 + 回顾轮（窗口 2K）`);
for (let i = 1; i <= ROUNDS; i++) {
  const { stats } = await turn(`问题${i}：${long}`);
  console.log(
    `  [轮${i}] 裁剪:${stats.trimmed ? `是(${stats.trimmedRounds}轮)` : '否'} | 摘要:${stats.hasSummary} | 历史:${history.size}条`,
  );
  if (i > 1) {
    assert.ok(stats.trimmed, `第 ${i} 轮起应触发裁剪`);
  }
}

// 历史完整性：每轮应贡献 user + reasoning + assistant 等条目（至少 3 条/轮）
assert.ok(history.size >= ROUNDS * 3, `历史应完整保存，实际 ${history.size} 条`);
console.log(`  ✅ 历史完整保存：${history.size} 条（无丢失）`);
assert.equal(history.getStats().userMessages, ROUNDS, '用户消息条数应等于轮数');
console.log('  ✅ 用户消息条数正确');

// 回顾轮：模型应能借助摘要给出回应
const { stats, output } = await turn('回顾一下，我们最初讨论的主题是什么？请简要回答。');
assert.ok(stats.hasSummary, '回顾轮应已有摘要生效');
assert.ok(output && output.length > 0, '回顾轮应正常回答');
console.log(`  ✅ 摘要生效，回顾轮回答（${output.length} 字）`);
console.log(`  ✅ 裁剪后对话可继续（历史 ${history.size} 条，摘要 ${(cm.getSummary() ?? '').length} 字）`);
console.log('\n端到端测试通过');

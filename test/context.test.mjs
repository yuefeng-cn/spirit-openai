/**
 * History + Context 单元测试（mock，无需真实 API）。
 * 运行：npm test（先 npm run build）
 */
import assert from 'node:assert/strict';
import { ConversationHistory } from '../dist/history/index.js';
import {
  ContextManager,
  estimateTokens,
  estimateItemTokens,
  estimateItemsTokens,
} from '../dist/context/index.js';

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

// ---------- Tokenizer ----------
console.log('■ Tokenizer');
assert.equal(estimateTokens(''), 0, '空文本应为 0 token');
assert.ok(estimateTokens('你好，世界 hello world') > 0, '正常文本应 > 0');
assert.ok(estimateItemTokens({ type: 'message', role: 'user', content: '问题' }) > 0);
assert.ok(estimateItemsTokens([]) === 0);
ok('token 估算（空/单条/多条）');

// ---------- ConversationHistory ----------
console.log('■ ConversationHistory');
const h = new ConversationHistory();
h.addUserMessage('问题A');
assert.equal(h.size, 1);

// 增量合并：前缀 = 发送 items，追加新增部分
const sent = [
  { type: 'message', role: 'system', content: '【摘要】旧内容' },
  { type: 'message', role: 'user', content: '问题B' },
];
const stateHistory = [
  ...sent,
  { type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', content: '回答' },
];
h.syncFromState({ history: stateHistory }, sent);
// 预期：问题B 是发送前缀（跳过），仅追加新增的 assistant 回答
// 最终历史 = 问题A + 回答（共 2 条），摘要(system)不写入历史
assert.equal(h.size, 2, '增量合并：问题A + 回答，摘要与发送前缀不重复写入');
assert.equal(h.getStats().systemMessages, 0, '摘要(system)不应进入历史');

// 前缀不匹配 → 回退全量替换
h.syncFromState({ history: [{ type: 'message', role: 'user', content: 'X' }] }, [
  { type: 'message', role: 'user', content: '不同内容' },
]);
assert.equal(h.size, 1, '前缀不匹配应回退全量替换');

// 分类统计（含 other）
h.clear();
h.syncFromState({
  history: [
    { type: 'message', role: 'user', content: 'u' },
    { type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', content: 'a' },
    { type: 'hosted_tool_call', name: 'web_search', arguments: '{}', callId: 'c1' },
    { type: 'function_call_result', callId: 'c1', name: 'web_search', output: 'o' },
    { type: 'reasoning', content: [] },
  ],
});
const stats = h.getStats();
assert.deepEqual(stats, {
  total: 5,
  userMessages: 1,
  assistantMessages: 1,
  systemMessages: 0,
  toolCalls: 1,
  toolResults: 1,
  other: 1,
});
ok('增量合并 / 前缀回退 / 分类统计（含 other）');

// ---------- ContextManager（mock client）----------
console.log('■ ContextManager（mock 摘要）');
let summarizeCalls = 0;
const fakeClient = {
  chat: {
    completions: {
      create: async () => {
        summarizeCalls++;
        return { choices: [{ message: { content: `[摘要#${summarizeCalls}]` } }] };
      },
    },
  },
};

const cm = new ContextManager(fakeClient, {
  maxTokens: 2048,
  reservedOutputTokens: 512,
  keepRecentRounds: 1,
});
assert.equal(cm.inputBudget, 1536, '输入预算 = maxTokens - reservedOutputTokens');

const user = (t) => ({ type: 'message', role: 'user', content: t });
const asst = (t) => ({ type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', content: t });
const long = '这是一段较长的历史背景描述，包含很多细节信息。'.repeat(15); // ~0.5K token/条，单轮 ~1K < 预算 1536

// 小历史：不裁剪、无摘要、原样发送
let r = await cm.build([user('小问题'), asst('小回答')], 'SYSTEM_PROMPT');
assert.equal(r.stats.trimmed, false);
assert.equal(r.stats.hasSummary, false);
assert.equal(r.items.length, 2);
ok('小历史不裁剪、原样发送');

// 大历史：触发裁剪 + 摘要注入（system 在最前）
const bigHistory = [];
for (let i = 1; i <= 6; i++) bigHistory.push(user(`问题${i}：${long}`), asst(`回答${i}：${long}`));
r = await cm.build(bigHistory, 'SYSTEM_PROMPT');
assert.equal(r.stats.trimmed, true, '应触发裁剪');
assert.ok(r.stats.trimmedRounds > 0);
assert.ok(r.stats.sentTokens <= r.stats.inputBudget + 200, '整轮裁剪后发送 token 应接近预算');
assert.equal(r.stats.hasSummary, true);
assert.equal(r.items[0].type, 'message');
assert.equal(r.items[0].role, 'system', '摘要应注入为最前的 system 消息');
assert.equal(r.items[0].content, '[摘要#1]');
ok('超限裁剪 + 摘要注入位置正确');

// 再次超限：摘要合并（summarize 再次被调用）
await cm.build(bigHistory, 'SYSTEM_PROMPT');
assert.equal(summarizeCalls, 2, '再次裁剪应触发摘要合并');
ok('多次裁剪触发摘要合并');

// reset 清空摘要
cm.reset();
assert.equal(cm.getSummary(), null);
r = await cm.build(bigHistory, 'SYSTEM_PROMPT');
assert.equal(r.items[0].role, 'system', 'reset 后重新生成摘要');
ok('reset 清空摘要后重新生成');

// 单轮超限：不裁剪但发送（容忍），摘要仍持续注入
const huge = { type: 'message', role: 'user', content: long.repeat(20) }; // ~10K token
r = await cm.build([huge], 'SYSTEM_PROMPT');
assert.equal(r.stats.trimmed, false);
assert.equal(r.items.length, 2, '摘要 + 超限单轮（单轮超限容忍发送）');
assert.equal(r.items[0].role, 'system', '摘要跨轮持续注入');
ok('单轮超限容忍（不抛错）');

console.log(`\n全部通过：${passed} 项`);

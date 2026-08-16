/**
 * State 模块单元测试（mock，无需真实 API）。
 * 运行：npm test（先 npm run build）
 */
import assert from 'node:assert/strict';
import { TaskStateStore, createUpdateStateTool, emptyTaskState, isEmptyState } from '../dist/state/index.js';

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

console.log('■ TaskStateStore');
const store = new TaskStateStore();

// 初始为空
assert.ok(isEmptyState(store.get()));
assert.equal(store.toText(), null, '空状态无需注入');
ok('初始为空、不注入');

// apply：部分字段更新（undefined 字段保持不变）
store.apply({ task: '写一篇关于明朝的报告', pending: ['收集资料', '撰写正文'] });
assert.equal(store.get().task, '写一篇关于明朝的报告');
assert.equal(store.get().step, null, '未传字段保持不变');
assert.equal(store.get().pending.length, 2);
ok('apply 部分字段更新');

// apply：数组整体替换
store.apply({ completed: ['收集资料'], pending: ['撰写正文'] });
assert.equal(store.get().completed[0], '收集资料');
assert.equal(store.get().pending.length, 1, '数组整体替换');
ok('apply 数组整体替换');

// apply：空数组清空
store.apply({ decisions: [] });
assert.deepEqual(store.get().decisions, []);
ok('apply 空数组清空');

// toText 格式
const text = store.toText();
assert.ok(text.includes('任务：写一篇关于明朝的报告'));
assert.ok(text.includes('已完成：') && text.includes('- 收集资料'));
assert.ok(text.includes('待完成：') && text.includes('- 撰写正文'));
ok('toText 序列化格式');

// applyFromHistory：从 history 提取 update_state 调用
store.reset();
const applied = store.applyFromHistory([
  { type: 'message', role: 'user', content: '请写报告' },
  {
    type: 'function_call',
    id: 'x',
    callId: 'call_1',
    name: 'update_state',
    status: 'completed',
    arguments: JSON.stringify({ task: '报告任务', step: '起草', completed: [], pending: ['写'], decisions: [] }),
  },
  { type: 'function_call_result', callId: 'call_1', name: 'update_state', output: 'ok' },
]);
assert.equal(applied, 1);
assert.equal(store.get().task, '报告任务');
assert.equal(store.get().step, '起草');
ok('applyFromHistory 提取并应用工具调用');

// 非法 arguments：跳过不报错
store.reset();
const applied2 = store.applyFromHistory([
  { type: 'function_call', id: 'x', callId: 'c', name: 'update_state', status: 'completed', arguments: 'not-json{' },
]);
assert.equal(applied2, 0);
assert.ok(isEmptyState(store.get()));
ok('非法 arguments 安全跳过');

// 其他工具调用：不应用
store.reset();
const applied3 = store.applyFromHistory([
  { type: 'function_call', id: 'x', callId: 'c', name: 'web_search', status: 'completed', arguments: '{}' },
]);
assert.equal(applied3, 0);
ok('非 update_state 调用忽略');

// reset
store.apply({ task: 't' });
store.reset();
assert.ok(isEmptyState(store.get()));
ok('reset 清空');

console.log('■ update_state 工具');
// 工具定义与 execute：参数解析 + 写入 store（tool() 返回对象通过 invoke(runContext, jsonString) 调用）
const toolObj = createUpdateStateTool(store);
assert.equal(toolObj.name, 'update_state');
assert.equal(toolObj.type, 'function');
const args = { task: '新任务', step: '', completed: [], pending: ['步骤1'], decisions: ['决策A'] };
const result = await toolObj.invoke(undefined, JSON.stringify(args));
assert.equal(result, '任务状态已更新。');
assert.equal(store.get().task, '新任务');
assert.equal(store.get().pending[0], '步骤1');
ok('工具 invoke 写入 store');

console.log(`\n全部通过：${passed} 项`);

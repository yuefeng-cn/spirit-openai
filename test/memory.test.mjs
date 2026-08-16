/**
 * Memory 模块单元测试（mock，无需真实 API）。
 * 运行：npm test（先 npm run build）
 */
import assert from 'node:assert/strict';
import { MemoryStore, similarity, createMemoryTools } from '../dist/memory/index.js';

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

console.log('■ similarity（bigram Jaccard）');
assert.ok(similarity('前端框架 Vue3', '前端框架 Vue3') > 0.9, '相同文本相似度高');
assert.ok(similarity('完全不同的内容甲', '完全不相关的内容乙') < 0.4, '不同文本相似度低');
assert.equal(similarity('', 'x'), 0);
ok('相似度计算');

console.log('■ MemoryStore');
const store = new MemoryStore();

// 新增
let r = store.add({ category: 'fact', topic: '前端框架', content: '项目使用 Vue 3 作为前端框架' });
assert.equal(r.added, true);
assert.ok(r.memory.id.length > 0);
assert.equal(store.size, 1);
ok('新增记忆');

// 同主题合并（去重）
r = store.add({ category: 'fact', topic: '前端框架', content: '项目前端框架是 Vue 3（已升级）' });
assert.equal(r.added, false, '同主题应合并');
assert.equal(store.size, 1, '仓库条数不增');
assert.ok(store.get(r.memory.id)?.content.includes('已升级'), '合并更新内容');
ok('同主题合并去重');

// 内容高度相似合并
r = store.add({ category: 'fact', topic: '框架', content: '项目使用 Vue 3 作为前端框架' });
assert.equal(r.added, false, '内容相似应合并');
assert.equal(store.size, 1);
ok('内容相似合并');

// 不同主题新增
store.add({ category: 'decision', topic: '回答风格', content: '用户偏好简洁直接的回答' });
store.add({ category: 'fact', topic: '后端', content: '项目后端使用 Node.js' });
assert.equal(store.size, 3);
ok('不同主题新增');

// 检索：主题索引命中
let hits = store.search('前端框架');
assert.equal(hits.length, 1);
assert.equal(hits[0].topic, '前端框架');
// 检索：内容匹配
hits = store.search('Vue');
assert.ok(hits.length >= 1, '内容相似度命中');
// 检索：无关查询为空
hits = store.search('天气怎么样');
assert.equal(hits.length, 0);
// 检索：limit
hits = store.search('项目', 2);
assert.ok(hits.length <= 2);
ok('检索（主题索引 + 内容相似度 + limit）');

// remove / get
const id = store.list()[0].id;
assert.equal(store.remove(id), true);
assert.equal(store.remove('不存在'), false);
assert.equal(store.size, 2);
ok('删除');

// stats
const s = store.stats();
assert.equal(s.fact + s.decision, 2);
ok('类别统计');

// clear
store.clear();
assert.equal(store.size, 0);
ok('清空');

console.log('■ Memory 工具');
const store2 = new MemoryStore();
const [rememberTool, retrieveTool] = createMemoryTools(store2);
assert.equal(rememberTool.name, 'remember');
assert.equal(retrieveTool.name, 'retrieve_memory');

// remember 写入
let out = await rememberTool.invoke(undefined, JSON.stringify({ category: 'fact', topic: '技术栈', content: '使用 TypeScript' }));
assert.equal(out, '已保存到记忆仓库。');
assert.equal(store2.size, 1);
// 重复 remember → 合并
out = await rememberTool.invoke(undefined, JSON.stringify({ category: 'fact', topic: '技术栈', content: '使用 TypeScript 与 Node.js' }));
assert.equal(out, '该记忆已存在，已合并更新。');
assert.equal(store2.size, 1, '重复保存去重');
ok('remember 工具写入 + 去重');

// retrieve_memory 查询
out = await retrieveTool.invoke(undefined, JSON.stringify({ query: '技术栈' }));
assert.ok(out.includes('TypeScript'), '检索返回记忆内容');
out = await retrieveTool.invoke(undefined, JSON.stringify({ query: '无关内容' }));
assert.equal(out, '没有找到相关记忆。');
ok('retrieve_memory 工具检索');

console.log(`\n全部通过：${passed} 项`);

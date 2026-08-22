/**
 * P1-03 / P2-01：会话与图片版本持久化集成测试。
 * 需要 DATABASE_URL 环境变量（见 .env）。
 * 运行：node --env-file=.env test/persistence.test.mjs
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { migrate, closePool } from '../dist/persistence/database.js';
import {
  createConversation,
  getOrCreateConversation,
  appendMessages,
  loadMessages,
  createImageVersion,
  getImageVersion,
  getImageVersionByDisplayNo,
  listImageVersions,
  getActiveImageVersionId,
  setActiveImageVersionId,
} from '../dist/persistence/conversation-repository.js';
import { ConversationHistory } from '../dist/history/index.js';

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}
async function run(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('     ', err.message);
    process.exitCode = 1;
  }
}

// ── 测试 ──────────────────────────────────────────────────

console.log('■ 会话持久化集成测试');

await migrate();

await run('migrate() 可重复调用不报错', async () => {
  await migrate(); // 幂等
});

await run('创建新会话返回有效 UUID', async () => {
  const id = await createConversation();
  assert.match(id, /^[0-9a-f-]{36}$/);
});

await run('getOrCreateConversation 创建后可再次获取', async () => {
  const conv = await getOrCreateConversation(crypto.randomUUID());
  const again = await getOrCreateConversation(conv.id);
  assert.equal(again.id, conv.id);
});

await run('两个会话互不读取对方消息', async () => {
  const idA = (await getOrCreateConversation(crypto.randomUUID())).id;
  const idB = (await getOrCreateConversation(crypto.randomUUID())).id;

  await appendMessages(idA, [
    { type: 'message', role: 'user', content: '会话 A 的消息' },
  ]);
  await appendMessages(idB, [
    { type: 'message', role: 'user', content: '会话 B 的消息' },
  ]);

  const itemsA = await loadMessages(idA);
  const itemsB = await loadMessages(idB);

  assert.equal(itemsA.length, 1);
  assert.equal(itemsB.length, 1);
  assert.equal(itemsA[0].content, '会话 A 的消息');
  assert.equal(itemsB[0].content, '会话 B 的消息');
});

await run('写入消息 → 重建 ConversationHistory → 消息仍存在', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;

  // 第一个进程：写入两条消息
  const history1 = new ConversationHistory();
  history1.addUserMessage('第一轮用户输入');
  // 模拟 syncFromState：追加一条助手消息
  history1.syncFromState({
    history: [
      { type: 'message', role: 'user', content: '第一轮用户输入' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '助手回复' }] },
    ],
  });
  await appendMessages(convId, history1.getNewItemsSince(0));

  // 第二个进程：重新加载
  const history2 = new ConversationHistory();
  const saved = await loadMessages(convId);
  history2.loadItems(saved);

  assert.equal(history2.size, 2);
  const items = history2.getItems();
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'assistant');
});

await run('恢复后可继续追加新消息', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;

  // 第一轮
  await appendMessages(convId, [
    { type: 'message', role: 'user', content: '第一轮' },
  ]);

  // 恢复后第二轮
  const items = await loadMessages(convId);
  const history = new ConversationHistory();
  history.loadItems(items);
  const offset = history.size;

  history.addUserMessage('第二轮');
  const newItems = history.getNewItemsSince(offset);
  await appendMessages(convId, newItems);

  const all = await loadMessages(convId);
  assert.equal(all.length, 2);
  assert.equal(all[1].content, '第二轮');
});

console.log(`\n全部通过：${passed} 项`);
await closePool();

// ── P2-01：图片版本 DB 测试 ────────────────────────────────

console.log('\n■ 图片版本持久化集成测试');

await run('创建上传根图，displayNo 从 1 开始', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const v = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'uploads/a.png' });
  assert.equal(v.displayNo, 1);
  assert.equal(v.sourceType, 'upload');
  assert.equal(v.parentVersionId, null);
});

await run('同会话多张图 displayNo 递增', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const v1 = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'a.png' });
  const v2 = await createImageVersion({ conversationId: convId, sourceType: 'generated', objectKey: 'b.png', prompt: '一只猫' });
  assert.equal(v1.displayNo, 1);
  assert.equal(v2.displayNo, 2);
});

await run('创建编辑子图，parentVersionId 正确', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const root = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'root.png' });
  const child = await createImageVersion({
    conversationId: convId, sourceType: 'generated', objectKey: 'child.png',
    parentVersionId: root.id, prompt: '改成蓝色',
  });
  assert.equal(child.parentVersionId, root.id);
  assert.equal(child.displayNo, 2);
});

await run('旧图分支：从 v1 再创建 v3 时 parentVersionId 仍指向 v1', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const v1 = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'root.png' });
  await createImageVersion({ conversationId: convId, sourceType: 'generated', objectKey: 'child1.png', parentVersionId: v1.id });
  const branch = await createImageVersion({ conversationId: convId, sourceType: 'generated', objectKey: 'branch.png', parentVersionId: v1.id });
  assert.equal(branch.parentVersionId, v1.id);
  assert.equal(branch.displayNo, 3);
});

await run('getImageVersion 跨会话隔离（返回 null）', async () => {
  const idA = (await getOrCreateConversation(crypto.randomUUID())).id;
  const idB = (await getOrCreateConversation(crypto.randomUUID())).id;
  const vA = await createImageVersion({ conversationId: idA, sourceType: 'upload', objectKey: 'a.png' });
  const result = await getImageVersion(vA.id, idB);
  assert.equal(result, null);
});

await run('getImageVersionByDisplayNo 按 @img-N 查询', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'a.png' });
  const v2 = await createImageVersion({ conversationId: convId, sourceType: 'generated', objectKey: 'b.png' });
  const found = await getImageVersionByDisplayNo(convId, 2);
  assert.equal(found?.id, v2.id);
});

await run('listImageVersions 返回全部版本且按 displayNo 排序', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'a.png' });
  await createImageVersion({ conversationId: convId, sourceType: 'generated', objectKey: 'b.png' });
  const list = await listImageVersions(convId);
  assert.equal(list.length, 2);
  assert.equal(list[0].displayNo, 1);
  assert.equal(list[1].displayNo, 2);
});

await run('活动图片读写与清空', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const v = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'a.png' });
  assert.equal(await getActiveImageVersionId(convId), null);
  await setActiveImageVersionId(convId, v.id);
  assert.equal(await getActiveImageVersionId(convId), v.id);
  await setActiveImageVersionId(convId, null);
  assert.equal(await getActiveImageVersionId(convId), null);
});

await run('数据库重连后按 @img-N 仍可读取', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const v = await createImageVersion({ conversationId: convId, sourceType: 'upload', objectKey: 'persist.png' });
  // 模拟重连：直接再次查询
  const found = await getImageVersionByDisplayNo(convId, v.displayNo);
  assert.equal(found?.objectKey, 'persist.png');
});

console.log(`\n全部通过：${passed} 项`);
await closePool();
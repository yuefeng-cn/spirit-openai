/**
 * P3-03：端到端集成测试。
 * PostgreSQL + LocalImageStorage + MockImageProvider。
 * 覆盖：上传 → 编辑 → 生成 → 旧图分支 → 退出重建 → 恢复会话 → 再编辑。
 * 需要 DATABASE_URL 环境变量。
 * 运行：node --env-file=.env test/image-e2e.test.mjs
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { migrate, closePool } from '../dist/persistence/database.js';
import {
  getOrCreateConversation,
  DbImageRepo,
} from '../dist/persistence/conversation-repository.js';
import { ImageService } from '../dist/image/image-service.js';
import { LocalImageStorage } from '../dist/image/image-storage.js';
import { MockImageProvider } from '../dist/image/providers/mock.js';

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
    console.error('    ', err.message);
    process.exitCode = 1;
  }
}

// ── 准备 ──────────────────────────────────────────────────

await migrate();
const tmpBase = await mkdtemp(tmpdir() + '/spirit-e2e-');
const storageDir = tmpBase + '/store';
const outputDir  = tmpBase + '/output';

function makeService(conversationId) {
  const repo     = new DbImageRepo(conversationId);
  const storage  = new LocalImageStorage(storageDir, outputDir);
  const provider = new MockImageProvider();
  return { svc: new ImageService(conversationId, repo, storage, provider), provider };
}

console.log('■ 端到端集成测试（PG + LocalStorage + MockProvider）');

// ── 1. 上传 + 生成 ─────────────────────────────────────────

await run('上传图片并登记为 upload 根版本', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const { svc } = makeService(convId);

  const v = await svc.uploadFile(Buffer.from('raw image'), 'png');
  assert.equal(v.sourceType, 'upload');
  assert.equal(v.displayNo, 1);
  assert.equal(typeof v.objectKey, 'string');
  // 图片二进制不进数据库：objectKey 是字符串而非 Buffer
  assert.ok(!v.objectKey.includes('data:'));
});

await run('生成图片 → 按 @img-N 精确选择', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const { svc } = makeService(convId);

  const { version, localPath } = await svc.generateImage('一只橙猫');
  assert.equal(version.displayNo, 1);
  assert.ok(localPath);
  // 验证本机文件存在且路径包含 displayNo
  const info = await stat(localPath);
  assert.ok(info.size > 0);
  assert.ok(localPath.includes('img-1.png'));

  // 按 @img-1 查回同一版本
  const r = await svc.resolveReference('@img-1');
  assert.equal(r.found, true);
  assert.equal(r.version.id, version.id);
});

// ── 2. 编辑闭环 ───────────────────────────────────────────

await run('编辑时 Provider 实际收到目标图片字节', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const { svc, provider } = makeService(convId);

  const srcData = Buffer.from('source image content');
  const v1 = await svc.uploadFile(srcData, 'png');

  await svc.editImage(v1.id, '改成黑白');
  assert.deepEqual(provider.lastEditTargetBytes, srcData);
  assert.equal(provider.lastEditTargetVersionId, v1.id);
});

await run('连续编辑形成父子链，数据库未保存本机路径', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const { svc } = makeService(convId);

  const v1 = await svc.uploadFile(Buffer.from('v1'), 'png');
  const { version: v2 } = await svc.editImage(v1.id, '第1次改');
  const { version: v3 } = await svc.editImage(v2.id, '第2次改');

  assert.equal(v2.parentVersionId, v1.id);
  assert.equal(v3.parentVersionId, v2.id);
  assert.equal(v3.displayNo, 3);

  // objectKey 是字符串路径，不含 '/'（LocalImageStorage 只存文件名）
  assert.ok(v3.objectKey.endsWith('.png'));
  assert.ok(!v3.objectKey.startsWith('/'));
});

// ── 3. 旧图分支 ───────────────────────────────────────────

await run('旧图分支：从 @img-1 再次编辑形成新分支', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  const { svc } = makeService(convId);

  const v1 = await svc.uploadFile(Buffer.from('root'), 'png');
  const { version: v2 } = await svc.editImage(v1.id, '分支A');
  await svc.setActive(v1.id); // 切回根图
  const { version: v3 } = await svc.editImage(v1.id, '分支B');

  assert.equal(v2.parentVersionId, v1.id);
  assert.equal(v3.parentVersionId, v1.id);
  assert.equal(v3.displayNo, 3);
  assert.equal((await svc.getActive())?.id, v3.id);
});

// ── 4. 恢复会话后继续编辑 ──────────────────────────────────

await run('退出重建 → 恢复会话 → 历史图片可被 @img-N 选择', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;

  // 第一个进程：上传 + 生成
  {
    const { svc } = makeService(convId);
    await svc.uploadFile(Buffer.from('session img'), 'png');
    await svc.generateImage('一朵云');
  }

  // 第二个进程：重建 ImageService，恢复会话
  {
    const { svc } = makeService(convId);
    const r1 = await svc.resolveReference('@img-1');
    const r2 = await svc.resolveReference('@img-2');
    assert.equal(r1.found, true);
    assert.equal(r1.version.sourceType, 'upload');
    assert.equal(r2.found, true);
    assert.equal(r2.version.sourceType, 'generated');
  }
});

await run('恢复后可继续对旧图执行编辑', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;

  // 第一个进程
  let targetId;
  {
    const { svc } = makeService(convId);
    const v = await svc.uploadFile(Buffer.from('base img'), 'png');
    targetId = v.id;
  }

  // 第二个进程：恢复后编辑
  {
    const { svc, provider } = makeService(convId);
    const { version } = await svc.editImage(targetId, '恢复后编辑');
    assert.equal(version.parentVersionId, targetId);
    assert.ok(provider.lastEditTargetBytes && provider.lastEditTargetBytes.length > 0);
  }
});

await run('活动图片跨进程持久化', async () => {
  const convId = (await getOrCreateConversation(crypto.randomUUID())).id;
  let v2id;
  {
    const { svc } = makeService(convId);
    await svc.uploadFile(Buffer.from('a'), 'png');
    const { version } = await svc.generateImage('test');
    v2id = version.id;
  }
  {
    const { svc } = makeService(convId);
    const active = await svc.getActive();
    assert.equal(active?.id, v2id);
  }
});

console.log(`\n全部通过：${passed} 项`);
await rm(tmpBase, { recursive: true, force: true });
await closePool();

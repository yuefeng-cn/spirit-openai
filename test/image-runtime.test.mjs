/**
 * P3-01：ImageStorage 和 MockImageProvider 离线单元测试。
 * 运行：npm test（在 npm test 脚本中）
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalImageStorage } from '../dist/image/image-storage.js';
import { MockImageProvider } from '../dist/image/providers/mock.js';
import { EMPTY_IMAGE_CONTEXT } from '../dist/image/types.js';

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

let tmpDir;
before: {
  tmpDir = await mkdtemp(join(tmpdir(), 'spirit-test-'));
}

// ── MockImageProvider ─────────────────────────────────────

console.log('■ MockImageProvider');

await run('generate 返回非空字节和扩展名', async () => {
  const provider = new MockImageProvider();
  const r = await provider.generate({ prompt: '一只猫' });
  assert(r.data.length > 0);
  assert.equal(r.ext, 'png');
  assert.ok(r.providerState);
});

await run('edit 收到真实字节后返回结果', async () => {
  const provider = new MockImageProvider();
  const fakeImg = Buffer.from('fake-image-bytes');
  const r = await provider.edit({
    targetImage: fakeImg,
    targetVersionId: 'ver-1',
    prompt: '改成黑色',
    imageContext: EMPTY_IMAGE_CONTEXT,
  });
  assert(r.data.length > 0);
  assert.deepEqual(provider.lastEditTargetBytes, fakeImg);
  assert.equal(provider.lastEditTargetVersionId, 'ver-1');
});

await run('edit 空字节时抛错（不允许代词替代图片）', async () => {
  const provider = new MockImageProvider();
  await assert.rejects(
    () => provider.edit({
      targetImage: Buffer.alloc(0),
      targetVersionId: 'ver-1',
      prompt: 'test',
      imageContext: EMPTY_IMAGE_CONTEXT,
    }),
    /字节/,
  );
});

// ── LocalImageStorage ─────────────────────────────────────

console.log('■ LocalImageStorage');

await run('save → read 保持字节一致', async () => {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const data = Buffer.from('hello image');
  const key = await storage.save(data, 'png');
  assert.match(key, /\.png$/);
  const loaded = await storage.read(key);
  assert.deepEqual(loaded, data);
});

await run('save 多次返回不同 objectKey', async () => {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const data = Buffer.from('img');
  const k1 = await storage.save(data, 'png');
  const k2 = await storage.save(data, 'png');
  assert.notEqual(k1, k2);
});

await run('materialize 输出绝对路径，文件内容与原始字节一致', async () => {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const data = Buffer.from('materialize test');
  const key = await storage.save(data, 'png');
  const outPath = await storage.materialize(key, 'conv-abc', 3);
  assert.ok(outPath.startsWith('/'));  // 绝对路径
  assert(outPath.includes('img-3.png'));
  const loaded = await readFile(outPath);
  assert.deepEqual(loaded, data);
});

await run('materialize 路径由 conversationId 和 displayNo 推导，不写数据库', async () => {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const key = await storage.save(Buffer.from('x'), 'png');
  const p1 = await storage.materialize(key, 'conv-1', 1);
  const p2 = await storage.materialize(key, 'conv-2', 1);
  assert(p1.includes('conv-1'));
  assert(p2.includes('conv-2'));
  assert.notEqual(p1, p2);
});

console.log(`\n全部通过：${passed} 项`);

// 清理临时目录
await rm(tmpDir, { recursive: true, force: true });

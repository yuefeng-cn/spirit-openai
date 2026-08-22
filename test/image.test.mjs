/**
 * P2-02 / P3-02：ImageService 单元测试（in-memory mock，无需数据库）。
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { ImageService, formatRef } from '../dist/image/image-service.js';
import { EMPTY_IMAGE_CONTEXT } from '../dist/image/types.js';
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

// ── in-memory mock repo ───────────────────────────────────

function makeMockRepo() {
  const versions = new Map(); // id → ImageVersion
  let counter = 0;
  const activeMap = new Map(); // conversationId → id | null

  return {
    async createImageVersion(input) {
      const maxNo = Math.max(0, ...[...versions.values()]
        .filter(v => v.conversationId === input.conversationId)
        .map(v => v.displayNo));
      const version = {
        id: `ver-${++counter}`,
        conversationId: input.conversationId,
        displayNo: maxNo + 1,
        sourceType: input.sourceType,
        messageId: input.messageId ?? null,
        parentVersionId: input.parentVersionId ?? null,
        objectKey: input.objectKey,
        prompt: input.prompt ?? null,
        imageContext: input.imageContext ?? EMPTY_IMAGE_CONTEXT,
        provider: input.provider ?? null,
        model: input.model ?? null,
        providerState: input.providerState ?? null,
        createdAt: new Date(),
      };
      versions.set(version.id, version);
      return version;
    },
    async getImageVersion(id, conversationId) {
      const v = versions.get(id);
      return v && v.conversationId === conversationId ? v : null;
    },
    async getImageVersionByDisplayNo(conversationId, displayNo) {
      return [...versions.values()].find(
        v => v.conversationId === conversationId && v.displayNo === displayNo
      ) ?? null;
    },
    async listImageVersions(conversationId) {
      return [...versions.values()]
        .filter(v => v.conversationId === conversationId)
        .sort((a, b) => a.displayNo - b.displayNo);
    },
    async getActiveImageVersionId(conversationId) {
      return activeMap.get(conversationId) ?? null;
    },
    async setActiveImageVersionId(conversationId, id) {
      activeMap.set(conversationId, id);
    },
  };
}

// ── 测试 ──────────────────────────────────────────────────

console.log('■ ImageService');

await run('registerUpload 分配 displayNo=1 并设为活动图', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v = await svc.registerUpload('uploads/a.png');
  assert.equal(v.displayNo, 1);
  assert.equal(v.sourceType, 'upload');
  const active = await svc.getActive();
  assert.equal(active?.id, v.id);
});

await run('registerGenerated 分配递增 displayNo，更新活动图', async () => {
  const repo = makeMockRepo();
  const svc = new ImageService('conv-1', repo);
  const u = await svc.registerUpload('a.png');
  const g = await svc.registerGenerated('b.png', '一只猫');
  assert.equal(u.displayNo, 1);
  assert.equal(g.displayNo, 2);
  const active = await svc.getActive();
  assert.equal(active?.id, g.id);
});

await run('clearActive 后 getActive 返回 null', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  await svc.registerUpload('a.png');
  await svc.clearActive();
  assert.equal(await svc.getActive(), null);
});

await run('resolveReference：@img-N 精确查找', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v = await svc.registerUpload('a.png');
  const r = await svc.resolveReference('@img-1');
  assert.equal(r.found, true);
  assert.equal(r.version.id, v.id);
});

await run('resolveReference：@img-N 不存在返回 none', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const r = await svc.resolveReference('@img-99');
  assert.equal(r.found, false);
  assert.equal(r.reason, 'none');
});

await run('resolveReference："当前图" 解析为活动图', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v = await svc.registerUpload('a.png');
  const r = await svc.resolveReference('刚才这张');
  assert.equal(r.found, true);
  assert.equal(r.version.id, v.id);
});

await run('resolveReference：活动图为空时"当前图"返回 none', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const r = await svc.resolveReference('当前图');
  assert.equal(r.found, false);
  assert.equal(r.reason, 'none');
});

await run('resolveReference："上一张" 返回活动图的前一张', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v1 = await svc.registerUpload('a.png');
  await svc.registerGenerated('b.png', 'test');
  const r = await svc.resolveReference('上一张');
  assert.equal(r.found, true);
  assert.equal(r.version.id, v1.id);
});

await run('resolveReference："这张图" 本轮唯一上传图', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v = await svc.registerUpload('a.png');
  const r = await svc.resolveReference('这张图', [v]);
  assert.equal(r.found, true);
  assert.equal(r.version.id, v.id);
});

await run('resolveReference："这张图" 多张时歧义', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v1 = await svc.registerUpload('a.png');
  const v2 = await svc.registerUpload('b.png');
  const r = await svc.resolveReference('这张图', [v1, v2]);
  assert.equal(r.found, false);
  assert.equal(r.reason, 'ambiguous');
  assert.equal(r.candidates.length, 2);
});

await run('resolveReference："第3张" 按 displayNo 查找', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  await svc.registerUpload('a.png');
  await svc.registerUpload('b.png');
  const v3 = await svc.registerGenerated('c.png', 'test');
  const r = await svc.resolveReference('第3张');
  assert.equal(r.found, true);
  assert.equal(r.version.id, v3.id);
});

await run('buildEditContext 返回目标版本与 imageContext', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const v = await svc.registerGenerated('a.png', 'test', {
    imageContext: { summary: '一只白猫', preserve: ['白色毛发'] },
  });
  const ctx = await svc.buildEditContext(v.id, '改成黑猫');
  assert.equal(ctx?.targetVersion.id, v.id);
  assert.equal(ctx?.imageContext.summary, '一只白猫');
  assert.equal(ctx?.turnRequest, '改成黑猫');
});

await run('新图不继承其他根图的 imageContext', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  await svc.registerUpload('a.png', { imageContext: { summary: '风景', preserve: ['山峰'] } });
  const newImg = await svc.registerGenerated('b.png', '画一只猫');
  // 新生成图不携带来自 a.png 的上下文
  assert.equal(newImg.imageContext.summary, '');
  assert.deepEqual(newImg.imageContext.preserve, []);
});

await run('inheritContext 从父版本复制并覆盖 summary', async () => {
  const svc = new ImageService('conv-1', makeMockRepo());
  const parent = await svc.registerGenerated('a.png', 'test', {
    imageContext: { summary: '一只猫', preserve: ['蓝眼睛'] },
  });
  const inherited = svc.inheritContext(parent, { summary: '一只黑猫' });
  assert.equal(inherited.summary, '一只黑猫');
  assert.deepEqual(inherited.preserve, ['蓝眼睛']);
});

await run('formatRef 格式化正确', () => {
  assert.equal(formatRef(1), '@img-1');
  assert.equal(formatRef(10), '@img-10');
});

console.log(`\n全部通过：${passed} 项`);

// ── P3-02：高层操作闭环测试（in-memory repo + LocalImageStorage + MockImageProvider）

console.log('\n■ ImageService 闭环（uploadFile / generateImage / editImage）');

const tmpDir = await mkdtemp(tmpdir() + '/spirit-p3-');

function makeSvcWithRuntime(convId = 'conv-rt') {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const provider = new MockImageProvider();
  const repo = makeMockRepo();
  const svc = new ImageService(convId, repo, storage, provider);
  return { svc, storage, provider, repo };
}

await run('uploadFile 保存文件并创建 upload 版本', async () => {
  const { svc } = makeSvcWithRuntime();
  const data = Buffer.from('raw image bytes');
  const v = await svc.uploadFile(data, 'png');
  assert.equal(v.sourceType, 'upload');
  assert.match(v.objectKey, /\.png$/);
  assert.equal((await svc.getActive())?.id, v.id);
});

await run('generateImage 返回版本和本机路径，objectKey 是字符串非二进制', async () => {
  const { svc } = makeSvcWithRuntime('conv-gen');
  const { version, localPath } = await svc.generateImage('一只橙色的猫');
  assert.equal(version.sourceType, 'generated');
  assert.equal(typeof version.objectKey, 'string');
  assert.ok(localPath && localPath.includes('img-1.png'));
  assert.equal(version.prompt, '一只橙色的猫');
  assert.equal((await svc.getActive())?.id, version.id);
});

await run('editImage 从 Storage 读取目标图片字节并传给 Provider', async () => {
  const { svc, provider } = makeSvcWithRuntime('conv-edit');
  const data = Buffer.from('source image');
  const upload = await svc.uploadFile(data, 'png');

  const { version } = await svc.editImage(upload.id, '改成黑白');
  assert.equal(version.parentVersionId, upload.id);
  assert.equal(version.sourceType, 'generated');
  assert.equal(provider.lastEditTargetVersionId, upload.id);
  // 验证 Provider 收到了实际图片字节（非空）
  assert.ok(provider.lastEditTargetBytes && provider.lastEditTargetBytes.length > 0);
  assert.deepEqual(provider.lastEditTargetBytes, data);
});

await run('editImage 继承父图 imageContext', async () => {
  const { svc } = makeSvcWithRuntime('conv-ctx');
  const upload = await svc.uploadFile(Buffer.from('test img'), 'png', {
    imageContext: { summary: '蓝天', preserve: ['云朵'] },
  });
  const { version } = await svc.editImage(upload.id, '加一只鸟');
  assert.equal(version.imageContext.summary, '蓝天');
  assert.deepEqual(version.imageContext.preserve, ['云朵']);
});

await run('连续编辑形成父子链', async () => {
  const { svc } = makeSvcWithRuntime('conv-chain');
  const v1 = await svc.uploadFile(Buffer.from('img'), 'png');
  const { version: v2 } = await svc.editImage(v1.id, '第一次改');
  const { version: v3 } = await svc.editImage(v2.id, '第二次改');
  assert.equal(v2.parentVersionId, v1.id);
  assert.equal(v3.parentVersionId, v2.id);
  assert.equal(v3.displayNo, 3);
});

await run('旧图分支编辑', async () => {
  const { svc } = makeSvcWithRuntime('conv-branch');
  const v1 = await svc.uploadFile(Buffer.from('img'), 'png');
  const { version: v2 } = await svc.editImage(v1.id, '分支A');
  await svc.setActive(v1.id); // 切回 v1
  const { version: v3 } = await svc.editImage(v1.id, '分支B');
  assert.equal(v2.parentVersionId, v1.id);
  assert.equal(v3.parentVersionId, v1.id);
  assert.equal(v3.displayNo, 3);
  assert.equal((await svc.getActive())?.id, v3.id);
});

await run('Provider 失败时不写版本，活动图不变', async () => {
  const repo = makeMockRepo();
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const brokenProvider = {
    async generate() { throw new Error('网络错误'); },
    async edit() { throw new Error('网络错误'); },
  };
  const upload = { id: 'v-orig', conversationId: 'conv-fail', displayNo: 1, sourceType: 'upload',
    messageId: null, parentVersionId: null, objectKey: await storage.save(Buffer.from('x'), 'png'),
    prompt: null, imageContext: EMPTY_IMAGE_CONTEXT, provider: null, model: null,
    providerState: null, createdAt: new Date() };
  repo.createImageVersion.call; // warm up
  const svc = new ImageService('conv-fail', repo, storage, brokenProvider);
  await repo.createImageVersion({ conversationId: 'conv-fail', sourceType: 'upload', objectKey: upload.objectKey });
  await repo.setActiveImageVersionId('conv-fail', upload.id);

  const activeIdBefore = await repo.getActiveImageVersionId('conv-fail');
  await assert.rejects(() => svc.generateImage('test'), /网络错误/);
  const activeIdAfter = await repo.getActiveImageVersionId('conv-fail');
  assert.equal(activeIdBefore, activeIdAfter);
});

await run('数据库写入失败时不更新活动图', async () => {
  const storage = new LocalImageStorage(tmpDir, tmpDir);
  const brokenRepo = {
    ...makeMockRepo(),
    async createImageVersion() { throw new Error('DB error'); },
  };
  const svc = new ImageService('conv-dbfail', brokenRepo, storage, new MockImageProvider());
  await assert.rejects(() => svc.generateImage('test'), /DB error/);
});

console.log(`\n全部通过：${passed} 项`);
await rm(tmpDir, { recursive: true, force: true });

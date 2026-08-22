/**
 * P4-02：image-tools 单元测试。
 * 直接调用 executeGenerateImage / executeEditImage，不经过 Agent LLM。
 * 使用内存 mock repo + LocalImageStorage + MockImageProvider。
 * 运行：node test/image-tools.test.mjs
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { ImageService } from '../dist/image/image-service.js';
import { LocalImageStorage } from '../dist/image/image-storage.js';
import { MockImageProvider } from '../dist/image/providers/mock.js';
import { executeGenerateImage, executeEditImage } from '../dist/image/image-tools.js';

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

// ── 内存 mock repo ─────────────────────────────────────────

class MemImageRepo {
  constructor() {
    this.versions = [];
    this.activeId = null;
    this.nextNo = 1;
  }
  async createImageVersion(input) {
    const v = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      displayNo: this.nextNo++,
      sourceType: input.sourceType,
      messageId: input.messageId ?? null,
      parentVersionId: input.parentVersionId ?? null,
      objectKey: input.objectKey,
      prompt: input.prompt ?? null,
      imageContext: input.imageContext ?? { summary: '', preserve: [] },
      provider: input.provider ?? null,
      model: input.model ?? null,
      providerState: input.providerState ?? null,
      createdAt: new Date(),
    };
    this.versions.push(v);
    this.activeId = v.id;
    return v;
  }
  async getImageVersion(id) { return this.versions.find(v => v.id === id) ?? null; }
  async getImageVersionByDisplayNo(_, displayNo) {
    return this.versions.find(v => v.displayNo === displayNo) ?? null;
  }
  async listImageVersions() { return [...this.versions]; }
  async getActiveImageVersionId() { return this.activeId; }
  async setActiveImageVersionId(_, id) { this.activeId = id; }
}

// ── 准备 ──────────────────────────────────────────────────

const tmpBase = await mkdtemp(tmpdir() + '/spirit-tools-');
const storageDir = tmpBase + '/store';
const outputDir = tmpBase + '/output';

function makeService() {
  const convId = crypto.randomUUID();
  const repo = new MemImageRepo();
  const storage = new LocalImageStorage(storageDir, outputDir);
  const provider = new MockImageProvider();
  const svc = new ImageService(convId, repo, storage, provider);
  return { svc, provider, convId };
}

console.log('■ image-tools（executeGenerateImage / executeEditImage）');

// ── 测试项 ─────────────────────────────────────────────────

await run('上传图片后 edit_image 解析"这张图"引用并返回父图信息', async () => {
  const { svc } = makeService();
  const upload = await svc.uploadFile(Buffer.from('my image'), 'png');
  const turnUploads = [upload];

  const msg = await executeEditImage(svc, () => turnUploads, {
    reference: '这张图',
    prompt: '改成黑白',
  });

  assert.ok(msg.includes('@img-2'), `应包含新版本编号，实际：${msg}`);
  assert.ok(msg.includes('@img-1'), `应包含父图编号，实际：${msg}`);
  assert.ok(msg.includes('本地文件：'), `应包含本地路径，实际：${msg}`);
  assert.ok(!msg.includes('（物化失败）'), `物化应成功，实际：${msg}`);
});

await run('executeGenerateImage 返回 @img-N 和本地路径', async () => {
  const { svc } = makeService();
  const msg = await executeGenerateImage(svc, { prompt: '一只橙猫' });

  assert.ok(msg.startsWith('@img-1'), `首行应为 @img-1，实际：${msg}`);
  assert.ok(msg.includes('本地文件：'), `应包含本地路径，实际：${msg}`);
  assert.ok(!msg.includes('（物化失败）'), `物化应成功，实际：${msg}`);
});

await run('纯文字对话不附带无关图片（本轮上传列表为空）', async () => {
  const { svc } = makeService();
  // 空 currentTurnUploads，不影响生成
  const msg = await executeGenerateImage(svc, { prompt: '画一朵云' });
  assert.ok(msg.startsWith('@img-1'), `应生成 @img-1，实际：${msg}`);
});

await run('@img-N 精确引用历史图片分支编辑', async () => {
  const { svc } = makeService();
  const v1 = await svc.uploadFile(Buffer.from('root'), 'png');
  await svc.editImage(v1.id, '第一次编辑'); // → @img-2
  await svc.setActive(v1.id);

  // 从 @img-1 分支
  const msg = await executeEditImage(svc, () => [], {
    reference: '@img-1',
    prompt: '另一种风格',
  });
  assert.ok(msg.includes('@img-3'), `应生成 @img-3，实际：${msg}`);
  assert.ok(msg.includes('@img-1'), `父图应为 @img-1，实际：${msg}`);
});

await run('"刚才这张"解析为本轮唯一上传图', async () => {
  const { svc } = makeService();
  const upload = await svc.uploadFile(Buffer.from('latest upload'), 'png');
  const turnUploads = [upload];

  const msg = await executeEditImage(svc, () => turnUploads, {
    reference: '刚才这张',
    prompt: '加点颜色',
  });
  assert.ok(msg.includes('@img-1'), `父图应为 @img-1，实际：${msg}`);
  assert.ok(msg.includes('@img-2'), `新版本应为 @img-2，实际：${msg}`);
});

await run('歧义引用返回澄清提示而不报错', async () => {
  const { svc } = makeService();
  const u1 = await svc.uploadFile(Buffer.from('img1'), 'png');
  const u2 = await svc.uploadFile(Buffer.from('img2'), 'png');
  const turnUploads = [u1, u2];

  // "这张图" 在本轮有 2 张时应歧义
  const msg = await executeEditImage(svc, () => turnUploads, {
    reference: '这张图',
    prompt: '随便改',
  });
  assert.ok(msg.startsWith('无法确定目标图片：'), `应返回澄清提示，实际：${msg}`);
});

await run('新会话与旧会话的 displayNo 相互独立', async () => {
  const svcA = makeService().svc;
  const svcB = makeService().svc;

  // A：上传两张
  await svcA.uploadFile(Buffer.from('a1'), 'png');
  await svcA.uploadFile(Buffer.from('a2'), 'png');

  // B：上传一张
  const vB = await svcB.uploadFile(Buffer.from('b1'), 'png');

  assert.equal(vB.displayNo, 1, `B 的 displayNo 应从 1 开始，实际：${vB.displayNo}`);
});

// ── 清理 ──────────────────────────────────────────────────

console.log(`\n全部通过：${passed} 项`);
await rm(tmpBase, { recursive: true, force: true });

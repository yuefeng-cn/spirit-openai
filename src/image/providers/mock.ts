/**
 * Mock 图片 Provider：离线、可重复，用于测试。
 * generate/edit 均返回固定字节，不依赖网络。
 * edit 会断言收到了非空目标图片字节，并记录以供测试验证。
 */
import type { ImageProvider, GenerateRequest, EditRequest, ProviderResult } from '../image-provider.js';

export class MockImageProvider implements ImageProvider {
  /** 最近一次 edit 收到的目标图片字节，供测试断言 */
  lastEditTargetBytes: Buffer | null = null;
  /** 最近一次 edit 收到的 targetVersionId */
  lastEditTargetVersionId: string | null = null;

  async generate(req: GenerateRequest): Promise<ProviderResult> {
    return {
      data: Buffer.from(`MOCK_GENERATED:${req.prompt}`),
      ext: 'png',
      providerState: { mock: true, op: 'generate', prompt: req.prompt },
    };
  }

  async edit(req: EditRequest): Promise<ProviderResult> {
    if (!req.targetImage || req.targetImage.length === 0) {
      throw new Error('MockProvider: edit 必须携带非空目标图片字节');
    }
    this.lastEditTargetBytes = req.targetImage;
    this.lastEditTargetVersionId = req.targetVersionId;
    return {
      data: Buffer.from(`MOCK_EDITED:${req.prompt}:from:${req.targetVersionId}`),
      ext: 'png',
      providerState: { mock: true, op: 'edit', targetVersionId: req.targetVersionId },
    };
  }
}

/**
 * 图片 Provider 接口。
 * URL、Base64、二进制只在 Storage/Provider 内部流动，不进入数据库。
 */
import type { ImageContext } from './types.js';

export interface GenerateRequest {
  prompt: string;
}

export interface EditRequest {
  /** 目标图片的原始字节（从 Storage 读取，已解析的唯一图片） */
  targetImage: Buffer;
  /** 已解析的唯一目标版本 ID，不能是代词 */
  targetVersionId: string;
  prompt: string;
  imageContext: ImageContext;
  /** Provider 连续状态（可选，过期或不兼容时忽略） */
  providerState?: unknown;
}

export interface ProviderResult {
  data: Buffer;
  ext: string;
  /** Provider 返回的连续状态（可选） */
  providerState?: unknown;
}

export interface ImageProvider {
  generate(req: GenerateRequest): Promise<ProviderResult>;
  edit(req: EditRequest): Promise<ProviderResult>;
}

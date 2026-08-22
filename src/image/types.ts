/**
 * 图片模块核心类型。
 */

export interface ImageContext {
  summary: string;
  preserve: string[];
}

export const EMPTY_IMAGE_CONTEXT: ImageContext = { summary: '', preserve: [] };

export interface ImageVersion {
  id: string;
  conversationId: string;
  displayNo: number;
  sourceType: 'upload' | 'generated';
  /** messages.id（BIGINT，pg 以字符串返回） */
  messageId: string | null;
  parentVersionId: string | null;
  objectKey: string;
  prompt: string | null;
  imageContext: ImageContext;
  provider: string | null;
  model: string | null;
  providerState: unknown | null;
  createdAt: Date;
}

export interface CreateImageVersionInput {
  conversationId: string;
  sourceType: 'upload' | 'generated';
  messageId?: string | null;
  parentVersionId?: string | null;
  objectKey: string;
  prompt?: string | null;
  imageContext?: ImageContext;
  provider?: string | null;
  model?: string | null;
  providerState?: unknown | null;
}

/** ImageService 对外依赖的最小 Repository 接口，方便测试时用 mock 替换 */
export interface ImageRepo {
  createImageVersion(input: CreateImageVersionInput): Promise<ImageVersion>;
  getImageVersion(id: string, conversationId: string): Promise<ImageVersion | null>;
  getImageVersionByDisplayNo(conversationId: string, displayNo: number): Promise<ImageVersion | null>;
  listImageVersions(conversationId: string): Promise<ImageVersion[]>;
  getActiveImageVersionId(conversationId: string): Promise<string | null>;
  setActiveImageVersionId(conversationId: string, imageVersionId: string | null): Promise<void>;
}

/** 引用解析结果 */
export type ResolveResult =
  | { found: true; version: ImageVersion }
  | { found: false; reason: 'ambiguous'; candidates: ImageVersion[]; message: string }
  | { found: false; reason: 'none'; message: string };

/** 编辑上下文（Provider 调用前的完整输入结构） */
export interface EditContext {
  targetVersion: ImageVersion;
  imageContext: ImageContext;
  turnRequest: string;
}

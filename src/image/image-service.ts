/**
 * ImageService：图片登记、引用解析、编辑上下文构建和运行闭环。
 * 通过 ImageRepo 接口访问存储，方便单元测试注入 mock。
 * P3 阶段加入 ImageStorage 和 ImageProvider 支持高层 uploadFile/generateImage/editImage。
 */
import type {
  ImageVersion,
  ImageContext,
  ImageRepo,
  CreateImageVersionInput,
  ResolveResult,
  EditContext,
} from './types.js';
import { EMPTY_IMAGE_CONTEXT } from './types.js';
import type { ImageStorage } from './image-storage.js';
import type { ImageProvider } from './image-provider.js';

/** 将 displayNo 格式化为 @img-N */
export function formatRef(displayNo: number): string {
  return `@img-${displayNo}`;
}

/** 解析 @img-N 中的 N，不匹配返回 null */
function parseAtRef(text: string): number | null {
  const m = text.match(/^@img-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/** 解析"第 N 张"/"第N幅"/"第N个" 中的 N */
function parseOrdinal(text: string): number | null {
  const m = text.match(/第\s*(\d+)\s*[张幅个]/);
  return m ? Number(m[1]) : null;
}

/** 简单 UUID 格式检测 */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export class ImageService {
  constructor(
    private readonly conversationId: string,
    private readonly repo: ImageRepo,
    private readonly storage?: ImageStorage,
    private readonly provider?: ImageProvider,
  ) {}

  // ── 登记 ──────────────────────────────────────────────────

  /** 登记用户上传图（根图片，sourceType=upload） */
  async registerUpload(
    objectKey: string,
    opts?: { messageId?: string; imageContext?: ImageContext },
  ): Promise<ImageVersion> {
    const version = await this.repo.createImageVersion({
      conversationId: this.conversationId,
      sourceType: 'upload',
      objectKey,
      messageId: opts?.messageId ?? null,
      imageContext: opts?.imageContext ?? EMPTY_IMAGE_CONTEXT,
    });
    await this.repo.setActiveImageVersionId(this.conversationId, version.id);
    return version;
  }

  /** 登记模型生成的新图（根图片，sourceType=generated） */
  async registerGenerated(
    objectKey: string,
    prompt: string,
    opts?: {
      messageId?: string;
      parentVersionId?: string | null;
      imageContext?: ImageContext;
      provider?: string;
      model?: string;
      providerState?: unknown;
    },
  ): Promise<ImageVersion> {
    const input: CreateImageVersionInput = {
      conversationId: this.conversationId,
      sourceType: 'generated',
      objectKey,
      prompt,
      messageId: opts?.messageId ?? null,
      parentVersionId: opts?.parentVersionId ?? null,
      imageContext: opts?.imageContext ?? EMPTY_IMAGE_CONTEXT,
      provider: opts?.provider ?? null,
      model: opts?.model ?? null,
      providerState: opts?.providerState ?? null,
    };
    const version = await this.repo.createImageVersion(input);
    await this.repo.setActiveImageVersionId(this.conversationId, version.id);
    return version;
  }

  // ── 活动图片 ───────────────────────────────────────────────

  async getActive(): Promise<ImageVersion | null> {
    const id = await this.repo.getActiveImageVersionId(this.conversationId);
    if (!id) return null;
    return this.repo.getImageVersion(id, this.conversationId);
  }

  async setActive(imageVersionId: string): Promise<void> {
    await this.repo.setActiveImageVersionId(this.conversationId, imageVersionId);
  }

  async clearActive(): Promise<void> {
    await this.repo.setActiveImageVersionId(this.conversationId, null);
  }

  /** 列出当前会话全部图片版本 */
  async listVersions(): Promise<ImageVersion[]> {
    return this.repo.listImageVersions(this.conversationId);
  }

  /** 获取当前活动图片版本 id */
  async getActiveId(): Promise<string | null> {
    return this.repo.getActiveImageVersionId(this.conversationId);
  }

  // ── 引用解析 ───────────────────────────────────────────────

  /**
   * 将自然语言或显式引用解析为唯一 ImageVersion。
   *
   * @param ref                 用户指代文本
   * @param currentTurnUploads  本轮上传图版本（用于"这张图"解析）
   */
  async resolveReference(
    ref: string,
    currentTurnUploads: ImageVersion[] = [],
  ): Promise<ResolveResult> {
    const trimmed = ref.trim();

    // 1. 显式 @img-N
    const n = parseAtRef(trimmed);
    if (n !== null) {
      const v = await this.repo.getImageVersionByDisplayNo(this.conversationId, n);
      if (v) return { found: true, version: v };
      return { found: false, reason: 'none', message: `未找到 @img-${n}，请检查编号。` };
    }

    // 2. UUID
    if (looksLikeUuid(trimmed)) {
      const v = await this.repo.getImageVersion(trimmed, this.conversationId);
      if (v) return { found: true, version: v };
      return { found: false, reason: 'none', message: `未找到版本 ${trimmed}。` };
    }

    // 3. "第N张"
    const ord = parseOrdinal(trimmed);
    if (ord !== null) {
      const v = await this.repo.getImageVersionByDisplayNo(this.conversationId, ord);
      if (v) return { found: true, version: v };
      return { found: false, reason: 'none', message: `未找到第 ${ord} 张图片，请检查编号。` };
    }

    // 4. 本轮唯一上传图
    if (/这张[图参考]*|这[张幅]/.test(trimmed)) {
      if (currentTurnUploads.length === 1) {
        return { found: true, version: currentTurnUploads[0] };
      }
      if (currentTurnUploads.length > 1) {
        return this.ambiguous(currentTurnUploads, '本轮上传了多张图，请用 @img-N 指定目标。');
      }
    }

    // 5. 当前活动图
    if (/刚才这张|当前图|当前图片|active/.test(trimmed)) {
      const active = await this.getActive();
      if (active) return { found: true, version: active };
      return { found: false, reason: 'none', message: '当前没有活动图片，请先选择一张（/image use @img-N）。' };
    }

    // 6. "上一张"
    if (/上一张|上一个|上一幅/.test(trimmed)) {
      const active = await this.getActive();
      if (active && active.displayNo > 1) {
        const prev = await this.repo.getImageVersionByDisplayNo(
          this.conversationId,
          active.displayNo - 1,
        );
        if (prev) return { found: true, version: prev };
      }
      const all = await this.repo.listImageVersions(this.conversationId);
      if (all.length >= 2) {
        return { found: true, version: all[all.length - 2] };
      }
      return { found: false, reason: 'none', message: '没有找到上一张图片。' };
    }

    // 7. 无法解析
    return {
      found: false,
      reason: 'none',
      message: '无法识别图片引用，请使用 @img-N 或 /image list 查看可用图片。',
    };
  }

  private async ambiguous(
    candidates: ImageVersion[],
    message: string,
  ): Promise<ResolveResult> {
    const hint = candidates.map((v) => `${formatRef(v.displayNo)}（${v.sourceType}）`).join('、');
    return {
      found: false,
      reason: 'ambiguous',
      candidates,
      message: `${message} 候选：${hint}`,
    };
  }

  // ── 上下文构建 ─────────────────────────────────────────────

  /**
   * 从父版本复制 imageContext 并更新 summary；
   * 新建图片不从其他根图继承上下文。
   */
  inheritContext(parent: ImageVersion, overrides: Partial<ImageContext>): ImageContext {
    return {
      summary: overrides.summary ?? parent.imageContext.summary,
      preserve: overrides.preserve ?? parent.imageContext.preserve,
    };
  }

  /**
   * 构建 Provider 调用前的编辑上下文。
   * targetVersionId 必须是已解析的唯一版本 ID，不能是代词。
   */
  async buildEditContext(
    targetVersionId: string,
    turnRequest: string,
  ): Promise<EditContext | null> {
    const version = await this.repo.getImageVersion(targetVersionId, this.conversationId);
    if (!version) return null;
    return {
      targetVersion: version,
      imageContext: version.imageContext,
      turnRequest,
    };
  }

  // ── P3 高层操作（需要 storage + provider）─────────────────

  /**
   * 上传用户图片：保存到 Storage，登记为 upload 根版本。
   * 用户必须先将文件读成 Buffer 后调用。
   */
  async uploadFile(
    data: Buffer,
    ext: string,
    opts?: { messageId?: string; imageContext?: ImageContext },
  ): Promise<ImageVersion> {
    if (!this.storage) throw new Error('ImageStorage 未配置');
    const objectKey = await this.storage.save(data, ext);
    return this.registerUpload(objectKey, opts);
  }

  /**
   * 生成新图：调用 Provider → 保存到 Storage → 写入版本记录 → 物化本机文件。
   * Provider 失败时不写版本；Storage 失败时不写版本；
   * 物化失败时版本已保存，通过 warning 通知调用方。
   */
  async generateImage(
    prompt: string,
    opts?: {
      messageId?: string;
      imageContext?: ImageContext;
      provider?: string;
      model?: string;
    },
  ): Promise<{ version: ImageVersion; localPath: string | null; warning?: string }> {
    if (!this.storage) throw new Error('ImageStorage 未配置');
    if (!this.provider) throw new Error('ImageProvider 未配置');

    const result = await this.provider.generate({ prompt }); // 失败则抛，不写任何内容
    const objectKey = await this.storage.save(result.data, result.ext); // 失败则抛

    let version: ImageVersion;
    try {
      version = await this.registerGenerated(objectKey, prompt, {
        ...opts,
        providerState: result.providerState ?? null,
      });
    } catch (err) {
      console.error(`[警告] 孤立 Storage 文件（版本写入失败）：${objectKey}`);
      throw err;
    }

    return this.materializeResult(objectKey, version);
  }

  /**
   * 编辑图片：解析已确定的 targetVersionId（调用方必须先通过 resolveReference 解析代词）
   * → 从 Storage 读取目标图片字节 → 调用 Provider → 保存结果 → 写入子版本记录 → 物化。
   * Provider 失败、Storage 失败时不写版本，活动图片保持不变。
   */
  async editImage(
    targetVersionId: string,
    prompt: string,
    opts?: {
      messageId?: string;
      useProviderState?: boolean;
      imageContext?: ImageContext;
      provider?: string;
      model?: string;
    },
  ): Promise<{ version: ImageVersion; localPath: string | null; warning?: string }> {
    if (!this.storage) throw new Error('ImageStorage 未配置');
    if (!this.provider) throw new Error('ImageProvider 未配置');

    const targetVersion = await this.repo.getImageVersion(targetVersionId, this.conversationId);
    if (!targetVersion) throw new Error(`图片版本 ${targetVersionId} 不存在`);

    const targetImage = await this.storage.read(targetVersion.objectKey);

    const result = await this.provider.edit({
      targetImage,
      targetVersionId,
      prompt,
      imageContext: targetVersion.imageContext,
      providerState: opts?.useProviderState ? (targetVersion.providerState ?? undefined) : undefined,
    });

    const objectKey = await this.storage.save(result.data, result.ext);

    let version: ImageVersion;
    try {
      version = await this.registerGenerated(objectKey, prompt, {
        parentVersionId: targetVersion.id,
        messageId: opts?.messageId,
        imageContext: opts?.imageContext ?? this.inheritContext(targetVersion, {}),
        providerState: result.providerState ?? null,
        provider: opts?.provider,
        model: opts?.model,
      });
    } catch (err) {
      console.error(`[警告] 孤立 Storage 文件（版本写入失败）：${objectKey}`);
      throw err;
    }

    return this.materializeResult(objectKey, version);
  }

  private async materializeResult(
    objectKey: string,
    version: ImageVersion,
  ): Promise<{ version: ImageVersion; localPath: string | null; warning?: string }> {
    if (!this.storage) return { version, localPath: null };
    try {
      const localPath = await this.storage.materialize(
        objectKey,
        this.conversationId,
        version.displayNo,
      );
      return { version, localPath };
    } catch (err) {
      return {
        version,
        localPath: null,
        warning: `本机文件未生成（图片已保存到 Storage）：${err instanceof Error ? err.message : err}`,
      };
    }
  }
}

/**
 * OpenAI gpt-image-2 Provider（Azure 部署）。
 * 无连续状态：编辑每次传目标图片字节，providerState 始终为 undefined。
 * 环境变量：OPENAI_IMAGE_ENDPOINT / OPENAI_IMAGE_API_KEY / OPENAI_IMAGE_MODEL
 */
import type { ImageProvider, GenerateRequest, EditRequest, ProviderResult } from '../image-provider.js';

const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_QUALITY = 'medium';

function requireImageEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[OpenAIImageProvider] 缺少环境变量 ${name}`);
  return v;
}

/** 将生成 endpoint 改造为编辑 endpoint */
function buildEditUrl(generationUrl: string): string {
  return generationUrl
    .replace('/images/generations', '/images/edits')
    .replace('2024-02-01', '2025-04-01-preview');
}

interface AzureImageResponse {
  data?: { b64_json?: string }[];
  error?: { code?: string; message?: string };
}

function mapError(body: string): string {
  if (
    body.includes('safety system') ||
    body.includes('content policy') ||
    body.includes('content management') ||
    body.includes('contentFilter')
  ) {
    return '图像或提示词被安全系统拒绝，请检查内容是否符合使用政策';
  }
  try {
    const parsed = JSON.parse(body) as AzureImageResponse;
    const code = parsed.error?.code ?? '';
    const message = parsed.error?.message ?? '';
    if (code === 'internalServerError') return 'AI 算力不足，请稍后重试';
    return message || `API 错误：${code}`;
  } catch {
    return `API 错误：${body.slice(0, 200)}`;
  }
}

export class OpenAIImageProvider implements ImageProvider {
  private readonly generationUrl: string;
  private readonly editUrl: string;
  private readonly authHeader: Record<string, string>;
  private readonly model: string;

  constructor() {
    this.generationUrl = requireImageEnv('OPENAI_IMAGE_ENDPOINT');
    this.editUrl = buildEditUrl(this.generationUrl);
    const key = requireImageEnv('OPENAI_IMAGE_API_KEY');
    this.authHeader = key.startsWith('Bearer ')
      ? { Authorization: key }
      : { 'api-key': key };
    this.model = process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL;
  }

  async generate(req: GenerateRequest): Promise<ProviderResult> {
    const body = {
      prompt: req.prompt,
      n: 1,
      model: this.model,
      quality: DEFAULT_QUALITY,
      output_format: 'png',
    };

    const res = await fetch(this.generationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify(body),
    });

    const b64 = await this.extractB64(res);
    return { data: Buffer.from(b64, 'base64'), ext: 'png' };
  }

  async edit(req: EditRequest): Promise<ProviderResult> {
    if (!req.targetImage.length) {
      throw new Error('[OpenAIImageProvider] edit 必须携带非空目标图片字节');
    }

    const form = new FormData();
    form.append('image', new Blob([req.targetImage.buffer as ArrayBuffer], { type: 'image/png' }), 'image.png');
    form.append('prompt', req.prompt);
    form.append('n', '1');
    form.append('model', this.model);
    form.append('quality', DEFAULT_QUALITY);

    const res = await fetch(this.editUrl, {
      method: 'POST',
      headers: { ...this.authHeader },
      body: form,
    });

    const b64 = await this.extractB64(res);
    return { data: Buffer.from(b64, 'base64'), ext: 'png' };
  }

  private async extractB64(res: Response): Promise<string> {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(mapError(text));
    }
    const parsed = JSON.parse(text) as AzureImageResponse;
    const b64 = parsed.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('未生成图片，请尝试修改提示词');
    }
    return b64;
  }
}

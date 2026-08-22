/**
 * 图片生成与编辑工具。
 * execute 逻辑提取为独立函数，方便单元测试直接调用（不经过 Agent LLM）。
 */
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { ImageService } from './image-service.js';
import type { ImageVersion } from './types.js';
import { formatRef } from './image-service.js';

// ── 可测试的 execute 函数 ─────────────────────────────────

export async function executeGenerateImage(
  svc: ImageService,
  params: { prompt: string },
): Promise<string> {
  const { version, localPath, warning } = await svc.generateImage(params.prompt);
  const ref = formatRef(version.displayNo);
  let msg = `${ref}\n本地文件：${localPath ?? '（物化失败）'}`;
  if (warning) msg += `\n警告：${warning}`;
  return msg;
}

export async function executeEditImage(
  svc: ImageService,
  getCurrentTurnUploads: () => ImageVersion[],
  params: { reference: string; prompt: string },
): Promise<string> {
  const resolved = await svc.resolveReference(params.reference, getCurrentTurnUploads());
  if (!resolved.found) {
    return `无法确定目标图片：${resolved.message}`;
  }
  const target = resolved.version;
  const { version, localPath, warning } = await svc.editImage(target.id, params.prompt);
  const ref = formatRef(version.displayNo);
  const parentRef = formatRef(target.displayNo);
  let msg = `${ref}（基于 ${parentRef}）\n本地文件：${localPath ?? '（物化失败）'}`;
  if (warning) msg += `\n警告：${warning}`;
  return msg;
}

// ── Tool 工厂 ──────────────────────────────────────────────

/** 创建图片工具列表，绑定指定的 ImageService 和本轮上传图来源 */
export function createImageTools(
  svc: ImageService,
  getCurrentTurnUploads: () => ImageVersion[],
) {
  const generateImageTool = tool({
    name: 'generate_image',
    description:
      '根据文字描述生成一张新图片。用于"画一只猫"、"生成一张风景图"等从无到有的生图请求。' +
      '成功后返回 @img-N 编号和本机文件路径。',
    parameters: z.object({
      prompt: z.string().describe('图片生成指令，尽量详细描述期望的内容和风格'),
    }),
    execute: (params) => executeGenerateImage(svc, params),
  });

  const editImageTool = tool({
    name: 'edit_image',
    description:
      '对已有图片按照用户描述进行编辑。用于"把这张改成黑白"、"在 @img-2 上加一只鸟"等修改请求。' +
      '调用前必须明确 reference（目标图片指代），歧义时返回澄清提示，不要猜测。' +
      '成功后返回新版本的 @img-N 编号、父图编号和本机文件路径。',
    parameters: z.object({
      reference: z
        .string()
        .describe(
          '用户对目标图片的指代，如 "@img-2"、"这张图"、"刚才这张"、"上一张"、"第2张"',
        ),
      prompt: z.string().describe('编辑指令，描述要如何修改'),
    }),
    execute: (params) => executeEditImage(svc, getCurrentTurnUploads, params),
  });

  return [generateImageTool, editImageTool] as const;
}

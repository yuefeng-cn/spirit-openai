/**
 * 图片存储接口与本地文件实现。
 *
 * LocalImageStorage：用本地文件系统模拟 OSS，供测试和开发使用。
 * 真实 OSS 实现在 P5 阶段接入。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ImageStorage {
  /** 保存图片字节，返回 objectKey */
  save(data: Buffer, ext: string): Promise<string>;
  /** 按 objectKey 读取图片字节 */
  read(objectKey: string): Promise<Buffer>;
  /**
   * 将 objectKey 对应图片物化到本机 CLI 输出目录，返回绝对路径。
   * 路径结构：<outputDir>/<conversationId>/img-<displayNo>.<ext>
   * 不将路径写入数据库。
   */
  materialize(objectKey: string, conversationId: string, displayNo: number): Promise<string>;
}

export class LocalImageStorage implements ImageStorage {
  /**
   * @param storageDir  图片文件的权威存储目录（模拟 OSS）
   * @param outputDir   CLI 本机输出根目录（对应 IMAGE_OUTPUT_DIR）
   */
  constructor(
    private readonly storageDir: string,
    private readonly outputDir: string,
  ) {}

  async save(data: Buffer, ext: string): Promise<string> {
    await mkdir(this.storageDir, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(this.storageDir, key), data);
    return key;
  }

  async read(objectKey: string): Promise<Buffer> {
    return readFile(join(this.storageDir, objectKey));
  }

  async materialize(objectKey: string, conversationId: string, displayNo: number): Promise<string> {
    const ext = objectKey.split('.').pop() ?? 'png';
    const dir = join(this.outputDir, conversationId);
    await mkdir(dir, { recursive: true });
    const filepath = resolve(join(dir, `img-${displayNo}.${ext}`));
    await copyFile(join(this.storageDir, objectKey), filepath);
    return filepath;
  }
}

# P2：图片引用与核心

本阶段实现会话内图片登记、精确引用和图片上下文，不调用真实模型、不接 OSS。

## P2-01：实现会话图片读写

### 目标

在 `src/image/types.ts` 和 `src/persistence/conversation-repository.ts` 中实现最小 `ImageVersion` 读写：登记上传根图、创建生成根图、创建编辑子图、列出会话图片、读取指定图片、读取和更新活动图片。

### 约束

- `ImageVersion` 可表示 `upload` 或 `generated`，一张图片关联产生它的消息；
- 创建时为当前会话分配不可复用的 `displayNo`，显示格式为 `@img-N`；
- 一个版本只有一个可空 `parentVersionId`；从旧版本编辑自然形成分支，不计算分支头；
- `imageContext` 只含 `{ summary: string, preserve: string[] }`；
- 不实现多图融合、操作记录或复杂视觉规格。

### 验收

- 上传根图、生成根图、线性编辑和旧图分支均可保存；
- 所有读写拒绝跨会话版本；
- 数据库重连后可按 `@img-N` 读取版本。

```bash
npm test
npm run build
```

## P2-02：实现 `ImageService`

### 目标

新增 `src/image/image-service.ts`，集中完成：

- 登记本轮上传图片；
- 解析显式 `@img-N` / 版本 ID、“当前图”“刚才这张”“上一张”“第 N 张”；
- 本轮仅有一张上传图时，将“这张图 / 这张参考图”解析到该图；
- 管理活动图片；
- 新建图片上下文；
- 从父版本复制并更新 `summary`、`preserve`；
- 为编辑返回“相关普通对话 + 唯一目标图片 + 目标图片上下文 + 本轮要求”。

### 约束

- 歧义、无活动图或无法解析时直接返回需要澄清，禁止猜测；
- 对 Provider 的编辑输入必须包含唯一 `targetImageVersionId`，不得遗留图片代词；
- 新建图片不复制其他根图片的图片文件或 `imageContext`；
- 不拆分 Resolver、ContextBuilder、VisualSpecService。

### 验收

- 本轮上传图、此前上传图和生成图均可选择；
- “刚才这张”能解析为活动图；
- 两张以上候选时有明确的澄清结果；
- 新图和改图的上下文边界有单元测试。

```bash
npm test
```

## P2-03：实现最小图片命令

### 目标

实现：`/image list`、`/image use <@img-N>`、`/image clear`。

### 约束

- 列表显示当前会话图片的编号、来源（上传/生成）、父图和产生消息摘要；
- `/image clear` 只清空当前会话的活动图片，不删除版本和 OSS 文件；
- 不做 `tree`、`show`、`spec` 等调试命令。

### 验收

```bash
npm test
npm run build
```

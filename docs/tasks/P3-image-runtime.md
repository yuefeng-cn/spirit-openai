# P3：图片运行闭环

## P3-01：实现图片存储与 Mock Provider

### 目标

实现两个小接口：

- `ImageStorage`：保存图片、按 `objectKey` 读取图片、将结果物化为 CLI 可打开的本机文件、为真实 Provider 按需提供临时 URL 或文件；
- `ImageProvider`：`generate()`、`edit()`。

实现本地 `ImageStorage` 供测试，并实现 OSS `ImageStorage` 供真实运行；Provider 测试只使用本地实现。

### 约束

- Mock 必须离线、可重复；
- 不引入能力矩阵、输入物化器或通用路由；
- URL、Base64、二进制只在 Storage/Provider 内部流动；
- CLI 本机输出路径由 `IMAGE_OUTPUT_DIR/<conversationId>/img-<displayNo>.<ext>` 推导，不写入数据库；
- 本机输出文件和测试图片目录必须被 Git 忽略。

### 验收

```bash
npm test
```

## P3-02：实现上传、生成与编辑闭环

### 目标

让 `ImageService` 调用 Mock Provider，跑通：用户图片登记并保存 → 生成/编辑 → 保存结果 → 写入 `image_versions` → 更新活动图片 → 物化本机 CLI 输出文件。

### 约束

- 用户上传图也必须通过 Storage 保存后才写入图片版本；
- 编辑时必须从 Storage 读取已解析的目标图片，Mock Provider 断言实际收到该图片；
- Provider 失败时不写新版本；
- 写数据库失败时只记录可能的孤立文件，不做清理服务；
- 可选 `providerState` 失效时直接从目标图片重新编辑；
- 本机物化失败时必须向调用方返回可显示的警告，不能影响已成功保存到 OSS 的图片版本。

### 验收

- 上传图编辑、生成图连续编辑、旧图分支编辑均可用；
- 失败不改变活动图片；
- 图片二进制不进入数据库；
- 测试能证明 `@img-N` 被解析后对应文件实际传给 Provider；
- 测试能证明生成或编辑结果按约定路径物化，且数据库未保存本机路径。

```bash
npm test
npm run build
```

## P3-03：完成持久化端到端测试

### 目标

使用 PostgreSQL、本地 ImageStorage、Mock Provider 覆盖：上传参考图 → 编辑 → 生成 → 选择旧图编辑 → 退出/重建依赖 → 恢复会话 → 再编辑。

### 验收

```bash
npm test
```

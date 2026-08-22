# P0：基线

## P0-01：确认当前基线

### 目标

记录开始前的构建、测试和 Git 状态，不改业务代码。

### 验收

```bash
npm run build
npm test
git status --short
```

## P0-02：确定最小模块和配置

### 目标

只创建本计划第 7 节列出的目录约定，并准备 `.env.example`、`.gitignore` 的数据库、OSS、本地测试图片目录和 CLI 图片输出目录配置。

### 约束

- 不实现 Provider、数据库表或图片业务；
- 不引入新的框架；
- 本地测试图片目录和 `IMAGE_OUTPUT_DIR` 必须被 Git 忽略；
- 为 `IMAGE_OUTPUT_DIR` 提供项目内默认值；
- 真实密钥不得写入仓库。

### 验收

```bash
npm run build
npm test
```

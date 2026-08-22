# P5：首个真实 Provider

## P5-01：确认 Provider 输入与连续状态

### 目标

选择一个真实 Provider，查当日官方文档并记录：模型名、生成/编辑 API、单图输入方式、连续状态的传递方式、环境变量和错误格式。

明确区分：Provider 能否用连续状态续接、连续状态失效时如何以目标图回退、切换模型是否仍能续接。

第三方代理默认按无状态处理，除非文档和实测证明可续接。

### 验收

- 记录放在 `docs/decisions/`；
- 不记录密钥和签名 URL。

## P5-02：实现一个 Provider Adapter

### 目标

在 `src/image/providers/` 实现生成和编辑，内部自行处理 OSS URL、上传或 Base64。

### 约束

- 不修改 `ImageService` 的业务逻辑；
- 仅当目标图的 Provider / 模型兼容时使用 `providerState`；
- `providerState` 失效、跨模型或第三方代理不支持时，必须读取 OSS 目标图并重新提交编辑；
- 默认测试不访问网络。

### 验收

```bash
npm test
npm run build
```

## P5-03：手工验收

### 目标

验证：生成、两轮同模型编辑、从旧图编辑、重启 CLI 后恢复会话、Provider 状态失效后的图片重传回退，以及显式切换模型后的基于目标图编辑。

### 验收

记录真实限制和失败场景，不写入敏感请求数据。

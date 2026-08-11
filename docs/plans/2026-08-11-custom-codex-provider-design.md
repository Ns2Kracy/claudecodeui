# Custom Codex Provider 同步设计

## 目标

在“提供商路由”设置页提供“应用到 Codex”操作，将内置 9Router 的 OpenAI Responses 兼容配置永久写入用户的 `~/.codex/config.toml`。Codex provider 键和显示名固定为 `Custom`，但不改变用户当前的默认 provider 或模型。

## 行为

后端解析现有 Codex TOML，并合并以下受管理字段：

```toml
[model_providers.Custom]
name = "Custom"
base_url = "<9Router origin>/api/v1"
wire_api = "responses"
experimental_bearer_token = "<9Router data-plane key>"
```

同步操作不得写入或修改顶层 `model_provider`、`model`。重复同步更新上述字段，并保留其他顶层配置、其他 provider，以及 `model_providers.Custom` 中非本功能管理的字段。

## 架构与数据流

1. 设置页按钮调用新的受保护 routing mutation endpoint。
2. routing route 从已认证请求取得用户，并调用 routing service。
3. routing service 仅在内置 9Router runtime ready 时取得内部 origin 与数据面密钥。
4. 专用 Codex 配置写入器读取、解析、合并并原子替换 `~/.codex/config.toml`。
5. API 只返回成功状态和安全元数据，不返回数据面密钥。

Codex 配置文件写入属于 provider 模块；9Router 内部凭据仍由 routing 模块持有。通过注入窄接口连接二者，避免浏览器或共享 DTO 接触密钥。

## 文件安全

- 配置目录不存在时创建 `~/.codex`。
- 文件不存在时创建新配置。
- 现有 TOML 无法解析时拒绝写入，保留原文件。
- 在同目录写临时文件后 rename，避免部分写入。
- 尽可能限制新文件权限；不得在日志或 API 响应中输出 token。

## UI 与错误处理

按钮放在提供商路由设置页，runtime 未 ready 时禁用。提交期间显示 loading 并防止重复请求。成功后显示已应用反馈；失败沿用现有 routing typed error 呈现方式。

## 测试

- 新文件生成正确的 `model_providers.Custom`。
- 已有配置和未知 Custom 字段被保留。
- 受管理字段可重复更新。
- 顶层 `model_provider` 与 `model` 不变。
- 无效 TOML 不被覆盖。
- runtime unavailable 时不触碰文件。
- endpoint 受现有认证/变更保护，响应不含数据面密钥。
- UI 按钮状态、请求和反馈可验证。

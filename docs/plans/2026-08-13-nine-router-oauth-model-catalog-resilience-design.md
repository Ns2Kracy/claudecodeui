# 9Router OAuth 模型目录韧性设计

## 问题

Codex OAuth 的逐账户模型发现偶发超过 CloudCLI 固定的 10 秒响应头超时。当前模型聚合使用失败即整体失败的并发请求，并且设置页与聊天页无法共享正在进行或最近成功的结果。首次失败时，聊天页还会把硬编码的裸 `gpt-5.4` 显示为 `Provider unavailable`。

## 方案

在 routing service 内维护进程级、按账户的模型目录快照：

- 同一账户的并发刷新共享一个 pending promise。
- 新鲜快照直接复用，默认有效期 5 分钟。
- 快照过期后刷新；刷新失败时返回该账户最后一次成功的 stale 快照。
- 多账户独立结算；一个账户首次失败不丢弃其他成功账户的模型。只有所有 active 账户都失败且都没有旧快照时才返回错误。
- 账户、OAuth 或 provider node 变更后把快照标记为 stale，但保留 last-good 供瞬时失败兜底。
- 显式 hard refresh 绕过 freshness，但仍允许在刷新失败时使用 stale 数据。

前端只有在模型目录已经成功加载且明确缺少当前模型时，才追加 `(Provider unavailable)`。目录尚未首次加载成功时不制造伪 unavailable 选项。

## 安全与边界

缓存仅包含已净化的模型 DTO，不包含 cookie、OAuth token 或 API key。缓存不落盘，容器重启后重新发现。`/v1/models` 不作为目录来源，因为它包含未配置的静态别名模型。

## 验证

- 单元测试覆盖 pending 共享、stale fallback、账户级部分成功、hard refresh、变更失效和前端未加载状态。
- 运行 routing/provider/chat 目标测试、全量测试、typecheck、lint、build。
- 重建容器后对真实 Codex OAuth + DeepSeek 目录做并发与故障行为探测，并发送最小 qualified 模型请求。

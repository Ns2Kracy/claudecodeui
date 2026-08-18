# AgentOS 三层权限与 ZimaOS Bridge 技术方案

**状态：** Proposed（已按 Codex SDK 同容器约束修订）
**日期：** 2026-08-18
**目标平台：** ZimaOS / Linux + Docker
**默认权限：** L1 仅访问数据（`data_access`）

## 1. 摘要

CodexUI 当前已经具备 L1：Codex 通过 `@openai/codex-sdk` 在 CodexUI 容器内运行，能够访问挂载到 `/workspaces` 的 ZimaOS 数据，并由现有 Codex `permissionMode` 决定命令和文件修改是否需要确认。

因此，本方案不重做 L1，不增加独立 Agent Runner，也不把 Codex SDK 或 Codex CLI 拆到另一个容器。**Codex SDK、SDK 启动的 Codex CLI、CloudCLI Server 必须继续运行在同一个 CodexUI 容器内。**

一次安装包含三个服务：

1. **CodexUI 容器**：Web、鉴权、设置、Codex SDK、Codex CLI、Agent 编排和 AgentOS 工具网关。
2. **AgentOS Bridge 容器**：极小的 Go 特权侧车，唯一能够访问 Docker Engine 和 ZimaOS 宿主机系统层的组件。
3. **9Router 容器**：继续提供现有 Codex 认证、模型和请求路由。

Bridge 安装时获得未来执行 L2/L3 所需的底层能力，但默认策略为 L1。在 L1 下，Bridge 拒绝所有 Docker 和宿主机管理操作；CodexUI 保持现有文件和命令能力。用户之后只需在设置页面切换能力等级，无需 SSH、修改 Compose 或重新安装。

| 等级 | 产品名称 | 内部值 | 现有工作区数据 | Docker 应用 | ZimaOS 系统 |
| --- | --- | --- | ---: | ---: | ---: |
| L1 | 仅访问文件 | `data_access` | 允许 | 禁止 | 禁止 |
| L2 | 管理应用 | `app_management` | 允许 | 允许 | 禁止 |
| L3 | AgentOS 全面接管 | `agentos_full` | 允许 | 允许 | 允许 |

AgentOS 等级由 Bridge 独立持久化并在每次 L2/L3 操作时强制检查。Codex 不能修改等级、批准自己的操作或直接访问 Bridge 控制面。

---

## 2. 现状与不可变约束

### 2.1 当前 L1

生产部署目前把宿主机数据挂载到 CodexUI：

```
cloudcli:
  user: "0:0"
  environment:
    WORKSPACES_ROOT: /workspaces
  volumes:
    - "/DATA/AppData:/workspaces"
```

Codex runtime 使用：

```
import { Codex } from '@openai/codex-sdk';
```

OpenAI Codex SDK 会在当前容器内启动 Codex CLI，并通过 stdin/stdout 交换 JSONL 事件。现有权限模式映射为：

| CodexUI 设置 | Codex sandbox | approval policy |
| --- | --- | --- |
| `default` | `workspace-write` | `untrusted` |
| `acceptEdits` | `workspace-write` | `never` |
| `bypassPermissions` | `danger-full-access` | `never` |

所以现有产品已经可以：

- 读取和编辑 `/workspaces` 中的数据；
- 创建、移动和删除文件；
- 在项目目录运行 Git、构建、测试和其他命令；
- 通过 Codex permission 决定是否询问用户。

这就是 L1，不需要 Bridge 代理文件系统，也不需要 DataGrant、Workspace Runtime 或独立 Runner。

### 2.2 不可变部署约束

- CodexUI 必须继续使用 `@openai/codex-sdk`。
- Codex SDK 和它启动的 Codex CLI 必须与 CloudCLI Server 位于同一个 CodexUI 容器。
- 不引入每会话 Agent Runner 容器。
- 不迁移现有文件树、Git、worktree 和项目模块到 Bridge。
- L1 继续使用现有 `/workspaces` 挂载和 Codex permission。
- L2/L3 必须在设置中即时开关，不要求重建 CodexUI 容器。

### 2.3 当前缺口

现有 Codex permission 只回答：

> Codex 在当前容器已经拥有的能力范围内，执行操作前是否询问？

它不回答：

> CodexUI 容器能否管理 Docker 或 ZimaOS 宿主机？

如果把 Docker Socket、宿主机根目录或 host namespace 直接交给 CodexUI，`bypassPermissions` 下的 Codex CLI 就可能直接接管宿主机，完全绕过设置页面。因此 L2/L3 必须通过单独 Bridge 提供，不能通过扩大 CodexUI 容器权限实现。

---

## 3. 目标与非目标

### 3.1 产品目标

- 用户在 ZimaOS 中点击一次安装即可完成全部组件部署。
- 首次启动默认 L1，现有 CodexUI 使用方式不变。
- 设置页面可以即时切换 L1/L2/L3。
- 用户不需要理解 Docker Socket、host namespace、root 或 Compose。
- 高风险提示使用普通语言描述影响和恢复方式。
- Bridge 故障时保留 L1，L2/L3 安全关闭。

### 3.2 安全目标

- CodexUI 不挂载 Docker Socket、宿主机根目录，也不使用 host PID/network namespace。
- 只有 Bridge 持有 Docker 和宿主机底层权限。
- Codex CLI 虽与 Server 同容器，但以独立低权限 OS 用户运行。
- Codex CLI 看不到 Bridge 控制 Socket、Bridge 客户端密钥、owner assertion 和 CloudCLI 管理凭据。
- Codex 只能通过受限 Agent 工具平面请求 L2/L3 操作。
- Bridge 对每次操作独立执行等级、能力、参数、风险和审批检查。
- Codex 不能调用策略修改接口，也不能批准自己的操作。
- 降级权限时立即取消超出新等级的 Bridge 操作和批准请求。
- 容器和系统操作全部写入审计日志。

### 3.3 非目标与边界

第一版不做：

- 重写 L1 文件访问。
- 在设置中动态改变宿主机 bind mount；挂载范围仍由 ZimaOS 安装包决定。
- 独立 Agent Runner 容器。
- L3 完全自动驾驶；high/critical 操作必须逐次确认。
- 多节点 ZimaOS 集群管理。
- 抵御 Bridge 本身或 Docker daemon 已被完全控制的攻击者。

同容器约束意味着 Codex CLI 与 CloudCLI Server共享容器内核、网络和部分文件系统。独立 UID、Socket 权限、环境清理和 Bridge 二次鉴权是纵深防御，不等价于独立容器或虚拟机隔离。该限制必须明确记录，不能把同容器设计描述成强沙箱。

---

## 4. 两套权限的关系

Codex permission 与 AgentOS level 是两套正交机制：

```
AgentOS level
决定宿主机能力上限：数据 / Docker / ZimaOS
              ↓
Codex permission
决定 Codex 在已有能力范围内是否询问
              ↓
Bridge risk policy
对 L2/L3 的 high/critical 操作强制确认
```

示例：

| AgentOS level | Codex permission | 实际结果 |
| --- | --- | --- |
| L1 | `default` | 可操作 `/workspaces`，Codex 对不受信任命令询问 |
| L1 | `bypassPermissions` | 可自由操作 CodexUI 容器和挂载数据，但仍无 Docker/ZimaOS 能力 |
| L2 | `default` | 可通过 AgentOS 工具请求管理应用，Bridge 继续执行风险检查 |
| L2 | `bypassPermissions` | Codex 不询问容器内命令，但 Bridge 仍拒绝越权 Docker 配置 |
| L3 | `bypassPermissions` | 可请求系统管理，高风险操作仍必须由 owner 批准 |

AgentOS 设置不能修改或隐式覆盖 Codex permission；Codex permission 也不能提升 AgentOS level。

---

## 5. 核心设计决策

### 5.1 L1 沿用现有 CodexUI

L1 直接定义为当前部署能力：Codex SDK/CLI 在 CodexUI 容器内访问 `/workspaces`。Bridge 在 L1 只提供状态、能力发现和审计查询，不代理文件操作。

这避免：

- 重写文件树、Git、worktree 和项目模块；
- 引入 Workspace Runtime；
- 创建额外 Runner 镜像；
- 改变 Codex session 和 `~/.codex` 生命周期；
- 为已存在能力增加不必要的网络跳转。

### 5.2 使用独立特权 Bridge

Bridge 随应用编排安装和卸载，唯一持有：

- Docker Socket；
- 宿主机根目录挂载；
- 必要的 host PID/mount namespace；
- ZimaOS 系统管理能力。

CodexUI 永远不直接获得这些能力。

### 5.3 Codex SDK 保持同容器，但 CLI 子进程降权

OpenAI SDK 支持 `codexPathOverride` 和显式 `env`。CodexUI 使用固定 launcher 作为 SDK 的 CLI 路径：

```
new Codex({
  codexPathOverride: '/usr/local/bin/codex-launcher',
  env: sanitizedCodexEnvironment,
  // 现有 9Router baseUrl/apiKey/config 继续传入
});
```

`codex-launcher` 是只读镜像中的小型 Go/C 程序，只做以下固定操作：

1. 清理补充组；
2. 切换到固定 `codex` UID/GID；
3. 设置 `no_new_privs`；
4. 设置资源限制；
5. 关闭除 stdin/stdout/stderr 外的文件描述符；
6. 只保留白名单环境变量；
7. 执行镜像内固定路径的真实 Codex CLI。

launcher 不接受目标 UID、可执行文件路径或额外权限参数，避免被 Codex 反向利用。Codex 的工作区、`~/.codex` 和必要缓存目录归 `codex` 用户或共享工作组所有；Bridge 控制文件仅 CloudCLI Server 用户可读。

当前生产镜像以 root 运行。第一阶段可以由 root Server 安全地启动固定 launcher 并让 launcher 降权；后续应把 Server 改为非 root，并使用固定功能的 launcher/file capability 或容器 init 完成 UID 切换。无论哪种方式，真实 Codex CLI 启动后必须是低权限 UID。

### 5.4 控制平面与 Agent 工具平面分离

同容器内使用两个完全不同的调用平面：

#### 控制平面

```
Browser owner session
        ↓
CloudCLI AgentOS control API
        ↓  server-only credential
AgentOS Bridge control socket
```

可执行：等级修改、审批决定、紧急锁定、审计查询。Codex CLI 不可访问。

#### Agent 工具平面

```
Codex CLI
   ↓ built-in AgentOS MCP tools
CloudCLI Agent Tool Gateway
   ↓ server signs operation request
AgentOS Bridge operation API
```

只允许提交当前等级开放的类型化操作。工具令牌是短期、会话绑定、不可用于控制平面。即使 Codex 绕过 MCP UI 直接调用工具网关，它也只能获得与 MCP 相同的 operation 权限，不能改等级或批准操作。

### 5.5 Bridge 是最终策略执行点

CloudCLI 可以提前隐藏或拒绝操作，但最终授权始终由 Bridge 决定。Bridge 独立持久化：

- 当前 AgentOS level；
- 策略版本；
- 审批策略；
- 待审批请求；
- 运行中 operation；
- 审计事件；
- 安装身份和 CloudCLI 客户端身份。

Agent 请求不能携带可信的 level、risk 或 approval 结果；这些值由 Bridge 根据 operation 类型和自身状态计算。

### 5.6 L1/L2 不开放任意宿主机 Shell

- L1 不提供 Bridge operation。
- L2 只提供类型化 Docker/应用操作。
- L3 优先提供类型化系统操作，未覆盖能力才进入受批准的系统执行计划。

Bridge 不提供通用 `/exec` 或原始 Docker API 代理。

---

## 6. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│ 设置、owner 再认证、审批、审计                              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│ CodexUI 容器                                                │
│                                                            │
│  CloudCLI Server（高信任进程）                              │
│  - Web/API/Auth                                             │
│  - AgentOS Control API ───────────────┐                     │
│  - Agent Tool Gateway                 │                     │
│  - @openai/codex-sdk                  │                     │
│                │ spawn                │ server-only UDS     │
│                ▼                      │ + signed requests   │
│  Codex CLI（低权限 codex UID）        │                     │
│  - 访问 /workspaces                   │                     │
│  - 访问 Agent 工具平面                │                     │
│  - 看不到 Bridge 控制凭据             │                     │
└───────────────────────────────────────┼─────────────────────┘
                                        │
┌───────────────────────────────────────▼─────────────────────┐
│ AgentOS Bridge 容器（Go，唯一特权组件）                     │
│ - Auth / Policy / Approval / Audit                          │
│ - Docker Adapter / ZimaOS Adapter / System Executor         │
└──────────────────┬───────────────────────────┬───────────────┘
                   │ Docker Socket             │ host root/ns
             ┌─────▼──────┐              ┌─────▼────────┐
             │ Docker     │              │ ZimaOS Host  │
             │ apps       │              │ system       │
             └────────────┘              └──────────────┘
```

### 6.1 信任边界

| 组件 | 信任级别 | 可拥有的最高权限 |
| --- | --- | --- |
| Browser UI | 不可信输入 | 无；通过 Server API 请求 |
| Prompt / 项目 / MCP 输入 | 不可信 | 只能影响 Codex 和 Agent operation 请求 |
| Codex CLI | 低信任 | CodexUI 容器内低权限 UID、`/workspaces`、Agent 工具平面 |
| CloudCLI Server | 应用信任 | 调用 Bridge；不能直接操作 Docker/宿主机 |
| AgentOS Bridge | 高信任 | Docker 和宿主机管理能力 |
| Docker / ZimaOS | 根信任 | 系统本身 |

同容器不等于同权限：真实安全边界依赖 Linux UID、文件权限、Socket 权限、环境变量白名单和 Bridge 鉴权共同实现。

---

## 7. 三层能力模型

### 7.1 L1：仅访问文件（默认，现有能力）

L1 不通过 Bridge 执行文件操作。CodexUI 继续：

- 将 ZimaOS `/DATA/AppData` 挂载为 `/workspaces`；
- 使用现有文件树、Git、worktree、Shell 和项目能力；
- 使用现有 Codex `permissionMode`；
- 保存现有 `~/.codex` session 和配置。

L1 明确禁止：

- CodexUI 挂载 Docker Socket；
- CodexUI 挂载宿主机 `/`、`/etc`、`/proc`、`/sys` 或 `/dev`；
- Bridge 执行任何容器或系统 operation；
- Agent 修改 AgentOS level。

`bypassPermissions` 只代表 Codex 在 CodexUI 容器内使用 `danger-full-access`，不获得 Bridge 能力。

L1 设置页第一版不提供任意宿主机目录选择，因为 Docker bind mount 不能在不重建容器的情况下动态改变。页面可以展示实际挂载范围 `/workspaces`，未来如需目录级授权，应作为独立功能设计，不能假装一个 UI 开关改变了 Docker 挂载。

### 7.2 L2：管理应用

包含 L1，并开放以下 Bridge operation：

```
container.list
container.inspect
container.logs
container.start
container.stop
container.restart
container.update
image.list
image.pull
app.list
app.install
app.update
app.uninstall
```

Bridge 必须拒绝：

- `privileged: true`；
- host PID/IPC/user namespace；
- 未经明确策略允许的 host network；
- 挂载宿主机 `/`、`/etc`、`/proc`、`/sys`、`/dev`；
- 挂载 Docker Socket、Bridge 状态目录或 Bridge Socket；
- 注入设备节点；
- 增加危险 Linux capabilities；
- 透传任意 Docker Create/Exec 参数；
- 在任意容器中执行未经类型和权限限制的 root shell。

Compose 输入先解析成结构化模型，再逐项校验。Bridge 不把 Docker API 原样代理给 CloudCLI 或 Codex。

### 7.3 L3：AgentOS 全面接管

包含 L1、L2，并开放：

```
system.status
system.services.list
system.services.restart
system.network.inspect
system.network.configure
system.storage.inspect
system.storage.mount
system.packages.install
system.power.reboot
system.power.shutdown
system.plan.execute
```

优先调用类型化 System Adapter。只有未被类型化能力覆盖的任务才进入 `system.plan.execute`。

```
type SystemExecutionPlan = {
  summary: string;
  reason: string;
  risk: 'medium' | 'high' | 'critical';
  expectedImpact: string;
  commands: Array<{
    argv: string[];
    cwd?: string;
    timeoutSeconds: number;
  }>;
  backups: Array<{ source: string; destination: string }>;
  healthChecks: Array<{ argv: string[]; timeoutSeconds: number }>;
  rollback?: Array<{ argv: string[]; timeoutSeconds: number }>;
};
```

Bridge 对命令、参数、环境变量、cwd、超时、并发和输出大小设置上限。审批与完整 plan hash 绑定；批准后任何字段变化都会使批准失效。

---

## 8. 风险与审批

AgentOS level 决定“有没有该能力”，风险策略决定“执行前是否必须由人确认”。

| 风险 | 示例 | 默认行为 |
| --- | --- | --- |
| `low` | 列出容器、查看日志、读取系统状态 | 当前等级允许时自动执行并审计 |
| `medium` | 重启普通容器、拉取镜像、安装普通应用 | 默认自动执行；用户可配置为确认 |
| `high` | 删除应用、修改网络、重启系统服务 | 必须 owner 确认 |
| `critical` | 格式化磁盘、关机、修改 SSH/防火墙、系统执行计划 | 必须 owner 再认证并逐次确认 |

流程：

1. Codex 通过 AgentOS MCP 工具提交 operation。
2. Tool Gateway 验证会话令牌并附加可信 actor/session 信息。
3. Bridge 验证 CloudCLI 客户端签名、当前 level 和 operation 参数。
4. Bridge 计算风险；需要审批时返回一次性 challenge，不执行操作。
5. CloudCLI 通过 WebSocket 向 owner 展示影响、备份和回滚信息。
6. owner 批准；critical 操作要求短期再认证。
7. CloudCLI 通过控制平面提交 approval。
8. Bridge 校验 challenge、operation hash、owner assertion、时效和 nonce。
9. Bridge 执行、健康检查、必要时回滚，并记录审计。

Codex 的 Agent 工具令牌没有 approval scope。Codex permission 为 `bypassPermissions` 时也不能跳过 Bridge 审批。

第一版不提供“永不询问所有系统操作”。Bridge 自修改、关闭审计、身份认证变更、磁盘破坏性操作始终不可跳过确认。

---

## 9. 同容器进程隔离

### 9.1 用户与目录

建议容器内用户：

```
cloudcli-server  UID 10000  CloudCLI Server
codex            UID 10001  Codex CLI 和它启动的项目命令
```

目录权限：

| 路径 | owner/mode | Codex 是否可访问 |
| --- | --- | ---: |
| `/workspaces` | `codex:workspace` | 是 |
| `/home/codex/.codex` | `codex:codex 0700` | 是 |
| `/run/agentos/control.sock` | `cloudcli-server 0600` | 否 |
| `/run/agentos/client.key` | `cloudcli-server 0600` | 否 |
| `/run/cloudcli/agent-tools.sock` | `cloudcli-server:codex 0660` | 是，仅 Agent operation |
| 应用代码和 launcher | root-owned, read-only | 只读 |

CodexUI 容器 rootfs 应设为只读，运行时写目录使用明确 volume/tmpfs。这样 Codex 不能替换 launcher、Server 代码或真实 Codex 二进制。

### 9.2 SDK 环境白名单

Codex SDK 默认继承 Node 进程环境。必须改成显式 `env`，只传：

- PATH/HOME/LANG/TMPDIR；
- 9Router/Codex 运行所需的短期凭据；
- 当前 session 的 Agent 工具令牌；
- 必要代理和证书变量。

不得传：

- Bridge 客户端密钥；
- owner assertion；
- CloudCLI JWT secret；
- 数据库凭据；
- 9Router 管理密码；
- 其他服务端 secret。

### 9.3 文件描述符与进程边界

launcher 执行 Codex 前关闭继承的非标准文件描述符。CloudCLI 不长期打开 Bridge secret 文件，不把 Bridge Socket FD 传给子进程。Codex UID 不加入 Server 或 Bridge 控制组。

### 9.4 网络边界

Codex CLI 与 Server 同容器，共享网络 namespace，因此不能把“localhost 不可访问”当成安全边界。所有 CloudCLI 管理 API 仍需用户认证；Agent 工具端点使用独立会话令牌和 operation-only scope。

Bridge 不在 Docker 网络暴露 TCP 端口，只监听 Unix Socket。Codex UID 即使能扫描本容器或私有网络，也无法连接 Bridge 控制 Socket。

### 9.5 安全限制

UID 隔离防止正常的 Codex 命令直接读取 Server-only 文件和 Socket，但不防御 Linux 内核漏洞、Server 进程 RCE 或容器逃逸。如果 CloudCLI Server 被完全攻陷，攻击者可能使用 Server 的 Bridge 客户端身份请求当前 level 允许的 operation；Bridge 的独立策略、不可自批和 owner 再认证用于限制影响，但不能消除这一风险。

---

## 10. Bridge 内部设计

建议目录：

```
bridge/
├── cmd/agentos-bridge/
├── internal/api/
├── internal/auth/
├── internal/policy/
├── internal/approval/
├── internal/audit/
├── internal/operations/
├── internal/docker/
├── internal/system/
├── internal/zimaos/
└── internal/recovery/
```

### 10.1 技术栈

- Go 稳定版本；
- 单一静态二进制；
- 标准库 HTTP Server + Unix Domain Socket；
- Docker 官方 Go Client；
- SQLite 保存策略、operation、approval 和 audit；
- JSON 运行日志输出到 stdout；
- distroless/scratch 镜像，不包含包管理器和交互 shell；
- amd64 和 arm64 多架构构建。

### 10.2 模块职责

#### Auth

验证 CloudCLI 客户端签名、时间戳、nonce、body hash 和幂等键。区分 control request 与 agent operation request。

#### Policy Engine

根据 Bridge 自身保存的 level、operation kind、参数和风险输出 `allow`、`deny` 或 `approval_required`。不执行动态策略脚本。

#### Approval Engine

生成短期、一次性、绑定 operation hash 的 challenge；验证 owner assertion，处理批准、拒绝、过期和取消。

#### Operation Dispatcher

只接收鉴别联合类型，将 operation 分发到 Docker 或 System Adapter。未知 operation 一律拒绝。

#### Docker Adapter

实现 L2 类型化操作和 Compose 校验，不允许上层透传原始 Docker 请求。

#### ZimaOS/System Adapter

优先使用 ZimaOS 稳定本地 API；不可用时使用受控 Linux host namespace/chroot 适配器。Bridge 通过 capability discovery 报告设备实际支持项。

#### Audit Store

记录 actor、策略版本、operation、审批者、结果、耗时、健康检查和回滚。不得记录密钥、完整环境变量或用户文件内容。

---

## 11. 通信、身份与密钥

### 11.1 Bridge 传输

CodexUI Server 与 Bridge 通过共享运行卷中的 Unix Socket 通信：

```
/run/agentos/control.sock
```

Bridge 不声明公网或局域网端口。Socket 在 CodexUI 容器内仅 `cloudcli-server` 用户可访问。

### 11.2 自动配对

1. Bridge 首次启动生成 installation ID、服务密钥和一次性 bootstrap token。
2. token 写入临时共享配对目录，权限为 `0600`。
3. CloudCLI Server 读取 token，生成客户端身份并注册。
4. 双方保存请求签名凭据。
5. bootstrap token 立即删除并标记已消费。
6. 后续请求包含 client ID、时间戳、nonce、body hash 和 HMAC。

密钥不写入镜像、Compose、环境变量或日志。

### 11.3 Agent 工具令牌

CloudCLI 为每个活跃 Codex session 签发短期令牌：

```
type AgentToolTokenClaims = {
  purpose: 'agentos-operation';
  sessionId: string;
  userId: number;
  expiresAt: number;
  nonce: string;
};
```

该令牌只能提交 operation，不能：

- 读取 Bridge 客户端密钥；
- 修改 level；
- 修改审批策略；
- 批准 operation；
- 读取其他用户的审计；
- 调用 emergency unlock。

CloudCLI Tool Gateway 不信任 Agent 提交的 userId、sessionId、level 或 risk，而是从已验证 token 和服务端 session 状态生成。

### 11.4 Owner 再认证

需要设备角色：

```
type DeviceRole = 'owner' | 'member';
```

- 首个完成初始化的用户成为 owner；
- 只有 owner 能修改 AgentOS level 和审批策略；
- 开启 L2/L3 需要最近一次密码再认证；
- critical approval 也需要短期再认证；
- Auth 模块签发有效期不超过 5 分钟、用途固定的 owner assertion；
- Bridge 不接受普通登录 JWT 作为 owner assertion。

---

## 12. API 设计

### 12.1 CloudCLI 对浏览器的控制 API

新增：

```
server/modules/agentos/
├── agentos.module.ts
├── agentos.routes.ts
├── agentos.service.ts
├── agentos-bridge.client.ts
├── services/
├── tests/
└── index.ts
```

公共控制 API：

```
GET  /api/agentos/status
GET  /api/agentos/policy
PUT  /api/agentos/policy/level
GET  /api/agentos/capabilities
GET  /api/agentos/approvals
POST /api/agentos/approvals/:id/decision
GET  /api/agentos/operations/:id
GET  /api/agentos/audit
POST /api/agentos/emergency-lockdown
```

路由只解析、验证输入和格式化响应。owner 授权、再认证、Bridge 调用和状态转换由 service 完成。

统一错误：

```json
{
  "success": false,
  "error": {
    "code": "AGENTOS_APPROVAL_REQUIRED",
    "message": "停止此应用需要你的确认。",
    "requestId": "req_...",
    "details": {}
  }
}
```

### 12.2 Codex Agent 工具 API

Codex 通过内建 AgentOS MCP tools 使用：

```
agentos_status
container_list
container_logs
container_start
container_stop
container_restart
container_update
app_install
app_update
app_uninstall
system_status
system_service_restart
system_network_configure
system_storage_mount
system_package_install
system_reboot
system_shutdown
system_execute_plan
```

MCP adapter 调用本容器 Agent Tool Gateway：

```
POST /internal/agentos/operations
GET  /internal/agentos/operations/:id
POST /internal/agentos/operations/:id/cancel
```

这些端点只接受 `AgentToolToken`，不接受浏览器 JWT，也不提供 level/approval 管理接口。

### 12.3 CloudCLI 到 Bridge

Bridge API 使用 `/v1`：

```
GET  /v1/health
GET  /v1/status
GET  /v1/capabilities
GET  /v1/policy
PUT  /v1/policy/level
POST /v1/operations
GET  /v1/operations/:id
POST /v1/operations/:id/cancel
POST /v1/approvals/:id/decision
GET  /v1/audit
POST /v1/emergency-lockdown
```

operation 是鉴别联合类型：

```json
{
  "requestId": "req_01...",
  "idempotencyKey": "idem_01...",
  "actor": {
    "type": "agent",
    "sessionId": "ses_01...",
    "userId": 1
  },
  "operation": {
    "kind": "container.restart",
    "containerId": "..."
  }
}
```

Bridge 不信任客户端传入的 level/risk。所有有副作用请求必须有幂等键。

### 12.4 协议版本

```
type BridgeStatus = {
  protocolVersion: '1';
  bridgeVersion: string;
  installationId: string;
  platform: 'zimaos' | 'linux' | 'unknown';
  level: 'data_access' | 'app_management' | 'agentos_full';
  health: 'ready' | 'degraded' | 'locked';
  supportedCapabilities: string[];
};
```

协议不兼容时 L2/L3 fail closed，但现有 L1 文件能力继续可用。

---

## 13. 设置页面

新增顶级设置页“AgentOS”或“设备权限”，与 Codex permission 页面分开。

页面包含：

1. **当前状态**：Bridge 在线状态、ZimaOS 设备、版本和锁定状态。
2. **能力等级**：L1/L2/L3 三张单选卡片，默认 L1。
3. **数据范围**：只读展示当前容器实际挂载的 `/workspaces`；第一版不提供虚假的动态宿主机目录授权。
4. **操作确认**：展示 Bridge 的风险规则。
5. **待审批操作**：影响、原因、备份、回滚、“允许一次/拒绝”。
6. **操作记录**：actor、时间、operation、目标和结果。
7. **紧急锁定**：立即降至 L1 并取消高权限操作。

开启 L2/L3：

- 展示新增能力；
- 要求 owner 再认证；
- 调用 Bridge control API；
- 读取 Bridge 返回状态确认真正生效；
- 不仅在前端本地保存选项。

降低等级无需密码并立即生效。

---

## 14. 一步安装与编排

概念编排：

```
services:
  cloudcli:
    image: ns2kracy/cloudcli:<version>
    restart: unless-stopped
    environment:
      HOST: 0.0.0.0
      SERVER_PORT: "3001"
      WORKSPACES_ROOT: /workspaces
      AGENTOS_BRIDGE_SOCKET: /run/agentos/control.sock
    volumes:
      - "/DATA/AppData:/workspaces"
      - "/DATA/AppData/${AppID}/.cloudcli:/root/.cloudcli"
      - "/DATA/AppData/${AppID}/.codex:/home/codex/.codex"
      - agentos-runtime:/run/agentos
      - agentos-bootstrap:/run/agentos-bootstrap
    depends_on:
      agentos-bridge:
        condition: service_healthy
      9router:
        condition: service_started

  agentos-bridge:
    image: ns2kracy/agentos-bridge:<version>
    restart: unless-stopped
    privileged: true
    pid: host
    read_only: true
    volumes:
      - /:/host:rshared
      - /var/run/docker.sock:/var/run/docker.sock
      - agentos-bridge-state:/var/lib/agentos
      - agentos-runtime:/run/agentos
      - agentos-bootstrap:/run/agentos-bootstrap
    tmpfs:
      - /tmp
      - /run/bridge-tmp

  9router:
    image: decolua/9router:<pinned-version>
```

这是概念编排，实施时必须验证 ZimaOS 对以下字段的支持：

- `privileged`；
- `pid: host`；
- `/` 的 bind propagation；
- Docker Socket 路径；
- health condition；
- amd64/arm64；
- ZimaOS 本地系统 API 和服务管理方式。

安装流程：

1. 用户点击安装。
2. ZimaOS 创建 CodexUI、Bridge、9Router 和持久卷。
3. Bridge 默认写入 `data_access`。
4. CloudCLI Server 自动完成一次性配对。
5. CloudCLI 检查 Codex launcher 的 UID 降权和 Socket 权限。
6. Bridge 健康检查通过后设置页显示在线；即使 Bridge 暂时不可用，L1 仍可使用。
7. 用户正常使用现有 CodexUI，无额外配置。

为什么 Bridge 安装时需要预先获得特权：Docker 无法让普通容器通过应用设置动态获得新的 host namespace 和宿主机挂载。若要以后在设置中即时开启 L3，Bridge 必须首次安装时就具备底层能力；默认安全性由 Bridge 的 L1 策略保证。

---

## 15. 持久化

Bridge 数据库：

```
installation
bridge_clients
policy
policy_history
approval_requests
operation_executions
audit_events
idempotency_keys
schema_migrations
```

约束：

- policy 更新同时写 policy history；
- 权限修改使用事务；
- audit 使用递增序列和前一事件哈希；
- Agent operation 不能删除审计；
- Bridge 重启后把未完成 operation 标为 `interrupted`，可恢复的任务按策略恢复；
- 过期 nonce、challenge 和幂等键定期清理；
- 升级不能扩大当前授权等级。

CloudCLI 可以缓存 Bridge 状态用于 UI，但缓存不能授予权限。

---

## 16. 错误处理和降级

### Bridge 不可用

- L1 文件、Git、Shell 和 Codex 会话继续使用；
- L2/L3 工具返回 `AGENTOS_BRIDGE_UNAVAILABLE`；
- 不回退到 Docker Socket或本地宿主机 shell；
- 设置页显示可理解的诊断和重试。

### 策略损坏

Bridge 进入 `locked`，拒绝所有 L2/L3 有副作用 operation；不能默认恢复 L3。L1 仍由 CodexUI 挂载提供。

### 权限降低

从 L3/L2 降到 L1：

1. 原子写入新策略；
2. 撤销超出 L1 的 pending approval；
3. 取消正在执行且可安全中止的高权限 operation；
4. 阻止新 L2/L3 operation；
5. 记录审计并广播状态变化。

不强制终止普通 Codex 会话，因为 Codex 的 L1 数据能力不依赖 Bridge。

### 长时间操作

```
queued → awaiting_approval → running → succeeded
                                  └→ failed
                                  └→ cancelled
                                  └→ interrupted
                                  └→ rolled_back
```

前端通过 WebSocket 接收进度，并能在刷新后通过 operation ID 恢复查看。

---

## 17. 备份、回滚和审计

高风险系统操作执行前：

- 备份即将修改的配置；
- 记录原服务、网络或容器状态；
- 验证备份可读；
- 执行后运行健康检查；
- 健康检查失败且回滚安全时自动回滚。

磁盘格式化、数据删除、固件/内核升级和关机中断等操作不能承诺自动回滚，UI 必须明确说明。

审计记录：

- request/operation ID；
- actor 类型、user ID、Codex session ID；
- level 和 policy version；
- operation kind 和目标；
- 风险、策略结果和原因；
- approval 及批准者；
- 执行时间、结果、健康检查和回滚。

不得记录密码、JWT、HMAC secret、OAuth token、完整环境变量和用户文件内容。

---

## 18. 更新策略

兼容矩阵：

```
CodexUI 1.x  → Bridge protocol v1
```

没有单独 Runner 协议或 Runner 镜像。

要求：

- 镜像固定版本，不使用 `latest`；
- Bridge 支持 amd64/arm64；
- 镜像签名并生成 SBOM；
- Codex launcher 和真实 CLI 位于只读镜像层；
- 更新前检查 Bridge 协议兼容；
- Bridge 更新失败保留旧容器和状态卷；
- 更新不改变当前 level；
- 新能力默认关闭。

---

## 19. 实施阶段

### Phase 0：确认现有 L1 基线

- 把现有 `/workspaces` + Codex permission 正式定义为 L1。
- 增加回归测试，证明 L1 不需要 Bridge 即可继续工作。
- 确认 Codex SDK 和 CLI 继续在 CodexUI 容器内运行。
- 文档和 UI 明确区分 Codex permission 与 AgentOS level。

### Phase 1：Bridge 基础和同容器进程隔离

- 建立 Go Bridge、协议、健康检查、SQLite、策略和审计。
- 增加 Unix Socket 和自动配对。
- 增加 `server/modules/agentos/` Bridge Client。
- 实现固定 `codex-launcher`，让 SDK 启动的真实 Codex CLI 使用低权限 UID。
- 给 Codex SDK 配置显式环境白名单。
- 建立 Server-only Bridge 控制 Socket 权限。
- 建立 operation-only Agent Tool Gateway 和短期 session token。
- 默认 Bridge level 为 `data_access`，所有 L2/L3 operation 拒绝。

### Phase 2：L2 应用管理

- 实现类型化 Docker Adapter。
- 实现危险 Docker 配置拒绝矩阵。
- 实现容器、日志、镜像、应用生命周期和 Compose 校验。
- 注册 AgentOS MCP tools。
- 增加 L2 设置、owner 再认证、approval 和审计。
- 验证 Codex 无法直接读取 Bridge Socket 或创建越权容器。

### Phase 3：L3 系统管理

- 实现 ZimaOS capability discovery。
- 实现服务、网络、存储、软件包和电源适配器。
- 实现 SystemExecutionPlan、备份、健康检查和回滚。
- 增加 critical 再认证和不可跳过审批。
- 在受控 ZimaOS 测试机进行恢复演练。

### Phase 4：产品化

- 完成 ZimaOS 一键安装包和多架构镜像。
- 完成升级、锁定、诊断、审计导出和卸载。
- 完成安全审计、镜像扫描和故障注入。
- 发布顺序：L1 保持稳定，L2 opt-in，L3 初期标记高级/实验能力。

---

## 20. 测试方案

### 20.1 Bridge 单元测试

- level × capability × risk 策略矩阵；
- Agent request 不能修改 level/risk/actor；
- approval 过期、重放、篡改和一次性消费；
- HMAC 时间窗、nonce 和 body hash；
- Docker 危险参数拒绝；
- policy 数据库迁移和损坏恢复；
- audit hash chain；
- idempotency 重试。

```
go test -race ./...
go vet ./...
golangci-lint run
```

### 20.2 CodexUI 后端测试

- AgentOS 路由边界输入校验；
- owner/member 授权和再认证；
- Agent token 无 control/approval scope；
- Bridge 错误映射；
- Bridge 不可用时 L1 继续、L2/L3 fail closed；
- level 降级取消高权限 operation；
- 模块 barrel 和跨模块导入；
- 现有 Codex session、文件、Git 和 Shell 回归。

### 20.3 SDK/进程隔离测试

- SDK 仍使用 `@openai/codex-sdk`；
- SDK 和 Codex CLI 位于同一 CodexUI 容器；
- SDK 通过 `codexPathOverride` 启动固定 launcher；
- 真实 Codex CLI UID 与 Server UID 不同；
- Codex 环境中不存在 Bridge/JWT/owner secret；
- Codex 不能读取 `/run/agentos/control.sock` 和 client key；
- Codex 不能替换 launcher 或应用代码；
- `bypassPermissions` 也不能直接连接 Bridge；
- Agent Tool Token 只能提交 operation，不能批准或提权。

### 20.4 前端测试

- 默认显示 L1；
- L1 页面反映现有 `/workspaces` 能力；
- AgentOS level 与 Codex permission 分开展示；
- 开启 L2/L3 需要再认证；
- 降级无需密码且立即刷新；
- approval 的批准、拒绝、过期和失败；
- Bridge 离线时 L1 可用状态；
- 可访问性和移动端布局。

### 20.5 ZimaOS 集成与攻击测试

- CodexUI 没有 Docker Socket、host root 或 host namespace；
- Bridge 没有外部监听端口；
- L1 无法列出或控制宿主机容器；
- L2 不能创建 privileged/host namespace/危险 mount 容器；
- L2 不能修改宿主机 `/etc`；
- L3 high/critical 未批准不执行；
- Codex 不能批准自身 operation；
- 权限降低阻止新高权限请求并取消可中止 operation；
- 杀死 CloudCLI、Bridge 或 Docker daemon 后状态正确恢复；
- 审计库损坏时 Bridge 锁定而不是恢复 L3。

---

## 21. 验收标准

### 一步安装

- 用户只点击一次安装。
- CodexUI、Bridge 和 9Router 自动启动、配对和健康检查。
- 不需要 SSH、终端命令或手工密钥。

### L1

- 新安装默认 `data_access`。
- 现有 `/workspaces`、文件树、Git、Shell、worktree 和 Codex session 行为不回归。
- Codex SDK 和 CLI 保持在 CodexUI 同一容器。
- CodexUI 看不到 Docker Socket 和宿主机根目录。
- Bridge 不可用时 L1 仍可使用。

### 同容器安全边界

- Codex CLI 使用与 Server 不同的低权限 UID。
- Codex CLI 无法读取 Bridge 控制 Socket、客户端密钥和 owner assertion。
- Agent 工具令牌无法修改 level 或提交 approval。
- `bypassPermissions` 无法绕过 Bridge。

### L2

- 设置中开启后无需重建容器即可管理普通应用。
- 原始 Docker API 不暴露给 Codex。
- 越权 Docker 参数被拒绝并审计。
- L2 不能进入宿主机系统层。

### L3

- 开启需要 owner 再认证。
- 系统适配器可以完成受支持的 ZimaOS 管理操作。
- high/critical 未逐次批准不能执行。
- 支持回滚的操作在健康检查失败时回滚。

### 通用

- 降级即时生效且不终止普通 L1 Codex 会话。
- Agent 不能修改 level 或批准自身请求。
- Bridge 策略损坏时 fail closed。
- 每次 L2/L3 敏感操作都有审计记录。
- 目标测试、typecheck、lint、build 和 ZimaOS 运行探针通过。

---

## 22. 被否决的方案

### 22.1 独立 Agent Runner 容器

与明确约束冲突：CodexUI 使用 Codex SDK，并要求 SDK/CLI 与应用位于同一容器。它还会重复实现已有 L1、增加 session/文件/工具链迁移成本。否决。

### 22.2 Bridge 代理 L1 文件系统

现有 CodexUI 已具备 L1。DataGrant、Workspace Runtime 和安全文件 API会重做文件树、Git、worktree 和 Shell。第一版无必要。否决。

### 22.3 直接把 CodexUI 设为 privileged

Web、Server、Codex CLI 与宿主机 root 共处一个权限域，任何 Agent 命令都可能绕过设置和审批。否决。

### 22.4 给 CodexUI 挂载 Docker Socket

Docker Socket 近似宿主机 root，L2 可以轻易绕过为 L3。否决。

### 22.5 Bridge 暴露原始 Docker API 或通用 root shell

无法可靠限制 L2，也无法对操作做稳定风险分类和审计。否决。

### 22.6 只在前端保存 level

前端不是安全边界。level 必须由 Bridge 持久化和执行。否决。

### 22.7 手工安装宿主机 Daemon

隔离更强，但破坏一步安装。当前使用随 ZimaOS 应用安装的 Bridge 侧车；未来可作为企业部署选项重新评估。

---

## 23. 已确定事项

- 当前 CodexUI 文件和命令能力就是 L1。
- 不重做 L1，不引入 DataGrant/Workspace Runtime。
- Codex SDK 和 Codex CLI 必须与 CloudCLI Server 位于同一 CodexUI 容器。
- 不引入独立 Agent Runner 容器。
- 使用独立 Go Bridge 提供 L2/L3。
- Codex CLI 在同容器内使用独立低权限 UID。
- 控制平面和 Agent operation 平面分离。
- CodexUI 不挂载 Docker Socket和宿主机根目录。
- Bridge 是最终策略执行点。
- L1/L2 不开放任意宿主机 shell。
- 第一版 L3 high/critical 逐次确认，不提供完全自动驾驶。
- 一个 ZimaOS 应用包一次安装。

实施前需验证：

- ZimaOS 对 Bridge 特权字段的支持；
- ZimaOS 本地管理 API；
- CodexUI 镜像内 launcher 的 UID/GID、file capability 和 rootfs 只读方案；
- 当前 Codex SDK 版本的 `codexPathOverride`、显式 `env` 和升级兼容；
- amd64/arm64 架构；
- 现有 `/root/.codex` 到 `/home/codex/.codex` 的无损迁移方案。

---

## 24. 结论

修正后的架构是：

> **Codex SDK/CLI 与 CloudCLI Server 保持在同一个 CodexUI 容器；现有能力直接作为 L1；独立特权 AgentOS Bridge 只增加 L2/L3。**

同容器内不再追求不存在的 Runner 隔离，而是通过固定 launcher、独立低权限 UID、环境白名单、Server-only Bridge Socket、operation-only Agent Tool Gateway 和 Bridge 二次策略检查形成纵深防御。

该方案满足：

1. 保留现有 Codex SDK 架构和 L1 使用体验；
2. 一次安装；
3. 设置中即时切换 L2/L3；
4. CodexUI 不直接持有 Docker 或宿主机 root；
5. Codex 无法自行提权或批准高风险操作。

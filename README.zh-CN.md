<div align="center">
 <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
 <h1>Cloud CLI</h1>
 <p><a href="https://developers.openai.com/codex">Codex</a> 的桌面和移动端 UI，由 9Router 管理供应商认证与模型发现。可在本地或远程使用，从任何地方处理项目与会话。</p>
</div>

<p align="center">
 <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">文档</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Bug 报告</a> · <a href="CONTRIBUTING.md">贡献指南</a>
</p>

<p align="center">
 <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
 <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入 Discord 社区"></a>
 <br><br>
 <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <b>简体中文</b> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---

## 截图

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面视图</h3>
<img src="public/screenshots/desktop-main.png" alt="桌面界面" width="400">
<br>
<em>显示项目概览和聊天的主界面</em>
</td>
<td align="center">
<h3>移动体验</h3>
<img src="public/screenshots/mobile-chat.png" alt="移动界面" width="250">
<br>
<em>具有触控导航的响应式移动设计</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>模型选择</h3>
<img src="public/screenshots/cli-selection.png" alt="模型选择" width="400">
<br>
<em>选择已配置的 9Router 供应商账号所提供的模型</em>
</td>
</tr>
</table>

</div>

## 功能

- **响应式设计** - 在桌面、平板和移动设备上无缝运行，让您随时随地使用 Agents
- **交互聊天界面** - 内置聊天 UI，轻松与 Agents 交流
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Agents CLI
- **文件浏览器** - 交互式文件树，支持语法高亮与实时编辑
- **Git 浏览器** - 查看、暂存并提交更改，还可切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **插件系统** - 通过自定义选项卡、后端服务与集成扩展 CloudCLI。 [开始构建 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 集成** *(可选)* - 结合 AI 任务规划、PRD 分析与工作流自动化，实现高级项目管理
- **路由模型目录** - 仅显示已配置的 9Router 供应商账号通过 `GET /api/providers/codex/models` 提供的模型

## 快速开始

### CloudCLI Cloud（推荐）

无需本地设置即可快速启动。提供可通过网络浏览器、移动应用、API 或喜欢的 IDE 访问的完全集装式托管开发环境。

**[立即开始 CloudCLI Cloud](https://cloudcli.ai)**

### 自托管（开源）

#### npm

启动 CloudCLI UI，只需一行 `npx`（需要 Node.js v22+）：

```bash
npx @cloudcli-ai/cloudcli
```

或进行全局安装，便于日常使用：

```bash
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

打开 `http://localhost:3001`，系统会自动发现所有现有会话。

更多配置选项、PM2、远程服务器设置等，请参阅 **[文档 →](https://cloudcli.ai/docs)**。

#### Docker Sandboxes（实验性）

在隔离的沙箱中运行 Codex，具有虚拟机管理程序级别的隔离。需要 [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/)。

```
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

通过 9Router 支持 Codex。详情请参阅 [沙箱文档](docker/)。

---

## 哪个选项更适合你？

CloudCLI UI 是 CloudCLI Cloud 的开源 UI 层。你可以在本地机器上自托管它，也可以使用提供团队功能与深入集成的 CloudCLI Cloud。

| | CloudCLI UI（自托管） | CloudCLI Cloud |
| --- | --- | --- |
| **适合对象** | 需要为本地代理会话提供完整 UI 的开发者 | 需要部署在云端，随时从任何地方访问代理的团队与开发者 |
| **访问方式** | 通过 `[yourip]:port` 在浏览器中访问 | 浏览器、任意 IDE、REST API、n8n |
| **设置** | `npx @cloudcli-ai/cloudcli` | 无需设置 |
| **机器需保持开机吗** | 是 | 否 |
| **移动端访问** | 网络内任意浏览器 | 任意设备（原生应用即将推出） |
| **可用会话** | 自动发现 `~/.codex` 中的 Codex 会话 | 云端环境内的会话 |
| **支持的 Agents** | Codex | Codex |
| **文件浏览与 Git** | 内置于 UI | 内置于 UI |
| **MCP 配置** | 通过 UI 管理 Codex MCP | UI 管理 |
| **IDE 访问** | 本地 IDE | 任何连接到云环境的 IDE |
| **REST API** | 是 | 是 |
| **n8n 节点** | 否 | 是 |
| **团队共享** | 否 | 是 |
| **平台费用** | 免费开源 | 起价 €7/月 |

> 两种方式都使用你通过 9Router 连接的供应商账号 — CloudCLI 提供环境，而非 AI。

---

## 安全与工具配置

**🔒 重要提示**: Codex 权限模式决定智能体工具如何运行。请从满足工作流的最安全模式开始。

### 配置权限

1. **打开工具设置** - 点击侧边栏齿轮图标
2. **谨慎选择** - 仅选择所需权限级别
3. **应用设置** - 偏好设置保存在本地

<div align="center">

![工具设置弹窗](public/screenshots/tools-modal.png)
*工具设置界面 - 只启用你需要的内容*

</div>

**推荐做法**: 先启用基础工具，再根据需要添加其他工具。随时可以调整。

---

## 插件

CloudCLI 配备插件系统，允许你添加带自定义前端 UI 和可选 Node.js 后端的选项卡。在 Settings > Plugins 中直接从 Git 仓库安装插件，或自行开发。

### 可用插件

| 插件 | 描述 |
| --- | --- |
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 展示当前项目的文件数、代码行数、文件类型分布、最大文件以及最近修改的文件 |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | 支持多标签页的完整 xterm.js 终端 |
| **[Claude Watch](https://github.com/satsuki19980613/cloudcli-claude-watch)** | 监控长时间运行的 Claude Code 会话是否卡住，并提供进程控制 |
| **[CloudCLI Scheduler](https://github.com/grostim/cloudcli-cron)** | 创建工作区范围的定时提示词，并通过 Codex、Claude Code 等本地 CLI 执行 |
| **[PRISM CloudCLI](https://github.com/jakeefr/cloudcli-plugin-prism)** | 在 CloudCLI 中提供 Claude Code 会话智能分析，包括 token 消耗可视化 |
| **[Sessions](https://github.com/strykereye2/cloudcli-plugin-session-manager)** | 查看、管理并终止活动的 Claude Code 会话 |
| **[Token Cost Calculator](https://github.com/NightmareAway/cloudcli-plugin-token-cost-calculator)** | 根据模型价格和 token 用量计算 API 成本，并支持模型价格预设 |
| **[Task Queue](https://github.com/TadMSTR/cloudcli-plugin-task-queue)** | 用于查看、筛选和启动代理任务的任务队列仪表板 |
| **[GitHub Issues Board](https://github.com/szmidtpiotr/claude-github-issue)** | 用于 GitHub Issues 的看板，支持 TaskMaster 双向同步和 /github-task CLI 技能自动安装 |

### 自行构建

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — Fork 该仓库以构建自己的插件。示例包括前端渲染、实时上下文更新和 RPC 通信。

**[插件文档 →](https://cloudcli.ai/docs/plugin-overview)** — 提供插件 API、清单格式、安全模型等完整指南。

---

## 常见问题

<details>
<summary>还能查看旧版 CloudCLI 智能体集成创建的会话吗？</summary>

可以。当前活动智能体仅为 Codex；旧版本留下的会话元数据和历史记录在可用时仍可读取。新运行、认证、模型发现、MCP 与技能都使用 Codex-only 路径。

- **完整 UI** — 除了聊天界面，还包括文件浏览器、Git 集成、MCP 管理和 Shell 终端。
- **CloudCLI Cloud 保持运行于云端** — 关闭本地设备也不会中断代理运行，无需监控终端。

</details>

<details>
<summary>需要额外购买 AI 订阅吗？</summary>

需要。CloudCLI 只提供环境。你需要通过 9Router 连接自己的供应商账号。CloudCLI Cloud 从 €7/月起提供托管环境。

</details>

<details>
<summary>能在手机上使用 CloudCLI UI 吗？</summary>

可以。自托管时，在你的设备上运行服务器，然后在网络中的任意浏览器打开 `[yourip]:port`。CloudCLI Cloud 可从任意设备访问，内置原生应用也在开发中。

</details>

<details>
<summary>UI 中的更改会影响本地 Codex 配置吗？</summary>

会的。自托管模式下，CloudCLI UI 管理 `~/.codex` 中的 Codex 配置；供应商认证和可用模型来自 9Router。

</details>

---

## 社区与支持

- **[文档](https://cloudcli.ai/docs)** — 安装、配置、功能与故障排除指南
- **[Discord](https://discord.gg/buxwujPNRE)** — 获取帮助并与社区交流
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — 报告 Bug 与建议功能
- **[贡献指南](CONTRIBUTING.md)** — 如何参与项目贡献

## 许可证

GNU 通用公共许可证 v3.0 - 详见 [LICENSE](LICENSE) 文件。

该项目为开源软件，在 GPL v3 许可证下可自由使用、修改与分发。

## 致谢

### 使用技术

- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[9Router](https://github.com/9router/9router)** - 供应商认证与模型路由
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具与开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用先行 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(可选)* - AI 驱动的项目管理与任务规划

### 赞助商

- [Siteboon - AI powered website builder](https://siteboon.ai)

---

<div align="center">
 <strong>为 Codex 社区精心打造。</strong>
</div>

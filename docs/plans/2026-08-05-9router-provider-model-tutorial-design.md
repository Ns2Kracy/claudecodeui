# 9Router 供应商配置与 Claude Code UI 模型选择教程设计

日期：2026-08-05  
状态：已确认

## 目标

创建一篇面向普通用户的简体中文 Markdown 教程骨架，说明如何在独立的 9Router 服务中配置模型供应商，以及如何在独立的 Claude Code UI 服务中选择 9Router 通过 `/v1/models` 暴露的模型。

## 边界

- 9Router 与 Claude Code UI 是两个完全独立的服务，界面之间没有跳转入口。
- 9Router 负责供应商账号、认证和模型路由。
- Claude Code UI 保留原生 OAuth 登录能力，并从 9Router 的 `/v1/models` 获取可选模型。
- 教程不介绍容器构建、服务部署、端口或环境变量配置。

## 文档结构

1. 介绍两个服务的职责和数据关系。
2. 在 9Router 中使用 API Key 配置供应商。
3. 简述 OAuth、设备码和自定义供应商。
4. 验证 9Router 已发现并暴露模型。
5. 在 Claude Code UI 中打开模型菜单并选择 9Router 模型。
6. 发送测试消息并处理常见问题。

## 配图

教程保留四个截图位置：

1. 9Router 的 Providers 页面。
2. API Key 供应商配置表单。
3. Claude Code UI 的模型选择菜单。
4. 选中 9Router 模型后的聊天界面。

初版使用带截图要求说明的占位图，后续可直接替换为最终界面截图。

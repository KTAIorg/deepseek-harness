# ADR 0003：桌面开发错误只收集、不告警

日期：2026-10-18

状态：已接受

## 背景

Kito Harness 在本机以开发模式启动时，窗口会闪退。桌面已经把致命失败写成本地崩溃日志并弹出恢复框，但换一台机器或进程退出之后，这份日志不在排查的人手里。

KT 的 Sentry（`https://sentry.ktyun.cc`）已经能收错误。集群里的 `deepseek-harness` 项目属于 ACK 上的服务，告警会进 Telegram，分派会进 `KTAIorg/ai-triage`。本机开发闪退如果打进那个项目，会和线上服务故障混在一起，并直接打到告警群。

## 决策

桌面致命错误另走收集，不接告警。

- 只在环境变量 `DSH_SENTRY_DSN` 非空时初始化。DSN 不进 Git。
- 未打包进程的环境是 `development`，打包进程是 `packaged`。`DSH_SENTRY_ENVIRONMENT` 可以覆盖。
- 上报点是现有的致命失败处理：渲染进程退出、页面加载失败、preload 错误、Host 致命错误，以及主进程启动失败。
- 不采集链路，不附带请求 URL、用户和 `Bearer` 凭证。
- 这个 Sentry 项目不挂 `sentry-alert-bridge.ktyun.cc`，也不挂 `sentry-triage.ktyun.cc`。问题留在 Sentry 的 Issues 里供排查。

进程在 SDK 初始化之前就消失的原生崩溃，仍然只留在本机崩溃日志里。

## 理由

排查要的是错误原文、来源和发生阶段。告警链路是给线上故障值班用的。开发闪退数量不稳定，挂上同一条 Telegram 会把值班通道淹没，也不能帮人看清是桌面壳还是服务挂了。

## 非目标

- 不改集群里现有 `deepseek-harness` 项目的 DSN 和 hook。
- 不为开发闪退新建 Alertmanager 路由。
- 不把渲染进程里的普通控制台错误全部上报。

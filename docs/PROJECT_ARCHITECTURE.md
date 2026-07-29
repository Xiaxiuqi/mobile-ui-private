# 项目架构基线

## 范围

运行时真源是 `src/main.js`，由 esbuild 打包为 `index.js` IIFE；生成物不手工维护。宿主入口由 `manifest.json` 指向 `index.js` 与 `style.css`。

## 当前装配

`src/main.js:25-88` 等待 1000ms 后创建共享 `runtime`、`state` 与可变 `deps`，再依次安装 foundation、conversation、emoji、community、calendar、settings、chat、directory、lifecycle 与 diagnostic。`phone-foundation.js:763-775` 会向 `deps` 回填 overlay、主题、生成任务和注入能力；这使 installer 顺序成为隐式契约。

## 当前分层事实

- 宿主上下文：`host-context.js`。
- 共享运行时：`main.js:28-60`、`runtime.js:1-22`。
- UI/生命周期协调：`phone-foundation.js`、`phone-lifecycle.js`。
- 领域聚合：`calendar.js`、`interactive-scenes.js`。
- 持久化 facade：`storage.js`、`calendar-storage.js`、`storage-background.js`、`pm-idb.js`。
- 公开兼容面：大量 `window.__pm*`，当前没有中心注册器。

## 基线证据

机器可重复统计见 `phase0-architecture-baseline.json`。该文件是基线报告，不代表目标架构已实现。

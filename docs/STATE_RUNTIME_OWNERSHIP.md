# 状态与运行时所有权基线

## App state

`src/main.js:29-51` 创建唯一共享 `state`。主要写入方：

- 会话身份与群聊字段：`conversation.js`、`phone-directory.js`、`phone-lifecycle.js`。
- 生成任务：`phone-foundation.js`。
- 消息历史：`conversation.js`、`phone-chat.js`、`phone-chat-poke.js`。
- 手机 DOM 与激活状态：`phone-lifecycle.js`。

当前同一字段存在多个写入方，尚未满足唯一 owner。

## Shared runtime

`runtime.js:1-22` 持有宿主事件、自动任务、pending 消息、overlay opener 与注入 epoch。`pending-messages.js` 管理 pending bucket；`phone-injection.js` 管理 prompt keys。

## Domain runtime

- 日历：`calendar.js:33-45`，含三个按 storageId Map。
- 社区：`interactive-scenes.js:132-135`，含 store、请求 controller、页面状态。
- 分支：`storage.js:582-583`，含串行队列与 revision Map。

## 规则

Phase 1 前先登记 disposer；Phase 3 前不得宣称状态 owner 已收敛。公开 `window.__pm*` 是兼容镜像，不应成为新代码 owner。

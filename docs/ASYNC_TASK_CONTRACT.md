# 异步任务契约基线

## 已有任务模型

- 聊天生成：`phone-foundation.js` 使用 `AbortController`、sequence、storageId 与 host epoch。
- 自动消息：`runtime.js:25-73` 使用 epoch 与 task Map。
- 日历：`calendar-task-controller.js` 按 storage/category 建任务槽并取消旧任务。
- 社区：`interactive-scenes.js:183-210` 使用 context epoch、request controller 与目标页 guard。
- 宿主切换：`phone-foundation.js:110-120` 取消社区、日历与自动消息。

## 强制契约

任务必须携带目标 scope、epoch 和取消信号；提交前复核目标仍活跃；超时、替换、页面关闭、chat changed 与 beforeunload 必须取消；取消后的旧结果不得写 UI 或持久化。

## 当前缺口

资源没有统一父子 scope；静态计数见 `phase0-lifecycle-baseline.json`，它只能说明调用点数量，不能证明释放正确。

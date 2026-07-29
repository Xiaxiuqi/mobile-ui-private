# 内存预算与采集基线

## 静态基线

`phase0-memory-baseline.json` 当前记录：77 个源码模块、源码约 1,057,130 bytes、bundle 约 1,055,255 bytes、26 个 `new Map`、87 个 `new Set`、17 个 JSON 全量深拷贝调用点。

这些数字只用于后续版本对比，不等同于 heap 占用，也不能证明泄漏。

## 已知长期工作集

- `calendar.js`：`viewByStorage`、`statusByStorage`、`statusTimerByStorage`。
- `runtime.js`：`automaticTasks`、`pendingMessages`。
- `storage.js`：`branchLineageRevisions`。
- `interactive-scenes.js`：store、phoneUiState、requestController。

## 动态预算采集

在真实 SillyTavern 中记录冷启动、首次打开、重复打开关闭 20 次、日历/社区重操作后的 heap、DOM、listener、timer、controller 与 overlay。Phase 0 只建立采集方法；没有浏览器快照前不设置伪精确 MB 阈值。

## 失败判定

重复操作后资源持续单调增长、页面关闭后 controller/timer 仍活跃、无界 storageId 工作集或全量快照随数据线性膨胀，均阻塞后续发布。

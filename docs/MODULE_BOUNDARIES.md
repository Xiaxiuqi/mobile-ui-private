# 模块边界基线

## 已观察边界

| 边界 | 当前 owner | 已知越界 |
|---|---|---|
| 启动装配 | `src/main.js` | installer 通过可变 `deps` 补能力 |
| 手机壳与 overlay | `phone-foundation.js` | 注册公开全局、宿主事件和生成任务 |
| 页面生命周期 | `phone-lifecycle.js` | document 级监听与计时器缺少统一 scope |
| 日历 | `calendar.js` | 同时持有 view、任务、存储快照和 UI 状态 |
| 社区 | `interactive-scenes.js` | 同时负责加载、事务、AI、页面与恢复 |
| 持久化 | `storage.js` | 跨历史、配置、社区、分支与清空事务 |

## 目标约束

repository 不访问 DOM；domain 不直接读取宿主全局；view 不直接持久化；兼容全局只由 adapter 注册；跨域写入必须登记 owner、事务和回滚语义。

## Phase 0 判定

上述是待迁移边界，不是已达成状态。`unknown/TBD` 项必须留在 Phase 0，不能进入对应业务迁移。

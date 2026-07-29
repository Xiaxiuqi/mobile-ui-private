# 模块依赖图基线

```text
manifest.json
  -> index.js (generated from src/main.js)
main.js
  -> host-context + runtime + storage
  -> phone-foundation
  -> conversation -> emoji-ui
  -> interactive-scenes -> calendar
  -> settings + chat + directory + lifecycle + diagnostic
phone-foundation
  -> storage + injection + branch inheritance + UI helpers
calendar
  -> calendar model/view/controllers/storage/commit
interactive-scenes
  -> interactive model/views/scheduler/storage/injection
storage
  -> pm-idb + constants + behavior/worldbook models
```

`phone-foundation.js:763-775` 和 `main.js:69-73` 对共享 `deps` 的运行时补充形成隐式边。`window.__pm*` 形成跨模块反向依赖，数量和文件分布见 `phase0-architecture-baseline.json`。

Phase 0 不宣称循环依赖为零；后续 architecture gate 应基于 AST import 图检查新增循环与禁止方向。

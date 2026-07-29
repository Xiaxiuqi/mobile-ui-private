# CSS 与 DOM 契约矩阵

| 契约 | 来源 | 验证 |
|---|---|---|
| `#pm-iphone` | `BASELINE.md`、运行时手机根节点 | `check:contracts` + 宿主 |
| `#pm-overlay` | `phone-foundation.js:743-760` | `check:contracts` + overlay 回归 |
| `.pm-model-options` | 设置模型选择器 | `check:contracts` |
| `--pm-phone-width/height` | `phone-foundation.js:73-78` | resize/移动端回归 |
| 模型行高 `34px`、默认 4 行 | `constants.js:17`、`BASELINE.md` | `check:contracts` |
| 移动媒体查询 | `BASELINE.md:28` | `check:contracts` |

迁移 view/controller 时不得无证据改 selector、data-action、inline `window.__pm*` 回调或 CSS token。DOM 契约变化必须同时更新 style、检查与人工矩阵。

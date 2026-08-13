# 原版静态基线

基线提交：`0dc8538 Update index.js`

此文件记录模块化前必须保持的关键契约。它不能替代 SillyTavern 中的实际回归测试。

## 入口与生命周期

- `manifest.json` JavaScript 入口：`index.js`
- 异步 IIFE 启动，初始等待 1000ms
- `/phone` 斜杠命令及输入框拦截必须保留
- 全局入口：`window.__pmOpen`
- 启动日志包含：`[phone-mode] v9.5.7`

## 安装顺序与全局桥

- 安装顺序固定为：`installPhoneFoundation → installConversation → installEmojiUi → installInteractiveScenes → installCalendar → installSettingsUi → installPhoneChat → installPhoneContextInjection → installPhoneControlCenter → installPhoneDirectory → installContactGenerator → installPhoneChatPoke → installPhoneLifecycle → installDiagnosticApi → installTodayTrend → installTodayTrendPhoneUi`
- `main.js` 只能作为组合根，不得定义 `window.__pm*`。
- `window.__pmHistories`、`window.__pmConfig`、`window.__pmTheme`、`window.__pmInjectionConfig`、`window.__pmBudgetConfig` 在 foundation 安装时初始化；初始化必须保留既有运行时值，并由各自存储边界随后加载或规范化。
- `window.__pmBeforeUnloadRegistered` 与 `window.__pmPageSuspensionHandler` 归 foundation 的页面挂起监听管理；前者保证监听器只注册一次，后者允许热重载时替换为当前依赖。
- 模板直接调用的 `window.__pm*` API 必须有单一源码 owner，并由 `check:contracts` 校验其存在性和归属。

## 构建体积基线

- 历史合同基线：`index.js` 为 `1240219` bytes；静态合同允许的上限为 `1488263` bytes（历史基线的 120%，向下取整）。
- Today Trend v2 阶段 0 于 2026-08-12 使用当前 `npm run build` 实测 `index.js` 为 `1377215` bytes，低于静态合同上限；该数值是实施前观测点，不自动替换历史合同基线，也不授权抬高上限。
- 阶段 1 已实现默认关闭的 `readV2`、`writeV2`、`serveV2`、独立 v2 store/authority key 与单事务 CAS；authority 不存在时兼容 v1，authority 状态不可确认时读写均 fail-closed。
- 此上限只用于阻止无审查的体积跃升，不替代真实宿主中的首开、首渲染和交互性能测量。调整上限必须同时说明增长来源、宿主回归结果和新的基线值。

当前检查基线：`check:syntax`、`check:today-trend`、`check:contracts`、`check:budget`、`check:interactive` 通过；`check:calendar` 在阶段 0 修改前已因“当日日程重新生成按钮 SVG/aria 契约”失败，属于既有基线阻塞，不得归因给 Today Trend v2，也不得在本阶段顺手修复。

## 持久化契约

- IndexedDB 数据库：`PhoneModeDB`
- IndexedDB store：`kv`
- 历史主键：`ST_SMS_DATA_V2`
- Today Trend v2 主键：`ST_SMS_TODAY_TREND_V2`；authority key：`ST_SMS_TODAY_TREND_V2_AUTHORITY_V1`；二者不得与 v1 key 混用。
- v2 authority 与 store 的 guard compare / writes 必须在同一个 `readwrite` 事务内完成；冲突事务不得留下部分写入。
- authority 存在 active owner 时，其他标签不得通过 `acquire` 接管；必须由当前 owner 显式 `release` 后再竞争获取，阶段 1 不提供 lease、超时或 takeover。
- authority 不可读取时不得回退读取或写入 v1；否则无法证明 v1 与潜在 v2 数据的新旧关系。恢复前提是重新获得 `PhoneModeDB/kv` 的可靠读取能力。
- `pmOpenIDB` 的首次并发调用共享同一个 pending open；`versionchange` 只关闭事件所属连接，并且只有该连接仍是当前缓存时才清空缓存。
- 原存储键与迁移标记不得在纯模块化阶段更名

## CSS 契约

- 手机根选择器：`#pm-iphone`
- 遮罩选择器：`#pm-overlay`
- 模型列表：`.pm-model-options`
- 模型列表高度由 JavaScript 常量 `MODEL_VISIBLE_ROWS` 写入 CSS 变量，CSS 默认值为 4，每行高度为 `34px`
- 移动端媒体查询：`@media(max-width:500px),(max-height:700px)`

## 人工回归清单

- `/phone` 打开、最小化和关闭
- 单聊发送、AI 回复、刷新后历史恢复
- 群聊创建、编辑、发送和删除
- 主题、暗色模式、背景和头像裁剪
- 表情包导入与发送
- 拍一拍与双向记忆
- 数据导入导出
- 浏览器控制台无新增错误

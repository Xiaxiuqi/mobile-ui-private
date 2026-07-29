# 架构指标基线

## 可重复静态指标

数据源：`phase0-architecture-baseline.json`、`phase0-lifecycle-baseline.json`、`phase0-memory-baseline.json`。

- 源码模块：77。
- 入口静态 import：19。
- listener 注册调用点：74；移除调用点：31。
- timeout/interval 调用点：20/3；clear 调用点：5/3。
- AbortController 创建/abort 调用点：10/16。
- Map/Set 创建调用点：26/87。
- JSON stringify/parse 全量深拷贝调用点：17。
- 源码字节：1,057,130；bundle 字节：1,055,255。

## 后续目标指标

- 未登记公开全局与 installer 依赖：0。
- 新循环依赖：0。
- repository 访问 DOM：0。
- 新 domain 直接读取宿主全局：0。
- 受控状态非 owner 写入：0 或有批准豁免。
- 重复 mount/unmount 20 次后已接入资源计数不增长。

静态调用点数量不能直接推导泄漏；所有改善结论必须结合真实宿主 profiling。

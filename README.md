# 天音小笺

个人自用项目，基于 [K20070831/sillytavern-phone-mode-1](https://github.com/K20070831/sillytavern-phone-mode-1) 的二次创作。

## 安装

1. 打开 SillyTavern 的扩展管理页面。
2. 使用以下 Git 仓库地址安装：

    https://github.com/Anyno001/mobile-ui-private

3. 安装后输入 `/phone` 启动。
4. 可以在设置页面固定 `/phone`，方便后续启动。

### 安装失败排查

如果浏览器控制台出现 `Unexpected token 'I', "Internal S"... is not valid JSON`，说明
SillyTavern 前端把以 `Internal Server Error` 开头的服务端错误文本当作 JSON 解析了。
这只是二次症状，不能仅凭该错误判断失败发生在安装、版本检查或具体的 Git 操作；
真正的失败原因必须结合失败请求和 SillyTavern 服务端日志确认。

按以下顺序排查：

1. 记录 SillyTavern 的准确版本或提交号，以及浏览器控制台中的完整堆栈。
2. 在浏览器开发者工具的 Network 面板中确认失败请求、HTTP 状态码和响应正文：
   - `/api/extensions/install` 对应安装和 Git 克隆流程；
   - `/api/extensions/version` 对应已存在扩展的仓库状态、远端获取和版本检查流程。
3. 根据失败接口查找 SillyTavern 服务端日志，并保留原始异常：
   - `/api/extensions/install`：查找 `Importing extension failed`；
   - `/api/extensions/version`：查找 `Getting extension version failed`。
4. 在 SillyTavern 的实际运行环境和运行身份下验证 Git 远程读取能力：

   ```bash
   git ls-remote https://github.com/Anyno001/mobile-ui-private.git
   ```

   如果 SillyTavern 运行在容器或服务账户下，应在对应容器或身份中执行。该命令只能验证远程引用读取，不能替代完整安装验收。
5. 如果 Git 请求失败，检查实际运行环境的 GitHub 连通性、代理配置、证书和 Git 凭据；不要只在浏览器所在设备测试。
6. 如果日志报告目录已存在，先在扩展管理页面确认是否已有同名扩展；不要直接删除目录，以免覆盖未确认的数据。
7. 如果日志报告 `manifest.json` 解析失败，确认克隆到本地的仓库和分支正确，再检查文件内容。

仅凭浏览器中的 JSON 解析异常，无法区分网络、代理、Git、权限或文件系统问题；服务端原始异常才是根因证据。
对外提供日志前，应脱敏访问令牌、用户名、代理凭据和敏感部署路径。

## 说明

- 仅用于个人自用维护。
- 当前维护者已取得上游作者许可。
- 备份可能包含 API Key 和聊天数据，请勿公开。

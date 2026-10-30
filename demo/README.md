# 对话脉络 Demo

公开演示入口：https://ceq1223-stack.github.io/topic-atlas-demo/

这里保存演示的维护源码。`src/` 为独立 HTML、CSS 与 JavaScript，执行 `node demo/build-demo.cjs` 生成 `demo/dist/index.html`。

页面包含时间线、主题关系图、未展开方向和待继续端点，内容为改写示例。没有真实聊天记录、API Key、账号采集或模型调用。演示中的待办仅保存在当前页面内存，刷新会重置。

GitHub Pages 使用单独的 `ceq1223-stack/topic-atlas-demo` 公开仓库，从 `main` 根目录发布。该仓库只发布构建好的 `index.html`、`.nojekyll` 和说明；插件及演示的维护源码在本开源项目中提供。

后续发布：修改本目录源码，重新构建，将 `demo/dist/index.html` 同步为演示仓库的 `index.html`，提交并推送演示仓库的 `main`。发布状态以 GitHub Pages 构建及公开页面的实际响应为准。

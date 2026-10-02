# 墙绘工坊 · 文化墙 AI 提案 MVP

本项目包含两个互不混淆但可以衔接的验证方向：

1. 一个简洁的生图网站，可在本地或受邀测试服务器运行，用于验证客户是否愿意提交墙体素材；
2. 研究如何把 AI 文化墙效果图转化为可继续编辑、能够衔接真实生产流程的设计资产。

生图网站不是最终生产文件工具，也不预设 SVG、CDR、AI、PSD、PDF 或 CAD 中的某一种就是最终交付格式。生产化方向仍需分析同一真实落地项目的：

1. 原始需求与素材；
2. 最终确认的效果图；
3. 实际交给生产端的文件；
4. 从效果图到生产文件的人工步骤、耗时和返工点。

只有真实案例证明高频、耗时、可定义输入输出且能接入下游软件的单一环节，才会进入第一版 MVP。

## 本地生图 MVP

技术栈：React + TypeScript + Vite，后端为 Node/Express 服务。中转站密钥只存在服务端环境配置中，不会发给浏览器。

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env，填写本机 IMAGE_API_KEY
npm run dev
```

打开 `http://localhost:5173`。没有参考图时调用 OpenAI Images 兼容的 `/v1/images/generations`；上传参考图时调用 `/v1/images/edits`。提示词与参考图片会经服务端发送到配置的第三方生图服务；生成结果保存在服务端，最近记录保存在当前浏览器。

杭州 ECS 受邀测试部署方式与 SSH 隧道访问见 [`deploy/README.md`](deploy/README.md)。部署时启用受邀账号、每日／总生成额度、单任务并发限制，页面、API 与生成图片统一受保护。

构建和测试：

```powershell
npm test
npm run build
```

自研和复用边界见 [`docs/architecture/0001-build-vs-reuse.md`](docs/architecture/0001-build-vs-reuse.md)。

## 案例研究工具

[`case-discovery-kit`](case-discovery-kit/README.md) 提供：

- 真实案例资料索取清单；
- 原件只读副本和 SHA-256 清单；
- 访谈、流程、逐元素追踪和差异分析模板；
- 小范围技术验证记录；
- 候选功能评分与 MVP 决策门槛。

## 安全原则

- 客户原件、生产文件、上传素材和生成结果不提交 Git。
- 中转站密钥不进入浏览器、不写入源码、不提交 Git。
- 上传参考图会发送到第三方生图服务；使用真实客户资料前需确认上传授权。
- 第三方 AI 处理前必须确认资料上传授权。
- AI 输出必须在实际设计／生产软件中验证，不能仅凭视觉相似判定可生产。


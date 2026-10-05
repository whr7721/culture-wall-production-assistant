# 墙绘工坊 · 文化墙概念图与可编辑正视稿演示

本项目包含两个互不混淆但可以衔接的演示流程：

1. 一个简洁的生图网站，可在本地或受邀测试服务器运行，用于验证客户是否愿意提交墙体素材；
2. 以实测尺寸建立正视图，把准确文案、色块和客户图片重建为可编辑项目，再导出 SVG、分层 PSD 和 PNG 设计中间稿。

生图网站不是最终生产文件工具，也不预设 SVG、CDR、AI、PSD、PDF 或 CAD 中的某一种就是最终交付格式。生产化方向仍需分析同一真实落地项目的：

1. 原始需求与素材；
2. 最终确认的效果图；
3. 实际交给生产端的文件；
4. 从效果图到生产文件的人工步骤、耗时和返工点。

项目工作台是流程演示，不是一键把透视图变成施工图。只有真实案例证明高频、耗时、可定义输入输出且能接入下游软件的单一环节，才会锁定生产化 MVP。

## 本地运行

技术栈：React + TypeScript + Vite + Fabric.js，后端为 Node/Express 服务。生图密钥只存在服务端环境配置中，不会发给浏览器。

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env，填写本机 IMAGE_API_KEY；默认仍使用已验证的中转站
npm run dev
```

打开 `http://localhost:5173`。主页原有生图流程继续可用。进入“正视平面稿工作台”可创建项目、录入毫米尺寸和门/缺口、上传素材、生成空间概念与正视候选、编辑准确文字/色块/图片的坐标，保存后重新打开。确认平面稿后可下载 SVG、分层 PSD、PNG。项目和素材存于服务器、按受邀账号隔离；首页“最近方案”仍仅保存在当前浏览器。

默认中转站：无参考图调用 `/v1/images/generations`，有参考图调用 `/v1/images/edits`。服务器可设置 `IMAGE_PROVIDER=alibaba`、`ALIBABA_IMAGE_API_KEY` 和与密钥同地域的 `ALIBABA_IMAGE_BASE_URL` 切至百炼 Qwen Image 3.0；该适配器统一调用百炼兼容模式 `/images/generations`，参考图使用 JSON `image` 扩展字段，不能与中转站请求格式混用。百炼模型/地域/计费及图片下载域名应按账户实际配置核实；未获测试费用许可前不要填入密钥并切换。普通试用者无法在页面切换供应商。两条通道都把图片落盘为本站历史资源，切换后旧图片不依赖原供应商。

上传到项目的素材只保存在本站服务器，勾选并点击生图时才随请求发送第三方；上传前仍应取得客户授权。PSD 的文字层是独立位图层，准确原文保存在本站项目内供修改后重导出；SVG 则保留文字对象。两者均非最终生产文件，须由设计师在 Illustrator/Photoshop 和真实工艺流程复核。

杭州 ECS 受邀测试部署方式与 SSH 隧道访问见 [`deploy/README.md`](deploy/README.md)。部署时启用受邀账号、每日／总生成额度、单任务并发限制，页面、API 与生成图片统一受保护。

构建和测试：

```powershell
npm test
npm run build
npx tsx scripts/acceptance-project.ts
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

本轮实现与未完成的真实案例、同题评测门槛见 [`docs/implementation-status.md`](docs/implementation-status.md)。


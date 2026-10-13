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

工作台已支持在图片对象上拖拽框选、自动颜色分层或指定单色提取，选择轮廓加入画布后独立编辑和下载 SVG。颜色层仍需逐项核对，特别是小字和与背景同色的元素。五份外部 SVG 样本导入与本地案例结果、限制及测试命令见 [`docs/progress/2026-10-13-color-layer-svg.md`](docs/progress/2026-10-13-color-layer-svg.md)。

主页现提供自定义画面像素尺寸（512—2048 px、宽高为 16 的倍数，另有限定像素总数和比例）、参考图缩略图、可选的 16 字以内画面短标题。若短标题留空，服务端提示词会尽量避免在概念图中绘制任何文字；若填写，则只要求绘制这一句，不让模型把长段客户文案排成小字。准确文字仍应在正视平面稿中重建。当前中转站配置的模型 ID 为 `gpt-image-2.5`，属于中转站别名，未独立验证其上游映射及自定义尺寸兼容性；不要把它等同于 OpenAI 官方模型 ID。自定义尺寸若被上游拒绝，已受理的试用尝试可能计入额度，不会自动重试并再次收费。

默认中转站：无参考图调用 `/v1/images/generations`，有参考图调用 `/v1/images/edits`。服务器可设置 `IMAGE_PROVIDER=alibaba`、`ALIBABA_IMAGE_API_KEY` 和与密钥同地域的 `ALIBABA_IMAGE_BASE_URL` 切至百炼 Qwen Image 3.0；该适配器统一调用百炼兼容模式 `/images/generations`，参考图使用 JSON `image` 扩展字段，不能与中转站请求格式混用。百炼模型/地域/计费及图片下载域名应按账户实际配置核实；未获测试费用许可前不要填入密钥并切换。普通试用者无法在页面切换供应商。两条通道都把图片落盘为本站历史资源，切换后旧图片不依赖原供应商。

生图表单现在有服务端白名单控制的模型下拉菜单：现有默认通道、卡米 Banana 2K、卡米 Banana Pro 4K。卡米选项只有配置 `KAMI_IMAGE_API_KEY` 后才可选；模型 ID 可用 `KAMI_BANANA_MODEL`、`KAMI_BANANA_4K_MODEL` 调整。适配器按 [New API 的 Gemini 原生图片接口](https://docs.newapi.pro/zh/docs/api/ai-model/images/gemini/geminirelayv1beta-383837589) 请求，参考图以内联数据发送，并把图片直接保存到本站。卡米站点本身未找到公开的接口契约，**因此它仍待新密钥和小额真实请求验证，不能称为已打通**；4K 是模型输出档位，不等于生产尺寸。卡米 Banana 暂只用横版、方形、竖版预设比例，不能用自定义像素尺寸。既有额度与并发限制继续适用；不会自动故障切换或在失败后悄悄重复调用。

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

## Kimi 官方需求整理（新增，默认关闭）

主页参考图上传区域下方新增“先用 Kimi 整理需求”折叠区。读取上方需求、最多三张参考图、另行填写的墙宽/高（毫米）和准确文案；返回分区建议、待确认问题、风险和生图提示词。用户核对后点击应用，再手动点击原有生图按钮。不会自动调用生图，也不会自动转换 SVG、改写工作台尺寸或生成施工文件。

在服务端 `.env` 中填写 `KIMI_API_KEY`，默认模型 `KIMI_MODEL=kimi-k2.5`；确认测试费用后设置 `KIMI_ENABLED=1` 并重启后端。使用 Kimi 开放平台标准 API Key，不是 Kimi Code 订阅凭据。请求固定发送至 `https://api.moonshot.cn/v1/chat/completions`；密钥不会进入前端。**当前只完成模拟验收，尚未验证账户模型可用性与真实参数兼容性。**

需求整理使用独立的 `PLANNER_DAILY_LIMIT` / `PLANNER_TOTAL_LIMIT` / `PLANNER_USAGE_FILE`，默认每天5次、总20次、全站单并发、同账号30秒间隔。受理后的失败尝试也计数，不自动重试。图片生成的额度和供应商配置保持原样。素材发送需要用户勾选授权；精确文字与尺寸由本站程序保留，不采用模型改写版本。

流程指令位于 `server/prompts/culture-wall-planner.md`，不是自动执行的 Codex Skill。整理结果目前仅存在当前页面，可下载 JSON 备份原文和结果；刷新前请下载。尚未自动保存到项目，页面换图、改尺寸或改文案后旧建议会提示失效。原有生图提示词仍保留短标题限制。

验证：`npm test`、`npm run build`；运行后端后设置 `PLANNER_TEST_URL` 并执行 `npx tsx scripts/acceptance-planner.ts` 可做模拟浏览器验收，不调用付费 API。进度与明日待办见 `docs/progress/2026-10-10-kimi.md`。

## 安全原则

- 客户原件、生产文件、上传素材和生成结果不提交 Git。
- 中转站密钥不进入浏览器、不写入源码、不提交 Git。
- 上传参考图会发送到第三方生图服务；使用真实客户资料前需确认上传授权。
- 第三方 AI 处理前必须确认资料上传授权。
- AI 输出必须在实际设计／生产软件中验证，不能仅凭视觉相似判定可生产。

本轮实现与未完成的真实案例、同题评测门槛见 [`docs/implementation-status.md`](docs/implementation-status.md)。


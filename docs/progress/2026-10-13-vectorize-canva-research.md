# 图转 SVG 与 Canva Magic Layers：证据和本地试验

日期：2026-10-13。只读分析梓恒公开交付的前端代码及 Canva 官方文档；未获取第三方后端或私有模型代码，未调用付费接口。本次功能仅在本地实验分支，不等于线上已部署。

## 梓恒公开代码中能确定的事

- `D:\zcode1\ziheng-research\evidence\zhd_vec.js` 是公开图转 SVG 页面模块：读取通道配置，上传图片和参数，POST `api/vectorize.php`，展示/下载返回的 SVG URL。它没有前端描摹算法。
- `zhd_app.js` 的画布“图转 SVG”工具目前显示“即将上线”；画布另有通用 `fabric.loadSVGFromString` 导入与 `canvas.toSVG()` 导出。两者没有证据表明会把转换结果自动语义分层并加入画布。
- 配置宣称免费通道由本地 VTracer/Potrace 执行，高级通道有本地 sidecar，收费通道走云服务；没有 PHP 和 sidecar 源码，不能确认实际算法、质量、计费与供应商。
- 借鉴交互与任务边界，不复制第三方私有 JS。

## Canva 官方接口的关键分界

- 官方 [Magic Layers 使用说明](https://www.canva.com/en_gb/help/editable-magic-layers-variantb/) 确认 PNG/JPG 单页图可拆成可移动的设计对象；不保证所有元素正确分离，照片效果较弱。对象独立编辑不等于每个对象已经是真矢量路径。
- 官方 [图片转设计 API](https://www.canva.dev/docs/apps/rest-apis/reference/design-imports/create-image-to-design-import-job/) 是 **preview**：先把素材放进用户 Canva 账户，OAuth 代表该用户调用，消耗该用户 AI 额度，要求 `image_to_design_imports` capability，结果是 Canva 设计 ID 和编辑链接。预览 API 的公开集成不能通过发布审核。
- [Canva REST 导出 API](https://www.canva.dev/docs/apps/rest-apis/reference/exports/create-design-export-job/) 目前的可用格式列表不含 SVG，并列出“SVG Export is currently unavailable”错误。Canva **编辑器手动导出 SVG** 和 **Canva 内嵌应用的 `requestExport` 支持 SVG** 是不同接口，不能据此承诺我们网站后端可自动取回分层 SVG。
- 因此 Canva 可作为人工对照和后续能力验证，不作为本站 SVG 自动化主链路；仍需账号、额度和实测导出对象结构。

## 本地实现与边界

- 采用 [VTracer 官方 Node/WASM 包](https://github.com/visioncortex/vtracer/tree/master/nodejs) 做黑白蒙版描摹；用户在现有工作台对图片指定裁剪百分比、目标颜色及容差，预览黑白蒙版，确认后生成真正 `<path>`，放回原项目坐标并可独立导出。
- 服务端验证 PNG、2MB 上传、原始最大 4096 边长/1600 万像素，缩至 1024 边长，限制 40 路径、100KB SVG、每受邀账号每日 10 次尝试。原图不删除，不上传给新付费服务。
- 不能自动识别 Logo、中文文字、复杂插画或多个语义对象；不同色块需分别框选。描摹误差和墙面尺寸需要设计人员复核。完整稿 SVG 中图片仍是嵌入位图，不应称全矢量。

## 验证

- `npm run build`、`npm test -- --run server/services/vectorize.test.ts` 通过。
- 已有 ACH/欧连案例的左侧蓝色造型蒙版，经新服务得到 1 条路径、SVG 2489 字节、不含 `<image>`。浏览器导入此 SVG 成功，Inkscape 1.4.4 `--query-all` 可见真实路径。输出：`output/vector-spike/panel-website-trace.svg`。
- 本机未安装 Illustrator；Adobe Illustrator 打开、节点编辑和回存仍需用户或设计师在目标软件验收。Inkscape 成功不能替代 Adobe 验收，更不能替代生产文件验收。

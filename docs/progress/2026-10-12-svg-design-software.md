# 从正视候选图提取真矢量并用设计软件验收

日期：2026-10-12。仅本地实验分支 `experiment/independent-vector-assets`，**未部署到线上站点**，无付费调用。输入是已有欧连/ACH 正视候选图 `D:\codex\culture-wall-skilled-4766x2690.png`。真实生产文件尚未取得；本报告不宣称 SVG 可直接生产。

## 可供人工测试的文件

- `output/vector-spike/panel-importable.svg`：左侧深蓝造型，**一个真实路径**，无嵌入图片；画布尺寸 1590 × 1877 mm。
- `output/vector-spike/divider-importable.svg`：标题下蓝色装饰线，一个真实路径，2610 × 10 mm。
- `output/vector-spike/panel-svg-render.png`：浏览器预览。
- `output/vector-spike/inkscape-roundtrip.svg`：Inkscape 打开后重新导出的 SVG。
- `output/vector-spike/panel-manifest.json` 和 `divider-manifest.json`：源图裁剪坐标、近似墙面位置和算法记录。

这些输出在 Git 忽略目录 `output/`，不包含上传到生产站点的素材。尺寸来自案例图像像素与 4766 × 2690 mm 墙体尺寸的对应关系，是**候选定位**，并非现场复尺或加工尺寸。

## 方法和关键纠错

1. 复用 VTracer（MIT）试验位图描摹。简单蓝线可从背景中分出一个路径。
2. 对左侧大造型，VTracer 的分层输出虽有 `<path>`，但抽第一条后实际成了整块蓝色矩形。仅检查 SVG 标签和“能导入”会漏掉这个错误，因此**否决此输出**。
3. 复用本机 OpenCV 的颜色阈值、最大连通区域和外轮廓；将白色字形空洞排除，再以 2 像素近似误差生成一个 17 节点的轮廓路径。此法只适用于此类对比鲜明、无遮挡的纯色造型，并非自动语义分层。
4. 使用 Chrome 实际渲染后比对轮廓：像素 IoU = **0.999416**。这一指标只比较提取轮廓，不评估字体、材质或生产可行性。

## 设计软件验收

本机安装免费 Inkscape 1.4.4 作为 SVG 互通性验证（未购买服务）。用 CLI 打开 `panel-importable.svg`，`--query-all` 返回一个 `path1`；导出 PNG 并重新保存 plain SVG 成功。回存文件仍保留 `<path>`、`width="1590mm"`、`height="1877mm"` 和对应 `viewBox`，没有 `<image>`。Inkscape PNG 与提取轮廓的像素 IoU = **0.999383**。`divider-importable.svg` 也能被 Inkscape 查询为一个路径。

网站已有工作台复用 Fabric：两条 SVG 路径均可导入、保存重开、分别下载只含路径的 SVG；浏览器验收脚本通过。测试创建的项目已移至 `data/test-projects/vector-spike-archive/`，未删除、未覆盖用户项目，本地正常项目数恢复为 18。工作台的路径标签已由“色块”改为“矢量路径”。

## 用户复测

1. 用 Inkscape、Illustrator 或 CorelDRAW 打开 `output/vector-spike/panel-importable.svg`，确认是一个可选中、可改节点/填色的路径，而非整张图片；检查文档单位和 1590 × 1877 mm 尺寸。
2. 本地网站 `http://127.0.0.1:5173/` 进入工作台，选一个现有实验项目或创建新项目，点击“导入SVG独立路径（实验）”选择上述文件。可拖动、缩放、保存重开，并下载选中元素 SVG。**不要把这张大造型直接当作加工刀线**。
3. 反馈目标软件名称、打开后单位/形状是否正确、是否要保留颜色外圈、圆角或其他装饰细节。目标软件的实际验收仍不可省略。

复现顺序：安装 Python `vtracer==0.6.15` 到 `output/vector-spike/vendor`（另需 Pillow、OpenCV、NumPy），执行 `python scripts/vector-spike.py D:\codex\culture-wall-skilled-4766x2690.png`、`npx tsx scripts/render-vector-spike.ts`；Inkscape 导出 PNG 后执行 `python scripts/validate-vector-spike.py`。网站验收用 `npx tsx scripts/acceptance-vector-spike.ts`，会新增一个本地测试项目，注意项目总数上限 20。

## 尚未实现

- 网站内框选后自动分割/描摹；目前仅本地脚本从指定案例提取，再导入网站。
- Logo 原始矢量优先导入、复杂配图透明 PNG、准确中文文字对象的完整重建。
- Illustrator、CorelDRAW、客户实际生产软件的打开/编辑/回存测试。
- 依据真实生产资料确定材料、刀线、出血、字体转曲、色彩模式等要求。

下一阶段应先将“用户框选 + 指定颜色 + 预览/人工确认 + 独立 SVG/PNG 输出”做成受限工具，**只支持纯色简单图形**；复杂图形失败时允许人工上传替代素材。未经效果基准测试不把整墙自动分层作为承诺。

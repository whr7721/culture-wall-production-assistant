# 高质量描摹通道（Vectorizer.AI）

## 当前状态

默认关闭。采用独立 provider 适配器，现有本地 VTracer 通道继续使用。
默认模式明确为 `test`，浏览器不能覆盖模式、接口地址或认证信息。
免费模式也必须配置 API Id 和 API Secret。没有凭据时仅能完成模拟上游集成验收，不能声称官方服务已跑通。

## 服务端配置

在未提交 Git 的 `.env` 填写以下项并重启服务；不要把密钥写入前端或聊天：

```dotenv
VECTORIZER_AI_ENABLED=1
VECTORIZER_AI_MODE=test
VECTORIZER_AI_API_ID=<官方 API Id>
VECTORIZER_AI_API_SECRET=<官方 API Secret>
VECTORIZER_AI_ENDPOINT=https://api.vectorizer.ai/api/v1/vectorize
```

开通确认后才能由站点维护者把 `VECTORIZER_AI_MODE` 改为 `production`。
不会自动选择 production、preview 或付费回退；402/429 原状态码和明确中文提示返回，不自动重试。
302.AI 已增加独立通道：使用其文档的 Bearer Key 和固定接口 `https://api.302.ai/vectorizer/api/v1/vectorize`，复用官方点号参数、SVG清洗、账号隔离、下载和画布编辑。真实响应仍需配置凭据后验收；其文档的响应示例仅为 `{}`，本站遇到JSON会明确报错，不将空对象当作SVG或猜测下载地址。

## 国内付费渠道开通步骤

1. 打开 https://302.ai/ 注册或登录；充值方式以后台实际显示为准。官方更新日志记录已支持微信支付，无需外国银行卡。
2. 「使用API → API Keys」创建独立测试Key，可关闭无限额度并设置小额总额度及每日额度。
3. 确认费用后，在本站 `.env` 填写以下项，然后重启本地服务：

```dotenv
VECTORIZER_AI_ENABLED=1
VECTORIZER_AI_CHANNEL=302
VECTORIZER_AI_MODE=production
VECTORIZER_302_API_KEY=<302平台的独立Key>
```

不要填写官方 API Id/Secret 来代替302 Key。通道选择由服务端维护者配置，普通用户仍只看到“高质量描摹”。
官方直营可以免费 test；302 文档标价0.3 PTC/次，不能假设转发 `mode=test` 就免收中转费用。因此302仅在显式production配置时启用，等待用户确认开通后真实调用。

付款参考：https://help.302.ai/docs/geng-xin-ri-zhi-VmVs （2025-11-18记录微信支付）
接口与费用：https://doc.302.ai/api-162840406 、https://302.ai/product/detail/vectorize
Key管理：https://help.302.ai/docs/API-guan-li

## 2026-10-14真实本地验收

已配置302独立测试Key（仅本地 `.env`，本文件不记录值），启用本机环境代理。
一次直连连接故障后修正了环境代理；第一次取得SVG时遇到标准SVG 1.1外部DTD，修正为仅移除已知W3C声明后再执行完整白名单检查，实体和未知DTD仍拒绝。
两次上游成功返回中，第二次成功通过清洗。按标价估计合计0.6 PTC，实际扣费需核对302账单。响应 `X-Credits-Charged=1.000000` 是上游Vectorizer信用值，不能直接当作302的PTC账单。

实测图为“塑美流程”第5个心形图标裁剪100×102px，参数stroke_edges、两色色板、max_colors=2、group_by=parent。结果6条路径、0个位图；stroke_edges产生双边细轮廓，颜色仍为蓝白混合边缘色，不能承诺仅靠palette消除这种偏色。
已将真实结果导入网站项目“302真实测试-心形图标-20261014”，验证保存、重新打开、修改描边颜色和独立SVG下载，复用结果过程中未追加付费调用。
原始完整结果、白底预览和验收报告位于 `output/vectorizerai-live-20261014-svg-fixed/`。
本次未启动Illustrator，桌面软件实开仍待设计人员复核。

## 使用方法

新建或打开工作台项目 → 上传图片并添加到画布 → 选中图片 → 图片分层与 SVG 提取 → 描摹通道“高质量描摹” → 框选或整图处理 → 调整参数 → 生成 → 下载完整 SVG，或加入画布后保存、重新打开和独立导出。

四项参数直接使用官方名称：

| UI | multipart 参数 | 默认 |
|---|---|---|
| 绘制方式 | `output.draw_style` | 图标 `stroke_edges`；“色块：填充”按钮改为 `fill_shapes` |
| 锁色 | `processing.palette` | 空；支持 `#RRGGBB;` / `#RRGGBBAA;` 列表 |
| 最大颜色数 | `processing.max_colors` | 0 自动；范围 0–256，1/2 均为双色 |
| 分组 | `output.group_by` | none，可选择 color/parent/layer |

锁色是色板吸附，单一蓝色可能让背景也变蓝；保留背景时可用 `#1a2f7c;#ffffff;`。
默认 gap filler 可能产生混合边缘色。stroke 模式 color 分组未必形成 `<g>`。
下载保留上游分组，画布按路径展开，不提供 SVG 分组级编辑。

## SVG 管线与限制

响应须经过共享 SVG 白名单清洗，拒绝脚本、事件属性、外链、位图、实体声明及不支持的动态对象。
圆、椭圆、矩形、折线等安全图元无损转为路径，保留填充、描边、分组及变换；未删除测试水印。
清洗后落盘 `data/vectorizer-results/<受邀账号>/<uuid>.svg`；下载走同一邀请保护链路，跨账号不可读取。
浏览器导入继续经过既有路径、坐标变换、描边验证。
画布已修正无填充路径的显示：SVG `fill="none"` 映射为 Fabric 的 `fill: null`，空心描边不会变黑；空心对象的颜色控件修改描边颜色。

上传为有效 PNG，最大 2MB；框选边长目前缩至1536像素。原始响应接收上限64MB，清洗处理上限16MB；1MB仅是画布插入限制，不再导致已收到的大结果丢失。
工作台维持120个对象限制。真实图标样本194条路径可下载完整SVG，加入画布需缩小框选范围；不会截断轮廓。
高质量通道采用单进程串行预算预占、持久化任务和次数记录，重启不会清空。不要使用多进程/多副本部署此账本。免费测试每日10次；付费次数、每日和累计预算由服务端配置。
生产费用和站点收费尚未实现，调用失败不会触发额外调用。

## P0结果保护（2026-10-14）

调用前预占预算并检查存储空间；原始响应先私有落盘，再执行清洗。任务历史支持刷新后恢复、下载完整SVG及免费本地重处理，不自动删除历史付费资产。未经验证的原始响应仅以TXT附件下载，不渲染。

相同账号、图片和参数默认复用任务，包括失败或中断任务；只有明确勾选重新付费并确认才重新提交。浏览器异步提交后轮询任务，离开页面不会取消服务端任务。服务重启后的中断任务标为费用未知，不自动重试。

接口：POST `/api/vectorize/high-quality`（`Prefer: respond-async`）；GET `/api/vectorize/tasks`、`/tasks/:id`、`/budget`；POST `/tasks/:id/reprocess`仅本地处理。原始响应、预览和下载均按受邀账号隔离。

本站预算是保守预占，不是302余额或实际账单。失败/未知调用不自动退回预占，需核实平台账单。用户确认平台余额为负后，本机每日和累计预算已设为0，暂停新增付费描摹；历史下载和恢复不受影响。此前未保存的原始响应无法追溯恢复。

## 验证与来源

`npm test` 验证参数映射、默认关闭、密钥缺失、402/429单次请求、拒绝危险SVG、账号保护及文件下载。
`npm run build` 后运行 `npm run test:vectorizer-browser`，使用模拟上游响应和独立临时项目目录验证完整网站流程，输出在 `output/vectorizerai-acceptance/`，不调用外部付费API。
`npm run test:vectorizer-browser -- --302` 验证302 Bearer鉴权、参数、完整下载、空心描边显示、编辑颜色、保存重开和独立SVG导出；同样不产生费用。
配置官方凭据后需在 test 模式再验真实网络、水印结构、颜色、图元和 Illustrator 导入质量。

官方文档：https://vectorizer.ai/api/documentation
官方 SDK：https://github.com/clv/vectorizer-ai-js （`@vectorizer-ai/sdk`，不是交接文档中的 `vectorizer-ai` 包名）
本次仅有一个 multipart 端点，使用项目现有 Node fetch/FormData 方式实现小适配器；XML解析复用 `@xmldom/xmldom`。

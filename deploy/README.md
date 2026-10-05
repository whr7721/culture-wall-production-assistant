# 杭州 ECS 受邀测试部署

部署目标：Ubuntu 24.04 x86_64，网站与 Nginx 仅监听 `127.0.0.1`，外部通过 SSH 隧道访问。备案完成前不向公网提供 HTTP/HTTPS 站点。

预留域名：`haoyangbu.cn`（用户确认已在阿里云购买并完成实名认证；截至 2026-10-05，ICP 备案尚未完成）。当前不将域名解析到此站点、不配置公网 HTTP/HTTPS 监听；备案完成后再核实解析、证书和对外开放方案。

## 文件布局

- `/opt/culture-wall/node`：经官方 SHA-256 校验的 Node.js LTS；
- `/opt/culture-wall/releases/<commit>`：每次发布的代码与依赖；
- `/opt/culture-wall/current`：当前版本链接；
- `/var/lib/culture-wall/generated/<受邀账号>`：按账号隔离、持久化的生成图片；
- `/var/lib/culture-wall/projects/<受邀账号>`：按账号隔离、持久化的项目与上传素材；
- `/var/lib/culture-wall/usage.json`：持久化试用额度；
- `/etc/culture-wall/culture-wall.env`：服务端中转站配置；
- `/etc/culture-wall/invites.json`：受邀用户密码哈希和额度；
- `/etc/systemd/system/culture-wall.service`：进程守护与开机启动；
- `/etc/nginx/sites-available/culture-wall`：仅回环地址反向代理。

更新版本时不清理 `/var/lib/culture-wall`。发布前保留旧 `current` 目标，以便回滚。

## 本机访问

```powershell
ssh -i C:\Users\whr\.ssh\culture-wall-ecs-ed25519 -N -L 127.0.0.1:18080:127.0.0.1:8080 root@47.99.189.172
```

保持终端开启，在浏览器访问 `http://127.0.0.1:18080/`，输入受邀账号。此账号仅通过 SSH 加密隧道传输。访问 `http://47.99.189.172:8080` 应失败。

## 给试用者开通

技术熟练的试用者可在自己的电脑生成 SSH 公钥，提供 `.pub` 内容给管理员。管理员为每人创建普通系统账号，只允许该密钥转发到 `127.0.0.1:8080`；再通过 `npm run invite:add -- <用户名> [每日额度] [总额度]` 创建浏览器受邀账号。把对应账号密码通过单独的保密渠道交给试用者，不共用服务器 root 密钥。

不熟悉命令行的 Windows 试用者使用本机生成的独立试用密钥和 `Start-Trial.cmd` 一键包。该包只包含受限密钥、固定服务器公钥和启动脚本；浏览器账号密码单独交付。密钥泄露时，管理员应移除该试用账号的 `authorized_keys` 并撤销对应浏览器账号。当前首个试用包位于 `data/invite-bundles/culture-wall-trial1-windows.zip`，被 Git 忽略；浏览器凭据位于 `data/invite-credentials/trial1.txt`，同样不提交 Git。

Windows 试用者隧道示例（把用户名、密钥路径替换成各自的）：

```powershell
ssh -i C:\Users\<试用者>\.ssh\culture-wall-trial -N -L 127.0.0.1:18080:127.0.0.1:8080 <隧道用户名>@47.99.189.172
```

## 运维核验

```bash
systemctl status culture-wall --no-pager
systemctl status nginx --no-pager
ss -lntp
curl -I http://127.0.0.1:8080/
journalctl -u culture-wall -n 50 --no-pager
```

`curl -I` 未携带凭据时应返回 `401`。图片存储和额度均跨重启保留。首次上线前须确认客户授权上传资料到第三方生图服务。受邀账号额度计数为“已受理的生成尝试”，包括上游失败请求；全站默认同时运行 1 个生图任务、同账号间隔 60 秒。

## 备案与正式公开

杭州 ECS 属中国内地，域名或仅 IP 的公网网站均涉及备案。阿里云代备案流程需要已实名认证且满足备案条件的域名。完成 ICP 备案后，再确定对外域名与 HTTPS 证书，并评估公网访问策略；当前试用阶段维持 SSH 隧道。

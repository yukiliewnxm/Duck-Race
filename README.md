# 鸭鸭大赛跑（Render 版）

- 大屏幕（主持人）：`https://你的网址/host`
- 手机（参赛者）：扫大屏幕上的二维码（就是 `https://你的网址/`）

## 部署到 Render（免费）

1. 把这个文件夹里的所有文件上传到一个新的 GitHub 仓库（例如 duck-race）
2. 登录 render.com → **New → Web Service** → 连接这个 GitHub 仓库
3. 设定：
   - Runtime：**Node**
   - Build Command：`npm install`
   - Start Command：`node server.js`
   - Instance Type：**Free**
4. 按 Deploy，等 1–3 分钟，出现 “Live” 就好了

（可选）主持人密码：在 Render → Environment 加一个 `HOST_PIN`，值随便设，例如 `8888`。
设了之后打开 /host 要先输入密码，避免别人乱按开始。

## 注意
- 免费版 15 分钟没人用会睡觉，下次打开要等大约 1 分钟才醒。年会开场前 2–3 分钟先打开 /host 叫醒它。
- 比赛数据只在服务器内存里，服务器重启后名单会清空，请大家重新扫码即可。

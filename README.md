# Meting-API-EO

> 🚀 部署在 **腾讯云 EdgeOne Pages（Makers 免费版）** 的多平台音乐 API 代理服务。

基于 EdgeOne Cloud Functions（Node.js 运行时）与 [`@meting/core`](https://www.npmjs.com/package/@meting/core) 核心，专为网页音乐播放器 [APlayer](https://aplayer.js.org/) 与 [MetingJS](https://github.com/metowolf/MetingJS) 定制。

## 特性亮点

- ⚡ **国内边缘节点极速访问**：依托腾讯云 Anycast 全球及大陆边缘节点，延迟低至 20ms~50ms，彻底解决 Vercel / Cloudflare 等海外节点访问缓慢或被墙的问题。
- 🎵 **五大主流平台全支持**：网易云 (`netease`)、QQ 音乐 (`tencent`)、酷狗 (`kugou`)、酷我 (`kuwo`)、百度 (`baidu`)。
- 🛡️ **无海外版权限制困扰**：在中国大陆节点直接请求国内各大音乐平台 API，无需担心海外 IP 被限流或拦截。
- 💾 **内置 LRU 内存缓存**：实例温启动期间复用数据缓存，有效减轻上游请求压力。
- 🔐 **可选 HMAC-SHA1 鉴权**：支持配置 `METING_TOKEN` 签名保护，防止接口被恶意盗刷。
- 📝 **双语歌词智能对齐**：自动将原文歌词与翻译歌词按时间戳合并为 `原文 (翻译)` 格式。

---

## 快速部署至 EdgeOne Pages

### 方式一：EdgeOne 控制台一键绑定（推荐）

1. 登录 [腾讯云 EdgeOne Pages 控制台](https://pages.edgeone.ai/)。
2. 点击 **新建项目**，选择绑定你的 GitHub 仓库（Fork 本项目）。
3. 构建参数配置：
   - **根目录**：`./`
   - **安装命令**：`npm install`
   - **编译命令**：留空
   - **输出目录**：`public`
   - **Node.js 版本**：`20`
4. 点击 **确定并开始构建**，部署完成后即可获得免费的 `*.edgeone.app` 二级域名。

### 方式二：EdgeOne CLI 部署

```bash
# 1. 安装项目本地依赖
npm install

# 2. 本地模拟运行测试
node local-dev.js

# 3. 部署到 EdgeOne
edgeone pages deploy
```

---

## 前端 MetingJS 接入示例

在你的网页或者 Hexo / Hugo / WordPress 博客中引入：

```html
<!-- 1. 声明你部署在 EdgeOne 上的 API 地址 -->
<script>
  var meting_api = 'https://你的项目名.edgeone.app/api?server=:server&type=:type&id=:id&auth=:auth&r=:r';
</script>

<!-- 2. 引入 APlayer 和 MetingJS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.css">
<script src="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/meting@2.0.1/dist/Meting.min.js"></script>

<!-- 3. 插入播放器组件 -->
<meting-js
  server="netease"
  type="playlist"
  id="7326220405"
  fixed="true"
  autoplay="false"
  theme="#0066ff">
</meting-js>
```

---

## API 参数规范

请求接口：`GET /api`

| 参数名 | 默认值 | 可选值 | 说明 |
| :--- | :--- | :--- | :--- |
| `server` | `netease` | `netease`, `tencent`, `kugou`, `baidu`, `kuwo` | 音乐平台代码 |
| `type` | `playlist` | `song`, `album`, `search`, `artist`, `playlist`, `lrc`, `url`, `pic` | 请求数据类型 |
| `id` | - | 字符串 / 数字 | 歌曲 ID、歌单 ID 或搜索关键词 |
| `auth` / `token` | - | 字符串 | HMAC 签名 token（未配置 `METING_TOKEN` 环境变量时免鉴权） |

---

## 环境变量说明（可选）

在 EdgeOne Pages 项目的【设置】->【环境变量】中可按需配置：

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `METING_URL` | 自定义绑定的外部访问域名（若不填自动从请求 Host 获取） | `https://music.example.com` |
| `METING_TOKEN` | HMAC-SHA1 签名密钥，配置后开启接口鉴权保护 | `my_secret_token` |
| `FILTER_VIP` | 无 Cookie 状态下是否屏蔽 VIP 试听音轨（默认 `true` 开启屏蔽；设为 `false` 取消屏蔽） | `true` / `false` |
| `METING_COOKIE_NETEASE` | 网易云音乐 VIP 账号 Cookie | `MUSIC_U=xxxx...` |
| `METING_COOKIE_TENCENT` | QQ 音乐 VIP 账号 Cookie | `uin=xxxx; qm_keyst=xxxx...` |

---

## 开源致谢与许可

- 本项目基于 [metowolf/Meting-API](https://github.com/metowolf/Meting-API) 重构适配。
- 核心引擎依赖 [@meting/core](https://www.npmjs.com/package/@meting/core)。
- 许可协议：[MIT License](LICENSE)。

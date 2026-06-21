# Slack 风格群聊 · 匿名树洞

基于 **Supabase Realtime** + 原生 HTML/CSS/JS 三件套构建的实时聊天应用，已部署在 **Cloudflare Pages**。

## ✨ 功能特性

- **Slack 风格深色 UI** — 工作区栏 / 频道列表 / 聊天主区三栏布局
- **多频道群聊** — general / random / tech 等频道自由切换
- **匿名树洞** — 🌳 treehole 频道自动匿名，保护隐私
- **实时消息** — 基于 Supabase Postgres Changes，新消息即时推送
- **在线状态** — Presence 实时显示在线成员列表与人数
- **打字指示器** — Broadcast 广播 "正在输入…" 状态
- **表情反应** — 消息可添加 / 取消 emoji 反应，实时同步
- **消息历史** — 进入频道自动加载最近 200 条历史
- **日期分隔** — 自动按天插入日期分隔线
- **消息删除** — 自己发送的消息可删除
- **头像颜色** — 登录时选择个人头像颜色
- **表情面板** — 输入框内置 emoji 选择器

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML + CSS + JavaScript (无框架) |
| 实时 | Supabase Realtime v2 (Postgres Changes + Presence + Broadcast) |
| 数据库 | Supabase Postgres |
| 部署 | Cloudflare Pages |

## 📦 快速开始

### 1. 创建 Supabase 项目

1. 前往 [supabase.com](https://supabase.com) 创建新项目
2. 在 **SQL Editor** 中执行 `schema.sql` 全部内容
3. 在 **Dashboard > Settings > API Keys** 中获取：
   - Project URL
   - Publishable Key (`sb_publishable_...`)

### 2. 配置前端

编辑 `app.js` 顶部配置区：

```javascript
const SUPABASE_URL  = 'https://你的项目.supabase.co';
const SUPABASE_ANON = '你的_sb_publishable_KEY';
```

### 3. 本地运行

直接用浏览器打开 `index.html` 即可，或启动本地服务器：

```bash
npx serve .
# 或
python3 -m http.server 8080
```

## ☁️ 部署到 Cloudflare Pages

### 方式一：Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name realtime-chat
```

### 方式二：Git 连接

1. 将代码推送到 GitHub 仓库
2. Cloudflare Dashboard > Pages > Create a project > Connect to Git
3. 构建命令留空，输出目录填 `/`
4. 部署完成

### 方式三：直接上传

1. Cloudflare Dashboard > Pages > Create a project > Direct Upload
2. 拖入 `index.html`、`style.css`、`app.js` 三个文件
3. 部署

## 📁 文件结构

```
.
├── index.html      # 页面结构
├── style.css       # Slack 深色主题样式
├── app.js          # Supabase Realtime 逻辑
├── schema.sql      # 数据库建表 + RLS + Realtime 发布
└── README.md       # 本文件
```

## 🔒 安全提示

`schema.sql` 中的 RLS 策略为演示用途，开放了匿名读写。生产环境请：
- 关闭 `anon` 角色写入权限
- 启用 Supabase Auth 认证
- 添加基于 `auth.uid()` 的行级安全策略
- 对树洞频道考虑使用数据库函数隐藏真实 user_id

## 📡 Realtime 工作原理

```
用户A 发送消息
    │
    ▼
INSERT INTO messages  ──►  Postgres WAL
                                │
                    ▼           │
            supabase_realtime publication
                                │
                    ▼           │
            Realtime Server (WebSocket)
                    │           │
        ┌───────────┴───────────┘
        ▼                       ▼
    用户A 收到 INSERT        用户B 收到 INSERT
    (Postgres Changes)       (Postgres Changes)
```

- **Postgres Changes**：消息和反应的增删实时同步
- **Presence**：在线成员状态追踪
- **Broadcast**：打字指示器低延迟广播

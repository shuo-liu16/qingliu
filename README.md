# 清流

> 信息太多，读这一页。

把 13 个信息源压成每天 8 条精选的阅读应用。自动去重、合并同一事件的重复报道、按兴趣排序。
不需要服务器：抓取由 GitHub Actions 定时执行，页面托管在 GitHub Pages 上。

## 它怎么自动更新

```
GitHub Actions（每 30 分钟）
   └─ node scripts/build-static.js
        ├─ 并发抓取 sources.json 里的 RSS
        ├─ 抽取摘要 / 分类 / 按标题聚类去重
        └─ 输出 dist/data/news.json
   └─ 发布 dist/ 到 GitHub Pages
        └─ 打开链接就是最新的
```

页面本身是纯静态的：优先请求实时接口（本地跑 `server.js` 时），拿不到就读构建好的 `data/news.json`。
所以同一套前端既能本地开发，也能直接托管在 Pages 上。

## 部署（约 3 分钟）

1. 在 GitHub 新建一个仓库（public 才免费支持 Pages）。
2. 推送这个目录：
   ```bash
   git remote add origin https://github.com/<你的用户名>/qingliu.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**。

推上去之后 Actions 会自动跑第一次，链接是 `https://<用户名>.github.io/qingliu/`。
之后每 30 分钟自动更新，手机浏览器打开 → 分享 → 添加到主屏幕，就是一个 App。

## 加源 / 换源

编辑根目录的 `sources.json`，提交后下一次运行就会生效：

```json
{ "name": "少数派", "url": "https://sspai.com/feed", "weight": 9, "cat": "depth", "lang": "zh" }
```

- `weight`：0-10，信息密度权重，影响排序
- `cat`：`ai` / `product` / `business` / `depth` / `engineering` / `science`（无关键词命中时的兜底分类）
- `lang`：`zh` / `en`

## 本地开发

```bash
npm start                 # http://localhost:4173，带实时抓取和接口
node scripts/build-static.js   # 只生成静态产物到 dist/
```

本地模式下可以实时添加 RSS 源（会验证可读性）；静态模式下加源只能改 `sources.json`。

## 目录

```
server.js              本地/自建服务器（接口 + 静态文件）
lib/feed.js            RSS/Atom 抓取解析、编码识别、正文摘要兜底
lib/pipeline.js        摘要抽取、分类、IDF 加权聚类
lib/payload.js         数据包组装（两种模式共用）
lib/sources.js         源配置加载
sources.json           信息源列表（改这里就能加源）
public/                前端，无框架无构建
scripts/build-static.js 静态构建
scripts/shot.js        截图自测工具（CDP）
```

## 已知限制

- GitHub 的 cron 有延迟，高峰时段可能晚 5-20 分钟；每次运行的抓取时间也不保证精确。
- 公开仓库的定时工作流在**连续 60 天无提交**后会被自动停用，随便提交一次即可恢复（或点 Actions 里的 Enable）。
- 页面首屏约 40KB（gzip 后），数据包 37KB / 次。
- RSS 全文摘要靠首段抽取，属于「够用来判断值不值得读」，不是精读替代品。

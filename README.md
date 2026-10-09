# 飞翔的瓦莲娜

基于《雪松》角色创作的非商业 Flappy Bird 类小游戏。控制 Q 版瓦莲娜，在火箭、卫星和小行星之间飞向地球。

**[在线游玩](https://flying-valenna.pages.dev/)** · [离线 HTML](dist/飞翔的瓦莲娜.html) · [在线静态包](dist/web/packages/valenna-online-r05.zip)

## 开始游戏

在线版直接打开上面的链接。离线版下载 `dist/飞翔的瓦莲娜.html` 后，用浏览器打开；图片、音乐、音效和代码均已内嵌，不需要服务器或联网下载资源。文件预览器可能不执行游戏，请使用浏览器。

支持桌面、手机和平板浏览器，触屏设备建议竖屏使用。

## 操作与模式

- 点击、轻触、空格或 ↑：向上飞。
- P、Esc 或右上角按钮：暂停与继续。
- 碰撞后点击“再飞一次”重新起飞；音乐保持当前进度。
- 电台支持选曲、下一首、音乐与音效音量、静音。
- 标准与塔尔西斯X最高分分别保存在当前浏览器。

| 模式 | 玩法 |
| --- | --- |
| 标准 | 常规无尽飞行与计分 |
| 塔尔西斯X | 更快航速、更窄通道，按角色头部轮廓判定碰撞 |
| 安泰宇航 | 自动播放成功返航、开伞与着陆动画 |

## 项目结构

- `src/`：原生 Canvas 2D、HTML、CSS、JavaScript 源码。
- `assets/`、`audio/`：游戏美术、音效、音乐和宣传封面。
- `scripts/`：构建、静态包服务与校验工具。
- `tests/`：行为测试及固定基线。
- `dist/`：离线 HTML、最终在线发布目录、清单及 ZIP。

## 本地开发

使用 Node.js 24 和 Sharp 0.35.5；浏览器自动化检查另需 Playwright 1.62.1 及对应浏览器。游戏运行时没有第三方依赖。

```sh
npm install --no-save --package-lock=false sharp@0.35.5
npm test
node scripts/verify-bundle.cjs --evidence-dir evidence/local-check/offline
node scripts/verify-web.cjs --root dist/web/releases/online-r05 --manifest dist/web/manifests/online-r05.json --evidence-dir evidence/local-check/online
```

重新构建离线 HTML：

```sh
npm run build
```

构建新的在线版本并启动本地预览：

```sh
npm run build:web -- --release online-r06
node scripts/serve-web.cjs --root dist/web/releases/online-r06
```

在线构建拒绝覆盖已有发布目录。提交新版本前，应检查 `.gitignore` 的公开文件白名单。测试输出、临时文件和本地开发记录不纳入仓库。

## 来源与许可

本作基于霍尔果斯纳罗达礼炮八号设计局开发的《雪松》手游制作，为非商业二创。角色、原作设定及第三方素材归原权利方所有，音乐来源保留在文件名中。

仓库采用 [CC0 1.0](LICENSE)，仅涉及声明者有权处分的权利，不改变第三方对角色、音乐、参考素材及其衍生内容享有的权利。离线 HTML、在线包及宣传图片包含这些素材，不代表整个交付包均可无条件再利用。参见 [CC0 官方说明](https://creativecommons.org/publicdomain/zero/1.0/)。

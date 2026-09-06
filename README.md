<p align="center">
  <img src="docs/pokepocket.png" alt="Poké Pocket 卡带收藏盘" width="960" />
</p>

<h1 align="center">Poké Pocket</h1>

<p align="center">小小口袋，大大冒险。</p>

<p align="center">
  <a href="https://github.com/nocoo/pokepocket/actions/workflows/ci.yml"><img src="https://github.com/nocoo/pokepocket/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/nocoo/pokepocket/actions/workflows/release.yml"><img src="https://github.com/nocoo/pokepocket/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <img src="https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white" alt="TypeScript 7.0.2" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/Original_code-MIT-739061" alt="Original code: MIT" /></a>
</p>

拟物卡带收藏盘与网页版掌机模拟器。使用 **mGBA WebAssembly 真实执行 GB / GBC / GBA ROM**，随版本切换卡带配色、屏幕和机身边框，支持键盘、触屏、手柄与独立存档。

**[打开收藏盘 · 需要 Cloudflare Access 登录](https://pokepocket.hexly.ai)** · 本地：[pokepocket.dev.hexly.ai](https://pokepocket.dev.hexly.ai)

## 卡带如何载入

| 启动方式                              | 卡带来源                       | 操作                               |
| ------------------------------------- | ------------------------------ | ---------------------------------- |
| `bun run dev`，存在 `roms/` 或 `rom/` | 本机私有目录，按真实文件头识别 | 自动显示就绪，选卡后直接开始       |
| `bun run dev`，没有本地 ROM           | 当前浏览器导入与缓存           | 首次点击「导入卡带」，以后直接开始 |
| 生产部署 / `bun run preview`          | 当前浏览器导入与缓存           | Access 验证后，首次导入自己的卡带  |

本地启动以目录中的 ROM 为用户自备卡带，不再额外询问使用权限。只扫描这两个目录的第一层 `.gb`、`.gbc`、`.gba` 文件，允许自定义文件名，校验硬件文件头、版本与容量；忽略无效文件及符号链接。同一版本优先使用 `roms/`，目录内按文件名选择第一份有效文件。不同语言、修订版也可通过拖放单独导入。

卡带存在并不意味着同时下载全部游戏：只在开始或切换版本时读取选中的文件。ROM 与进度以 ROM 的 SHA-256 区分，保存在 **IndexedDB**；键位和显示偏好保存在 **localStorage**。导入操作在浏览器完成，不上传 ROM、存档或截图。换设备或清理浏览器数据前，请导出 `.sav` 存档。

**仓库与生产部署均不包含 ROM。** `rom/`、`roms/`、ROM 扩展名与存档已忽略；构建前后会检查静态目录、Git 跟踪路径及文件头，发现 ROM 会终止构建。生产 Worker 也不会提供 `/rom/`、`/roms/` 或 ROM 文件路由。

## 支持的系列

卡带盘覆盖 GB / GBC / GBA 的三代掌机正作，共 12 个版本；不包含 NDS、3DS、Switch 游戏。容量为本地固定构建版本的大小，其他语言或修订版可能不同。

| 版本       | 掌机 | 本地文件示例        |    容量 | 参考源码                                                          |
| ---------- | ---- | ------------------- | ------: | ----------------------------------------------------------------- |
| 红         | GB   | `pokered.gb`        |   1 MiB | [pret/pokered](https://github.com/pret/pokered)                   |
| 绿（日版） | GB   | `pokegreen.gb`      | 0.5 MiB | [Narishma-gb/pokegreen](https://github.com/Narishma-gb/pokegreen) |
| 蓝         | GB   | `pokeblue.gb`       |   1 MiB | [pret/pokered](https://github.com/pret/pokered)                   |
| 黄         | GBC  | `pokeyellow.gbc`    |   1 MiB | [pret/pokeyellow](https://github.com/pret/pokeyellow)             |
| 金         | GBC  | `pokegold.gbc`      |   2 MiB | [pret/pokegold](https://github.com/pret/pokegold)                 |
| 银         | GBC  | `pokesilver.gbc`    |   2 MiB | [pret/pokegold](https://github.com/pret/pokegold)                 |
| 水晶       | GBC  | `pokecrystal.gbc`   |   2 MiB | [pret/pokecrystal](https://github.com/pret/pokecrystal)           |
| 红宝石     | GBA  | `pokeruby.gba`      |  16 MiB | [pret/pokeruby](https://github.com/pret/pokeruby)                 |
| 蓝宝石     | GBA  | `pokesapphire.gba`  |  16 MiB | [pret/pokeruby](https://github.com/pret/pokeruby)                 |
| 绿宝石     | GBA  | `pokeemerald.gba`   |  16 MiB | [pret/pokeemerald](https://github.com/pret/pokeemerald)           |
| 火红       | GBA  | `pokefirered.gba`   |  16 MiB | [pret/pokefirered](https://github.com/pret/pokefirered)           |
| 叶绿       | GBA  | `pokeleafgreen.gba` |  16 MiB | [pret/pokefirered](https://github.com/pret/pokefirered)           |

合计 **89.5 MiB**，均留在本机，不计入部署包。参考仓库提供反汇编或反编译源码，`.gba` 是 Game Boy Advance 的格式。可选本机构建脚本的源代码提交、目标与 SHA-1 校验值固定在 [scripts/rom-sources.json](scripts/rom-sources.json)。

```bash
bun run rom:build -- --list
bun run rom:build -- emerald
bun run rom:build -- all
bun run rom:build -- all --verify
```

构建输出在根目录 `roms/`，缓存位于 `.cache/rom-build/`；需要相应的本机编译工具链，GB/GBC 构建使用 RGBDS，GBA 使用 agbcc。CI 和部署不会运行这些命令。

## 开发

Node.js ≥ 22.12，推荐与 CI 一致的 Bun **1.4.0**。前端使用 **Vite 8 / React 19 / TypeScript 7.0.2**，Worker 使用 TypeScript，模拟器核心为 `@thenick775/mgba-wasm` **2.5.1**。

```bash
bun install --frozen-lockfile
bun run dev
```

默认仅监听 **127.0.0.1:7047**；本地 Caddy 转发 `pokepocket.dev.hexly.ai`。构建预览为 **17047**，独立浏览器测试服务为 **27047**，遵循 dev / dev+10000 / dev+20000 的本机端口规则。 生产 HTTP 门禁单独使用 **17048**，避免占用预览端口。

```caddyfile
http://pokepocket.dev.hexly.ai {
    redir https://pokepocket.dev.hexly.ai{uri} permanent
}
pokepocket.dev.hexly.ai {
    tls /Users/nocoo/workspace/personal/workflow/certs/cert.pem /Users/nocoo/workspace/personal/workflow/certs/key.pem
    reverse_proxy 127.0.0.1:7047
}
```

`*.dev.hexly.ai` 的本机 DNS 与 mkcert 通配符证书由个人 workflow 项目维护。其他机器可直接访问 `http://localhost:7047`，或配置自己的受信任 HTTPS 反向代理。mGBA 线程需要 `SharedArrayBuffer`，开发服务器和 Worker 都设置了 COOP / COEP 隔离响应头。

生产预览保持 Access 验证，不读取本地 ROM 目录；无有效 Access JWT 时返回 403。日常本机游玩使用 `bun run dev`。

## 操作与存档

| 操作           | 默认键位         |
| -------------- | ---------------- |
| 方向           | 方向键 / W A S D |
| A / B          | **O / P**        |
| L / R          | Q / E            |
| START / SELECT | Enter / Shift    |
| 暂停           | Space            |
| 临时快进       | 按住反引号       |
| 静音 / 全屏    | M / F            |

设置面板可修改主要与备用键位，检查按键冲突，并持久保存。支持标准 Gamepad API 手柄、移动触屏、三种画面滤镜、快进、音量调节、截图与全屏。

每枚 ROM 有独立的游戏内电池存档、自动恢复点和三个手动即时存档。返回卡带盘会暂停并保存，切换卡带会保留原进度。导入 `.sav` 会丢弃可能覆盖它的旧自动恢复点，保留手动即时存档。加载、替换和清除即时存档均需弹窗确认；取消操作不会改写存档。

全屏模式让掌机居中，字体和按钮随整机同步缩放。截图按原始画面比例导出为 1080 像素高的 PNG：GB / GBC 为 **1200 × 1080**，GBA 为 **1620 × 1080**。

## Cloudflare Access 与部署

公开入口为 **`pokepocket.hexly.ai`**，仅允许 Access 应用中配置的用户访问。仓库中的非秘密配置：

```text
Team:     nocoo
Issuer:   https://nocoo.cloudflareaccess.com
Audience: 7dcaf6fb44b1245dfec144db9df69cc1335a526cd9a29829f33e35f78aa306dd
```

Access 应用应覆盖整个域名，使用明确的用户 / 群组 Allow 策略，游戏内容不设公共 Bypass。Worker 用 `jose` 验证 `Cf-Access-Jwt-Assertion` 的 RS256 签名、issuer、audience、有效期与必要声明，公钥取自团队 JWKS。所有页面、图片、WASM 和游戏 API 都先经过 Worker 验证；`workers.dev` 与预览域名关闭。生产构建会移除本地开发放行逻辑，Host、请求头和查询参数不能开启本地模式。

`GET /api/live` is the only public API: it returns `status` and the version from the root `package.json`. It never reads assets, cartridges, or saves. Subpaths such as `/api/live/catalog` still require authentication.

```bash
bun run cf:typegen
bun run build
bun run deploy:check
bun run deploy
bun run verify:access
bun run verify:release
```

CI 与 Release 共用本仓的 [quality.yml](.github/workflows/quality.yml)，执行与本地相同的质量命令：

- **CI**：push / PR 到 `main` 或手动触发，运行 L1 覆盖率、G1 严格检查、L2 生产 HTTP 契约、G2 安全扫描和 L3 必需浏览器测试，同时保留 `test:http` 与 Worker 类型一致性检查。各 job 核对实际检出的 SHA；只有全部成功且 SHA 一致，汇总才会输出 `tested-sha`。覆盖率报告和浏览器失败产物保留 14 天。
- **Release**：自动发布只接受同仓 `main` 上预期 CI 工作流的成功 push 运行，固定其 `head_sha`。标签推送使用事件中的原始对象，手动发布一次性解析 `refs/tags/vMAJOR.MINOR.PATCH`；标签版本须匹配该提交的 `package.json`。每次发布都为固定目标重新运行完整质量工作流，部署检出其 `tested-sha`；失败、跳过、缺失或 SHA 不一致均不能进入部署。
- 生产部署串行执行。构建和 Access 预检完成后，自动发布重新获取完整的远端 main 引用，紧邻部署再次核验目标。过期目标被拒绝；显式标签和手动发布保留选定提交。
- GitHub repository / `production` environment secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，仅部署 job 使用。Token 需要目标账户 Workers Scripts 编辑、账户读取，以及 `hexly.ai` 的 Workers Routes 编辑和 Zone 读取权限；不存入源码，质量检查不继承部署 secrets。
- 部署前后检查页面、受保护 API、图片、WASM 和 ROM 路径是否重定向到 `nocoo` Access 登录入口；部署后还要求 `/api/live` 返回准确的 package 版本。403 不算登录检查成功；失败会报告 HTTP 状态和 Cloudflare 请求标识。

CF 仅负责访问验证和静态资源交付，CPU、画面、音频和存档都在浏览器中，无需服务端模拟、数据库或 ROM 存储。

## 验证

```bash
bun run quality:commit
bun run test:http
bun run quality:push
bun run quality:l3
bun run test:e2e:optional
```

安装依赖时会启用仓库 hooks。`quality:commit` 并行检查严格 lint、TypeScript、格式和完整单测覆盖率，语句、分支、函数、行四项均要求 ≥90%，提交门禁限时 28 秒。`quality:push` 并行运行真实生产 Worker HTTP 契约和安全扫描，门禁须在 3 分钟内完成。扫描器版本由 [quality-tools.json](scripts/quality-tools.json) 统一固定；本机需先安装对应版本，缺失、版本不符或扫描失败都会阻止通过。CI 按同一清单安装并核验扫描器，依赖扫描读取实际 `bun.lock`，密钥扫描包含完整提交历史；本地 pre-push 按待推送引用扫描，新分支包含全部本地祖先。

`quality:l3` 与 `test:e2e` 是同一个必需入口：在 **127.0.0.1:27047** 启动独立的生产运行时与浏览器，使用原创 GB/GBC/GBA 程序和临时签名令牌，不依赖本地商业 ROM。它拒绝部分用例选择、任意目标/输出覆盖和并发运行，且任何失败、跳过或未执行用例都会阻止通过。报告、失败截图、trace 和下载保存在带所有权标记的 `test-results/required/`；退出时清理运行时、浏览器 profile 和锁；无法确认终止时保留状态与锁并报错。

`test:e2e:optional` 需要本机自备的完整 12 版本卡带，使用同一个独占端口和独立的 `test-results/optional/`。这些验证覆盖应用自身的授权边界，不代表已完成真实 Cloudflare SSO 登录。

测试覆盖 ROM 文件头与版本识别、本机目录检测、Access JWT 与拒绝路径、输入映射、浏览器导入后离线于 ROM 服务的恢复，以及本地 12 版本启动、画面与独立存档。已实测绿宝石角色创建、进入未白镇、游戏内 SAVE 和 `.sav` 导出导入。当前支持单机游玩，暂不支持联机交换与对战；启动与存档验证不代表所有版本均已完整通关。

## Documentation

See the [documentation index](docs/README.md), [6DQ assessment](docs/01-6dq-adoption-plan.md), and
[Tier S execution record](docs/02-6dq-tier-s-execution.md) for the quality requirements, implementation
batches, and current review evidence.

## 来源与许可

本项目原创代码采用 **[MIT](LICENSE)**，版权声明与免责条款仅覆盖有权许可的原创部分。**ROM、宝可梦名称、商标、角色素材及截图中的原作内容不在 MIT 授权范围内**，相关权利归 Nintendo、Game Freak、Creatures 等权利人所有。项目为独立爱好者作品，无官方关联或背书；免责声明及访问控制不会授予游戏内容的使用权。

mGBA WebAssembly 保持未修改，采用 **MPL-2.0**；分发包附带许可证与对应源码地址。角色 PNG 来自 `pret/pokeemerald` 指定提交，字体与其他依赖各自保留许可证。完整出处及许可边界见 **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**。

架构和交互也参考 [Swift-plays-Pokemon](https://github.com/LiarPrincess/Swift-plays-Pokemon) 与 [PokeSwift](https://github.com/Dimillian/PokeSwift)。本项目使用 mGBA 核心，未移植这些项目的 Swift 模拟器实现。

# ReportManager

一个基于 Tauri v2 + Rust + 原生 Web 技术构建的轻量级桌面文档管理工具，专注于 HTML 和 Markdown 文件的浏览、管理与组织。

## 项目简介

ReportManager 解决的核心问题是：在本地管理大量 HTML/Markdown 文档时，缺少一个既能浏览文件树、又能即时预览渲染效果、还支持拖拽整理的轻量工具。

传统方案要么用浏览器逐个打开文件（无法管理文件树、锚点跳转受限），要么用重量级 IDE（启动慢、功能冗余），要么用在线文档平台（数据不在本地）。ReportManager 选择了一条不同的路：用 Tauri v2 提供原生性能，用 vanilla JS 保持极简架构，用 Rust 处理文件系统操作，最终实现一个安装包不到 3MB 的桌面应用。

## 功能特性

### 文件树管理

- 递归扫描目录，自动过滤 `.html` / `.htm` / `.md` / `.markdown` 文件
- 目录展开/折叠，状态自动持久化
- 实时搜索过滤（200ms 防抖），匹配文本高亮显示
- 拖拽自定义排序：同级文件/文件夹可通过拖拽调整显示顺序，排序结果持久化保存

### 文档预览

- HTML 文件直接在 iframe 中渲染，支持完整的 CSS/JS 效果
- Markdown 文件通过 marked.js 解析为 HTML 后渲染，内置代码高亮、表格、引用块等样式
- 大文件加载优化：Blob URL 替代 srcdoc，外部资源自动内联（CSS/JS/图片并行读取）
- 加载指示器，文件打开时有明确的视觉反馈

### 链接导航

- 页内锚点跳转（`#section`）：阻止 iframe 顶层导航，手动平滑滚动到目标元素
- 跨文件链接（`page.html`）：解析相对路径，自动打开目标文件
- 跨文件锚点（`page.html#section`）：先打开文件，加载完成后滚动到锚点
- 外部链接（`https://`）：允许在新窗口打开，阻止当前窗口导航

### 大纲导航

- 自动从文档中提取 H1-H6 标题，生成可点击的大纲列表
- 按标题层级缩进显示，不同级别有差异化样式
- 点击大纲项平滑滚动到对应标题
- 大纲栏默认关闭，按需展开，支持拖拽调整宽度

### 拖拽操作

- 树内拖拽移动：拖拽文件到文件夹上，移动文件到目标目录
- 树内拖拽排序：拖拽文件到同级节点的上方/下方，显示蓝色插入指示线
- OS 文件拖入：从资源管理器拖拽 HTML/MD 文件到侧边栏，自动复制到目标文件夹（重名自动加数字后缀）

### 文件操作

- 新建文件夹、新建 HTML 文档（含模板）、新建 Markdown 文档（含模板）
- 重命名、删除（带确认提示，支持递归删除目录）
- 在系统资源管理器中定位文件（Windows / macOS / Linux 三平台适配）

### 状态持久化

所有应用状态自动保存到 `AppData` 目录下的 `config.json`，重启后恢复：

| 持久化内容 | 说明 |
|-----------|------|
| 上次打开的目录 | 根目录路径 |
| 展开的文件夹 | 目录树展开状态 |
| 当前打开的文件 | 上次浏览的文档 |
| 侧边栏折叠状态 | 左侧边栏是否折叠 |
| 自定义排序 | 每个文件夹的文件排列顺序 |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Tauri v2 (2.11.3) | 跨平台桌面应用框架，Rust 后端 + WebView 前端 |
| 后端 | Rust (Edition 2021) | 文件系统操作、配置管理、平台 API 调用 |
| 前端 | 原生 HTML / CSS / JavaScript | 无框架依赖，无构建工具 |
| Markdown 解析 | marked.js | 本地引入，启用 GFM 和 breaks |
| 序列化 | serde / serde_json | Rust 端文件树结构与配置的序列化 |
| UI | 自定义浅色主题 | CSS 变量系统，无第三方 UI 库 |

选择 vanilla JS 而非 React/Vue 的原因：应用逻辑集中在文件树渲染和 iframe 控制，不需要虚拟 DOM 的 diff 性能；不引入构建工具意味着修改前端代码后无需等待编译，Tauri 直接嵌入 `src/` 目录的静态文件。

## 项目结构

```
ReportManager/
├── src/                          # 前端源码
│   ├── index.html                # 应用主页面
│   ├── main.js                   # 前端全部逻辑
│   ├── marked.min.js             # Markdown 解析库
│   └── styles.css                # 全部样式
├── src-tauri/                    # Tauri 后端
│   ├── src/
│   │   ├── lib.rs                # Rust 核心逻辑（18 个 Tauri commands）
│   │   └── main.rs               # 程序入口
│   ├── Cargo.toml                # Rust 依赖配置
│   ├── tauri.conf.json           # Tauri 应用配置
│   ├── capabilities/
│   │   └── default.json          # 权限配置
│   └── icons/                    # 应用图标
├── package.json                  # npm 配置
└── README.md
```

## 快速开始

### 环境要求

- [Rust](https://www.rust-lang.org/) 1.77.2 或更高版本
- [Node.js](https://nodejs.org/) 18+ 和 npm
- Windows: 需要 WebView2 Runtime（Windows 10/11 通常已预装）
- macOS: 需要 Xcode Command Line Tools
- Linux: 需要 `webkit2gtk` 等系统依赖（参考 [Tauri 文档](https://tauri.app/start/prerequisites/)）

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

开发模式下 Tauri 会监听文件变化，修改 Rust 代码后自动重新编译。前端文件修改后刷新窗口即可生效。

### 构建打包

```bash
# 构建生产版本（生成 exe / msi / dmg / AppImage）
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录下：

| 平台 | 产物 |
|------|------|
| Windows | `ReportManager_0.2.0_x64-setup.exe` (NSIS) / `.msi` (WiX) |
| macOS | `.dmg` / `.app` |
| Linux | `.deb` / `.AppImage` / `.rpm` |

## 架构设计

### 前后端通信

前端通过 Tauri 的 `invoke` API 调用 Rust 后端命令，所有文件系统操作都在 Rust 端完成：

```
前端 (main.js)                    后端 (lib.rs)
    │                                  │
    │  invoke('list_directory', ...)   │
    │ ───────────────────────────────> │
    │                                  │  fs::read_dir()
    │                                  │  build_tree()
    │  <─── Vec<TreeNode> ──────────── │
    │                                  │
    │  invoke('read_html_file', ...)   │
    │ ───────────────────────────────> │
    │                                  │  fs::read_to_string()
    │  <─── String ─────────────────── │
    │                                  │
    │  invoke('save_config', ...)      │
    │ ───────────────────────────────> │
    │                                  │  fs::write(config.json)
    │  <─── Ok(()) ─────────────────── │
```

Rust 端暴露的 18 个命令覆盖了文件管理、配置持久化、系统交互的全部需求：

| 命令 | 功能 |
|------|------|
| `list_directory` | 递归扫描目录，返回文件树 |
| `read_html_file` | 读取文件内容为字符串 |
| `pick_folder` | 弹出系统文件夹选择对话框 |
| `create_folder` | 创建文件夹 |
| `create_html_file` | 创建 HTML/MD 文件（含模板） |
| `delete_path` | 删除文件或目录（递归） |
| `rename_path` | 重命名文件或目录 |
| `move_path` | 移动文件到目标目录 |
| `copy_file` | 复制文件或目录 |
| `write_file_bytes` | 通过字节数据写入文件（用于 OS 拖入） |
| `get_file_info` | 获取文件元信息 |
| `path_exists` | 判断路径是否存在 |
| `open_in_explorer` | 在系统资源管理器中打开 |
| `get_default_documents_dir` | 获取默认文档目录 |
| `read_file_base64` | 读取文件为 Base64 |
| `read_file_data_uri` | 读取文件为 data URI |
| `save_config` | 保存配置到磁盘 |
| `load_config` | 从磁盘读取配置 |

### 渲染策略

HTML 文件通过 Blob URL 加载到 sandbox iframe 中渲染。选择 Blob URL 而非 `srcdoc` 的原因是：`srcdoc` 需要将整个 HTML 字符串序列化为属性值，浏览器需要二次解析，大文件性能明显下降。Blob URL 创建虚拟文件 URL，iframe 直接作为普通页面加载，同时可以在切换文件时通过 `URL.revokeObjectURL` 释放内存。

外部资源（CSS、JS、图片）通过 Rust 端读取文件内容后内联到 HTML 中。这一过程在 `inlineExternalResources` 函数中完成：先用快速正则检测是否存在外部资源，有则收集所有匹配位置，通过 `Promise.allSettled` 并行读取，最后增量拼接结果字符串（避免在大字符串上反复执行 `replace`）。

### 链接拦截

iframe 中的链接点击通过父窗口在 `contentDocument` 上绑定的捕获阶段事件监听器拦截，而非向 iframe 内注入脚本。这样做的好处是不受 CSP 限制、不依赖 HTML 结构匹配 `</body>` 标签、执行时机更可靠。

在 `srcdoc` 或 Blob URL 模式下，浏览器默认的锚点导航行为会将 `about:srcdoc#anchor` 或 `blob:...#anchor` 应用到顶层窗口，导致整个应用被重新加载。因此所有 `#` 开头的链接都被 `preventDefault()` 拦截，改用 `getElementById` 定位目标元素后调用 `scrollIntoView` 平滑滚动。

### 拖拽系统

应用同时支持两种拖拽来源，通过 `state.draggedNode` 区分：

- 当 `draggedNode` 有值时，是树内拖拽（HTML5 Drag-and-Drop API 触发）
- 当 `draggedNode` 为空且 `dataTransfer` 包含 `Files` 时，是 OS 文件拖入

树内拖拽根据鼠标在目标节点上的 Y 坐标位置判断操作类型：

| 鼠标位置 | 目标类型 | 操作 |
|---------|---------|------|
| 上半部分 | 同级节点 | 插入到该节点前面（排序） |
| 下半部分 | 同级节点 | 插入到该节点后面（排序） |
| 中间区域 | 文件夹 | 移入该文件夹 |

排序操作不移动磁盘文件，仅更新 `config.json` 中的 `customOrders` 字段（格式为 `{ "文件夹路径": ["文件名1", "文件名2", ...] }`），渲染时通过 `applyCustomOrder` 函数按自定义顺序排列节点。

### 配置持久化

配置存储在 Tauri 标准的 `app_data_dir` 目录下（Windows 为 `C:\Users\<用户名>\AppData\Roaming\com.report.manager\config.json`），使用 JSON 格式。选择文件存储而非 WebView2 的 `localStorage` 是因为后者在某些环境下可能被清除。

保存操作使用 500ms 防抖，避免频繁展开/折叠文件夹时产生过多磁盘写入。初始化阶段通过 `isInitializing` 标志跳过保存，防止覆盖刚读取的配置。

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+O` | 打开目录 |
| `Ctrl+R` / `F5` | 刷新文件树 |
| `Ctrl+B` | 切换侧边栏显示/隐藏 |

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。

## 贡献

欢迎提交 Issue 和 Pull Request。

### 开发约定

- 前端代码不引入框架和构建工具，保持 vanilla JS
- Rust 代码通过 `tauri::command` 暴露给前端，命令命名使用 `snake_case`
- CSS 使用变量系统管理主题颜色，便于未来扩展深色主题
- 所有用户可见的文件系统操作都需要错误处理和 Toast 通知

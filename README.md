# Draw.io Quick Launcher

这是一个 Chrome 浏览器扩展，旨在帮助用户快速将 Draw.io 的 XML 代码或 Mermaid 代码在 [diagrams.net](https://app.diagrams.net/) (即 Draw.io) 中打开并预览。特别优化了在 ChatGPT、Claude、Gemini等 AI 网站上的使用体验。

## ✨ 功能特点

* **右键菜单支持**：选中网页上的任意 Draw.io XML 或 Mermaid 文本，右键点击 "Open in Draw.io" 即可直接打开预览。
* **智能代码块检测**：在 ChatGPT, Claude.ai, Gemini 等网站上，自动识别包含 Draw.io XML 或 Mermaid 的代码块。
* **一键打开按钮**：在检测到的 XML / Mermaid 代码块旁自动注入悬浮的 "Open in Draw.io" 按钮，无需手动复制粘贴。
* **流式生成支持**：完美支持 AI 对话的流式输出，在内容生成过程中或完成后自动添加操作按钮。
* **Mermaid 原生支持**：无需转换，直接将 Mermaid 文本通过 diagrams.net 打开预览。

## 🚀 安装说明

1. 下载本项目源代码到本地。
2. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
3. 打开右上角的 **"开发者模式" (Developer mode)** 开关。
4. 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)** 按钮。
5. 选择包含 `manifest.json` 文件的项目根目录。

## 📖 使用方法

### 方法一：右键菜单

1. 在任意网页中选中一段 Draw.io XML 或 Mermaid 代码：
   * Draw.io 通常以 `<mxfile ...` 或 `<mxGraphModel ...` 开头。
   * Mermaid 常见以 `graph TD`, `flowchart`, `sequenceDiagram` 等关键词开头。
2. 点击鼠标右键。
3. 选择上下文菜单中的 **"Open in Draw.io"**。
4. 扩展会自动识别格式，在新标签页中通过 diagrams.net 打开预览。

### 方法二：AI 网站快捷按钮

1. 在 ChatGPT、Claude 或 Gemini 页面中。
2. 当 AI 生成了 Draw.io 的 XML 或 Mermaid 代码块时，代码块区域（通常在右上角或顶部）会自动出现一个橙色的 **"Open in Draw.io"** 按钮。
3. 直接点击该按钮即可预览图表。

## 🔒 隐私与权限

* **权限**：
  * `contextMenus`: 用于添加右键菜单项。
  * `activeTab` / 站点权限: 仅用于在特定 AI 网站（*.google.com, *.chatgpt.com, claude.ai）上注入辅助按钮脚本。
* **隐私**：本扩展完全在本地运行，不会收集任何用户数据。XML、Mermaid数据通过 URL 传递，仅发往官方的 diagrams.net 网站。

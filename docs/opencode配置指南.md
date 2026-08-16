# OpenCode CLI 新机配置指南

> 在新电脑上从零配置 OpenCode（AI 编码代理），用于开发 NativeMind。

## 一、安装

**Windows**（npm 或 Chocolatey）：
```bash
npm install -g opencode-ai     # 需先装 Node.js ≥18
# 或
choco install opencode
```

**macOS / Linux**：
```bash
brew install anomalyco/tap/opencode   # 推荐（最新版）
# 或 npm install -g opencode-ai
```

验证：`opencode --version`

## 二、配置模型

OpenCode 支持 75+ 提供商 + 本地模型，三种主流选择：

### 方案 A：DeepSeek（云端，推荐）
```bash
opencode auth login        # 选 deepseek，粘贴 API key
```
全局默认模型 `~/.config/opencode/opencode.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-chat",
  "small_model": "deepseek/deepseek-chat"
}
```

### 方案 B：OpenCode Zen（官方推荐）
TUI 里 `/connect` → 选 opencode → opencode.ai/auth 拿 key → 粘贴。

### 方案 C：本地模型（Ollama）
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": {
        "qwen2.5-coder:14b": { "name": "Qwen2.5 Coder 14B" }
      }
    }
  },
  "model": "ollama/qwen2.5-coder:14b"
}
```

> 凭据存储：`/connect` 后存在 `~/.local/share/opencode/auth.json`
> （Windows: `%LOCALAPPDATA%\opencode`）。项目内可用 `.env` 或 `{env:API_KEY}` 引用。

## 三、进入项目初始化

```bash
cd NativeMind
opencode        # 启动 TUI
```
首次运行 `/init` 生成/复用 `AGENTS.md`（NativeMind 已有，直接生效）。

项目级 `opencode.json`（NativeMind 根目录）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-chat",
  "provider": {
    "deepseek": { "options": { "baseURL": "https://api.deepseek.com" } }
  }
}
```

## 四、常用命令

| 命令 | 作用 |
|---|---|
| `opencode` | 交互式 TUI |
| `opencode run "修复这个 bug"` | 单次非交互执行 |
| `opencode auth list` | 查看已配置提供商 |
| `opencode models --refresh` | 列出/刷新模型 |
| `/models` | TUI 内切换模型 |
| `opencode --continue` | 继续上次会话 |
| `opencode agent create` | 创建自定义代理 |

## 五、NativeMind 特别提示

1. **密钥安全**：`opencode.json` 用 `{env:DEEPSEEK_API_KEY}` 引用系统环境变量，勿硬编码
2. **本地模型可选**：`setup_ollama.bat` 装好 Ollama 后，opencode 也能用本地模型省 token
3. **AGENTS.md 自动生效**：分层铁律 / 确认门 / 事件系统规范自动加载
4. **权限控制**：全局配置可加 `permission`（如 `"edit": "allow"`、`"bash": "ask"`）

## 六、配置优先级

```
远程组织 < 全局(~/.config/opencode) < OPENCODE_CONFIG 环境变量
       < 项目 opencode.json < .opencode/ < OPENCODE_CONFIG_CONTENT
```

## 七、常用环境变量

| 变量 | 用途 |
|---|---|
| `OPENCODE_CONFIG` | 指定配置文件路径 |
| `OPENCODE_CONFIG_DIR` | 指定配置目录 |
| `OPENCODE_DISABLE_AUTOUPDATE` | 禁用自动更新 |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | 禁用 LSP 自动下载 |
| `OPENCODE_DISABLE_CLAUDE_CODE` | 禁用读取 `.claude`（提示词+技能） |
| `OPENCODE_PERMISSION` | 内联权限配置 |

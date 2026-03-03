# Copilot Provider Helper

让 GitHub Copilot Chat 支持自托管 GitHub Enterprise Server (GHE) 的认证辅助插件。

## 快速开始

### 方法 1：完整配置向导（推荐）

1. 打开命令面板：`Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac)
2. 输入 `Copilot Provider: Setup`
3. 输入你的 GHE 地址（如 `https://github.mycompany.com`）
4. 在弹出的浏览器中完成 OAuth 登录
5. 选择"自动配置"
6. 重新加载 VS Code

### 方法 2：快速登录

1. `Ctrl+Shift+P` / `Cmd+Shift+P` → 输入 `Copilot Provider: Sign In`
2. 输入 GHE 地址（首次使用）
3. 完成 OAuth 登录
4. 重新加载 VS Code

### 检查状态

`Ctrl+Shift+P` / `Cmd+Shift+P` → `Copilot Provider: Check Status`

## 工作原理

1. 设置 `github-enterprise.uri` 配置
2. 获取 GitHub Enterprise OAuth session（scopes: `user:email`）
3. 设置 `github.copilot.advanced.authProvider = "github-enterprise"`
4. Copilot Chat 识别到 GHE session 后，使用 GHE token 请求 Copilot 服务

## 命令列表

| 命令 | 说明 |
|------|------|
| `Copilot Provider: Setup` | 完整配置向导 |
| `Copilot Provider: Sign In` | 快速登录 |
| `Copilot Provider: Check Status` | 查看配置状态 |
| `Copilot Provider: Open Settings` | 打开 settings.json |

## 前提条件

- 你的 GHE 实例需要启用 Copilot Business/Enterprise 授权
- GHE 需要配置好 OAuth App 或支持设备码登录
- 需要安装官方 GitHub Copilot Chat 插件

## 注意事项

- 每次更改配置后需要 **重新加载 VS Code**
- 如果 Copilot 仍然无法工作，检查 Output → GitHub Copilot Chat 日志
- 确保 `github.copilot.advanced.authProvider` 设置为 `github-enterprise`

## License

MIT

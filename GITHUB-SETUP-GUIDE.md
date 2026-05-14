# GitHub 仓库创建与本地关联操作步骤

## 前提条件
- 已安装 Git
- 已安装 GitHub CLI (`gh`)
- 已登录 GitHub 账户 (`gh auth login`)

## 操作步骤

### 1. 检查当前目录状态
```bash
git status
gh auth status
```

### 2. 初始化本地 Git 仓库（如尚未初始化）
```bash
git init
git add .
git commit -m "Initial commit"
```

### 3. 创建 GitHub 仓库并推送
使用 `gh repo create` 命令创建远程仓库：

```bash
# 公开仓库
gh repo create <仓库名称> --public --source=. --push

# 私有仓库
gh repo create <仓库名称> --private --source=. --push
```

参数说明：
- `--public`：创建公开仓库（改为 `--private` 则为私有）
- `--source=.`：指定本地代码目录（当前目录）
- `--push`：推送本地代码到远程

### 4. 验证关联结果
```bash
# 查看远程仓库配置
git remote -v

# 查看提交历史
git log --oneline
```

## 本次操作记录

- **仓库名称**: touch-fish-tool
- **仓库地址**: https://github.com/longlong007/touch-fish-tool
- **远程别名**: origin
- **分支**: main
- **创建时间**: 2026-05-14
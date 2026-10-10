# 安全策略

Languages: [English](SECURITY.md) · **简体中文**

## 报告安全漏洞

**请不要**为安全问题开公开 issue。
请改用 GitHub 的[私密漏洞报告](../../security/advisories/new)，或直接联系维护者。

报告时请说明：发现的问题、复现方式、以及你认为的影响范围。

## 凭据绝不属于本仓库

本插件把用户的 TokenHub API Key 存在**仓库之外**：

```
~/.dsh/hunyuan-image/hunyuan-image-config.json
```

图库索引（`hunyuan-image-gallery.json`）也在同一目录下。

**这些文件一律不可提交。** 它们已写进 `.gitignore`，同时
`scripts/check-no-secrets.mjs` 会在每次 CI 时扫描**工作区**与**完整 Git 历史**中的凭据特征串。

### 给贡献者

提交 PR 之前请先跑：

```bash
pnpm check:secrets     # 扫描工作区 + 完整 Git 历史
pnpm verify            # 密钥扫描 + 类型检查 + 激活冒烟测试
```

若扫描报出任何问题，**不要推送**，先把凭据从文件里移除。

### 如果不慎提交了凭据

在新提交里删掉文件**是不够的**——密钥仍留在历史里，也存在于每个克隆中。你必须：

1. **立刻在腾讯云控制台轮换（作废）该凭据。** 一旦推送出去就应当视为已泄露。
2. 从历史中移除（`git filter-repo`，或联系 GitHub Support 清除缓存视图）。
3. 强制推送，并请协作者重新克隆。

**轮换是第一位的**——只有这一步才真正止住泄露。

## 支持的版本

只有最新发行版会收到安全修复。

| 版本 | 是否支持 |
|---|---|
| 1.0.x | ✅ |
| < 1.0 | ❌ |

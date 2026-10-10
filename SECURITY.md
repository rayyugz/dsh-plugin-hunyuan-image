# Security Policy

Languages: **English** · [简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Please **do not** open a public issue for security problems.
Use GitHub's [private vulnerability reporting](../../security/advisories/new) instead,
or contact the maintainer directly.

Please include: what you found, how to reproduce it, and the impact you believe it has.

## Credentials never belong in this repository

This plugin stores the user's TokenHub API Key **outside the repository**, at:

```
~/.dsh/hunyuan-image/hunyuan-image-config.json
```

The gallery index (`hunyuan-image-gallery.json`) lives in the same directory.

**None of these files may ever be committed.** They are listed in `.gitignore`, and
`scripts/check-no-secrets.mjs` additionally scans the working tree *and the full git history*
for credential-shaped strings on every CI run.

### For contributors

Before opening a pull request:

```bash
pnpm check:secrets     # scan the working tree + entire git history
pnpm verify            # secret scan + type check + activation smoke test
```

If the scan reports anything, do **not** push. Remove the credential from the file first.

### If a credential was committed by accident

Deleting the file in a new commit is **not enough** — the secret remains in the history and in
every clone. You must:

1. **Rotate (revoke) the credential immediately** in the Tencent Cloud console. Treat it as
   compromised the moment it is pushed.
2. Remove it from history (`git filter-repo`, or GitHub Support for a cached view).
3. Force-push and ask collaborators to re-clone.

Rotation comes first: it is the only step that actually stops the leak.

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
|---|---|
| 1.0.x | ✅ |
| < 1.0 | ❌ |

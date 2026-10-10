/**
 * 密钥泄露检查器 —— 在提交 / CI 阶段拦截误上传的凭据。
 *
 * 背景：本插件的运行时数据（`hunyuan-image-config.json` 里存着用户的
 * TokenHub API Key）位于 `~/.dsh/hunyuan-image/`，**在仓库目录之外**。
 * 但只要有人为了调试把它拷进仓库，或者写文档时贴了真实 Key，就会泄露。
 * 这个脚本把「靠人记得」变成「机器每次强制检查」。
 *
 * 用法：
 *   node scripts/check-no-secrets.mjs              # 扫描工作区（默认）
 *   node scripts/check-no-secrets.mjs --git-history # 额外扫描全部 git 历史对象
 *
 * 退出码：0 = 干净，1 = 发现疑似凭据
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 疑似凭据的匹配规则。
 *
 * 说明：这里刻意用「长随机串」而非「sk- 开头」单独判定 —— 文档里的
 * `sk-xxxxxxxx` / `sk-...` 等占位符是合法的，不该误报。
 */
const RULES = [
  { name: 'TokenHub / OpenAI 风格密钥', re: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  { name: 'GitHub Token', re: /\b(gho|ghp|ghs|ghu)_[A-Za-z0-9]{30,}\b/g },
  { name: '腾讯云 SecretId', re: /\bAKID[A-Za-z0-9]{28,}\b/g },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: '私钥内容', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
];

/** 该文件是否应当被跳过（二进制 / 依赖 / 构建产物 / 本脚本自身） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.github']);
const SKIP_FILE = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|node)$/i;

/** 运行时数据文件名：一旦出现在仓库里，本身就是高危信号 */
const FORBIDDEN_FILES = [
  'hunyuan-image-config.json',
  'hunyuan-image-gallery.json',
  '.credentials.yaml',
  'secrets.json',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (!SKIP_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 把命中位置所在的整行做脱敏后返回，便于定位但不回显密钥 */
function redact(line, match) {
  return line.replace(match, match.slice(0, 6) + '…[已脱敏]');
}

const findings = [];

// ── 1. 扫描工作区文件内容 ──
for (const file of walk(ROOT)) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // 非 UTF-8 文件跳过
  }
  const lines = text.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      const hits = line.match(rule.re);
      if (hits) {
        for (const h of hits) {
          findings.push({
            where: `${relative(ROOT, file)}:${i + 1}`,
            rule: rule.name,
            sample: redact(line.trim(), h).slice(0, 120),
          });
        }
      }
    });
  }
}

// ── 2. 检查运行时数据文件是否混入仓库 ──
for (const file of walk(ROOT)) {
  const base = file.split('/').pop();
  if (FORBIDDEN_FILES.includes(base)) {
    findings.push({
      where: relative(ROOT, file),
      rule: '运行时数据文件（可能含 API Key）',
      sample: '该文件不应存在于仓库中',
    });
  }
}

// ── 3. 可选：扫描全部 git 历史对象 ──
if (process.argv.includes('--git-history')) {
  console.log('[check] 扫描 git 历史对象…');
  let objects = [];
  try {
    objects = execSync('git rev-list --objects --all', { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((l) => l.split(' ')[0])
      .filter(Boolean);
  } catch {
    console.warn('[check] 不是 git 仓库或无法读取历史，跳过');
  }
  for (const sha of objects) {
    let type;
    try {
      type = execSync(`git cat-file -t ${sha}`, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      continue;
    }
    if (type !== 'blob') continue;
    let body;
    try {
      body = execSync(`git cat-file -p ${sha}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      continue;
    }
    for (const rule of RULES) {
      if (rule.re.test(body)) {
        findings.push({
          where: `git object ${sha.slice(0, 10)}`,
          rule: rule.name,
          sample: '历史对象中含疑似凭据',
        });
      }
      rule.re.lastIndex = 0;
    }
  }
}

// ── 输出结果 ──
if (findings.length === 0) {
  console.log('✅ 未发现任何疑似凭据或运行时数据文件');
  process.exit(0);
}

console.error('❌ 发现 ' + findings.length + ' 处疑似凭据：\n');
for (const f of findings) {
  console.error(`  位置: ${f.where}`);
  console.error(`  类型: ${f.rule}`);
  console.error(`  内容: ${f.sample}`);
  console.error('');
}
console.error('请立即处理：');
console.error('  1. 从文件中移除凭据（改为占位符或从环境变量读取）');
console.error('  2. 若已提交过，务必轮换（作废）该凭据 —— 仅删文件不足以撤销泄露');
console.error('  3. 若已推送，需重写历史或视为已泄露');
process.exit(1);

#!/usr/bin/env node
/**
 * pr-up.js
 *
 * 1. main/master ブランチガード
 * 2. npm test
 * 3. gen-pr-body.js → /tmp/pr.md 生成
 * 4. pr-body-verify.js バリデーション
 * 5. git push
 * 6. gh pr create / gh pr edit
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function shRaw(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function resolveVoltaBin() {
  const candidates = [];
  if (process.env.VOLTA_HOME) {
    candidates.push(path.join(process.env.VOLTA_HOME, "bin", "volta"));
  }
  candidates.push("/home/codespace/.volta/bin/volta");
  candidates.push("volta");
  for (const candidate of candidates) {
    const r = shRaw(candidate, ["--version"], { timeout: 3000 });
    if (r.status === 0) {
      return candidate;
    }
  }
  return null;
}

const VOLTA_BIN = resolveVoltaBin();
const HAS_VOLTA = Boolean(VOLTA_BIN);
const VOLTA_TARGETS = new Set(["node", "npm", "npx"]);

function shNodeTool(cmd, args, opts = {}) {
  if (HAS_VOLTA && VOLTA_TARGETS.has(cmd)) {
    return shRaw(VOLTA_BIN, ["run", cmd, ...args], opts);
  }
  return shRaw(cmd, args, opts);
}

function must(cmd, args, opts = {}) {
  const r = shNodeTool(cmd, args, opts);
  if (r.status !== 0) {
    const out = ((r.stdout || "") + "\n" + (r.stderr || "")).trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (code=${r.status})\n${out}`);
  }
  return (r.stdout || "").trim();
}

function info(msg) { process.stdout.write(msg + "\n"); }
function warn(msg) { process.stderr.write(msg + "\n"); }

function tailText(text, lines = 12) {
  if (!text) return "";
  const arr = String(text).split("\n");
  return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

// "owner/repo" を git remote から取得（ssh / https どちらにも対応）
function getRepoNwo() {
  const r = shNodeTool("git", ["remote", "get-url", "origin"]);
  if (r.status !== 0) throw new Error("git remote get-url origin failed: " + (r.stderr || "").trim());
  const url = (r.stdout || "").trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (m) return m[1];
  throw new Error(`Cannot parse GitHub repo NWO from remote URL: ${url}`);
}

// リポジトリの default branch を gh repo view で取得（失敗時は "main"）
function getDefaultBranch(repoNwo) {
  const r = shNodeTool("gh", ["repo", "view", repoNwo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  if (r.status === 0) {
    const name = (r.stdout || "").trim();
    if (name) return name;
  }
  warn(`[PR-UP] Could not detect default branch, falling back to "main"`);
  return "main";
}

function printFallback({ branch, repoNwo, defaultBranch, title }) {
  info("\n[PR-UP] Push/PR作成をネットワーク可の端末で手動実行してください:");
  info(`  git push -u origin ${branch}`);
  info(`  gh pr create --repo ${repoNwo} --base ${defaultBranch} --head ${branch} --title "${title}" --body-file /tmp/pr.md`);
}

function isDnsResolutionFailure(text) {
  const s = String(text || "");
  return (
    /Could not resolve host/i.test(s) ||
    /\bEAI_AGAIN\b/i.test(s) ||
    /\bENOTFOUND\b/i.test(s)
  );
}

function isReachabilityFailure(text) {
  const s = String(text || "");
  return (
    isDnsResolutionFailure(s) ||
    /Failed to connect/i.test(s) ||
    /Connection timed out/i.test(s) ||
    /Network is unreachable/i.test(s) ||
    /No route to host/i.test(s) ||
    /Operation timed out/i.test(s)
  );
}

function resolveBundleBaseRef(defaultBranch) {
  const candidates = [
    `origin/${defaultBranch}`,
    defaultBranch,
    "origin/main",
    "main",
    "origin/master",
    "master",
    "HEAD~1"
  ];
  for (const ref of candidates) {
    const r = shNodeTool("git", ["rev-parse", "--verify", ref], { timeout: 5000 });
    if (r.status === 0) {
      return ref;
    }
  }
  return "HEAD~1";
}

function createOfflineBundle(branch, defaultBranch) {
  const safeBranch = String(branch).replace(/[^\w.-]/g, "_");
  const bundlePath = `/tmp/${safeBranch}.bundle`;
  const baseRef = resolveBundleBaseRef(defaultBranch);
  const bundle = shNodeTool("git", ["bundle", "create", bundlePath, `${baseRef}..HEAD`], { timeout: 30000 });
  if (bundle.status !== 0) {
    const detail = ((bundle.stdout || "") + "\n" + (bundle.stderr || "")).trim();
    return { ok: false, bundlePath, baseRef, detail };
  }
  return { ok: true, bundlePath, baseRef, detail: null };
}

function printBundleRecovery(bundleInfo, { branch, repoNwo, defaultBranch }) {
  if (!bundleInfo || !bundleInfo.ok) {
    warn("[PR-UP] bundle生成に失敗しました。通常の手動手順を利用してください。");
    if (bundleInfo && bundleInfo.detail) {
      warn(tailText(bundleInfo.detail, 8));
    }
    return;
  }
  warn("[PR-UP] 到達性エラーを検知したため bundle を生成しました。");
  warn(`[PR-UP] bundle: ${bundleInfo.bundlePath}`);
  warn("[PR-UP] 復旧方法 (bundle):");
  warn(`  # 1) ${bundleInfo.bundlePath} をネットワーク可端末へコピー`);
  warn("  # 2) PR本文は次のどちらかで準備");
  warn("  #    A) /tmp/pr.md を同時にコピー");
  warn("  #    B) ネットワーク可端末で再生成:");
  warn("  #       node scripts/gen-pr-body.js");
  warn("  #       node scripts/pr-body-verify.js /tmp/pr.md");
  warn("  # 3) ネットワーク可端末で対象repoへ移動");
  warn(`  git fetch ${bundleInfo.bundlePath} ${branch}:${branch}`);
  warn(`  git checkout ${branch}`);
  warn(`  git push -u origin ${branch}`);
  warn(`  PR_NO=$(gh pr list --repo ${repoNwo} --head ${branch} --json number --jq '.[0].number')`);
  warn("  if [ -n \"$PR_NO\" ]; then");
  warn(`    gh pr edit \"$PR_NO\" --repo ${repoNwo} --body-file /tmp/pr.md`);
  warn("  else");
  warn(`    gh pr create --repo ${repoNwo} --base ${defaultBranch} --head ${branch} --fill --body-file /tmp/pr.md`);
  warn("  fi");
}

function printRecoveryByRuntimeError(text) {
  if (isDnsResolutionFailure(text)) {
    warn("[PR-UP] 復旧方法 (DNS):");
    warn("  bash scripts/fix-dns.sh");
    warn("  node scripts/pr-up.js");
    return;
  }
  warn("[PR-UP] 復旧方法:");
  warn("  ネットワーク設定を確認してください。");
  warn("  node scripts/pr-up.js");
}

function runDoctor() {
  return shNodeTool("node", ["scripts/hub-doctor.js"]);
}

function readDoctorJson() {
  const doctorPath = path.join(process.cwd(), "doctor.json");
  if (!fs.existsSync(doctorPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(doctorPath, "utf8"));
  } catch {
    return null;
  }
}

function printNativeBlock() {
  const nodeVersion = (process.version || "").trim();
  const nodeModules = process.versions && process.versions.modules ? String(process.versions.modules) : "unknown";
  info(`[PR-UP] Node: ${nodeVersion}`);
  info(`[PR-UP] Node modules ABI: ${nodeModules}`);
  info("[PR-UP] Recovery (recommended):");
  info("  volta pin node@22");
  info("  rm -rf node_modules");
  info("  npm install");
}

function isNativeAbiMismatch(text) {
  const s = String(text || "");
  const hasNativeModule =
    /better_sqlite3\.node/i.test(s) ||
    /better-sqlite3/i.test(s) ||
    /ERR_DLOPEN_FAILED/i.test(s);
  const hasAbiSignal =
    /compiled against a different Node\.js version/i.test(s) ||
    /NODE_MODULE_VERSION/i.test(s) ||
    /Module version mismatch/i.test(s);
  return hasNativeModule && hasAbiSignal;
}

function printAbiMismatchRecovery() {
  warn("[PR-UP] failure_code=native_module_abi_mismatch");
  warn("[PR-UP] better-sqlite3 / native module ABI mismatch detected.");
  warn("[PR-UP] Recovery (copy-paste):");
  warn("  volta pin node@22");
  warn("  rm -rf node_modules package-lock.json");
  warn("  npm ci");
  warn("  npm rebuild better-sqlite3 --build-from-source");
  warn("  npm test");
  warn("[PR-UP] Alternate environment flow (copy-paste):");
  warn("  npm test");
  warn("  git push -u origin $(git rev-parse --abbrev-ref HEAD)");
  warn("  gh pr create --fill --body-file /tmp/pr.md");
}

function main() {
  const doctorRun = runDoctor();
  const doctor = readDoctorJson();
  if (!doctorRun || doctorRun.status !== 0 || !doctor) {
    const reason = doctorRun && doctorRun.status !== 0
      ? `hub-doctor.js failed (code=${doctorRun.status})`
      : "doctor.json missing or invalid";
    info(`[PR-UP] ${reason}. Aborting before npm test/push/gh.`);
    printNativeBlock();
    process.exit(1);
  }
  const nativeStatus = doctor && doctor.native && doctor.native.better_sqlite3;
  if (nativeStatus && nativeStatus.ok === false) {
    info("[PR-UP] native.better_sqlite3.ok=false detected in doctor.json. Aborting before npm test/push/gh.");
    printNativeBlock();
    process.exit(1);
  }

  // ネットワーク判定は警告のみ。push/gh は実行して実際の成否で判断する。
  // "ネットワーク診断はNGですが、push/gh を継続して実行します。"
  const netOk = doctor.network && doctor.network.ok;
  if (netOk === false) {
    const status = doctor.network.status || "CHECK_NET_NG";
    const detail = doctor.network.detail || "(詳細なし)";
    if (status === "CHECK_BLOCKED") {
      warn(`[PR-UP] WARN ${status}: ネットワーク判定が実行不能 (${detail})`);
    } else if (status === "CHECK_DNS_NG") {
      warn(`[PR-UP] WARN ${status}: DNS 解決に失敗 (${detail})`);
    } else {
      warn(`[PR-UP] WARN ${status}: ネットワーク到達不可 (${detail})`);
    }
    warn("[PR-UP] ネットワーク診断はNGですが、push/gh を継続して実行します。");
    warn("[PR-UP] 復旧方法は実コマンド失敗(stderr)に基づいて案内します。");
  }

  const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") {
    warn(`[PR-UP] REFUSED: current branch is ${branch}. Create a feature branch first.`);
    warn(`[PR-UP] Next: git checkout -b issue-<number>-<slug>`);
    process.exit(1);
  }

  // repo/base を早期解決して gen-pr-body.js に渡す
  const repoNwo       = getRepoNwo();
  const defaultBranch = getDefaultBranch(repoNwo);
  const title         = must("git", ["log", "-1", "--pretty=%s"]);
  info(`[PR-UP] repo=${repoNwo} base=${defaultBranch} head=${branch}`);

  // ローカルステップ
  const npmTest = shNodeTool("npm", ["test"], { env: { ...process.env, SKIP_INTEGRATION_TESTS: "1" } });
  if (npmTest.status !== 0) {
    const out = ((npmTest.stdout || "") + "\n" + (npmTest.stderr || "")).trim();
    if (isNativeAbiMismatch(out)) {
      printAbiMismatchRecovery();
      process.exit(1);
    }
    throw new Error(`npm test failed (code=${npmTest.status})\n${out}`);
  }
  const prBody = shNodeTool("node", ["scripts/gen-pr-body.js"], { env: { ...process.env, PR_BASE_BRANCH: defaultBranch } });
  if (prBody.status !== 0) {
    const out = ((prBody.stdout || "") + "\n" + (prBody.stderr || "")).trim();
    throw new Error(`node scripts/gen-pr-body.js failed (code=${prBody.status})\n${out}`);
  }
  must("node", ["scripts/pr-body-verify.js", "/tmp/pr.md"]);

  // push
  const push = shNodeTool("git", ["push", "-u", "origin", branch], { timeout: 30000 });
  if (push.status !== 0) {
    const pushOut = ((push.stdout || "") + "\n" + (push.stderr || "")).trim();
    warn(`[PR-UP] PUSH FAILED\n` + tailText(pushOut, 20));
    if (isReachabilityFailure(pushOut)) {
      const bundleInfo = createOfflineBundle(branch, defaultBranch);
      printBundleRecovery(bundleInfo, { branch, repoNwo, defaultBranch });
      process.exit(1);
    }
    printRecoveryByRuntimeError(pushOut);
    printFallback({ branch, repoNwo, defaultBranch, title });
    process.exit(1);
  }

  // PR create or edit
  const list = shNodeTool("gh", ["pr", "list", "--repo", repoNwo, "--head", branch, "--json", "number", "--jq", ".[0].number"], { timeout: 30000 });
  const prNumber = list.status === 0 ? (list.stdout || "").trim() : "";

  if (prNumber) {
    const edit = shNodeTool("gh", ["pr", "edit", prNumber, "--repo", repoNwo, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (edit.status !== 0) {
      const editOut = ((edit.stdout || "") + "\n" + (edit.stderr || "")).trim();
      warn(`[PR-UP] gh pr edit failed\n` + tailText(editOut, 20));
      if (isReachabilityFailure(editOut)) {
        const bundleInfo = createOfflineBundle(branch, defaultBranch);
        printBundleRecovery(bundleInfo, { branch, repoNwo, defaultBranch });
        process.exit(1);
      }
      printRecoveryByRuntimeError(editOut);
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Updated PR #${prNumber}`);
  } else {
    const create = shNodeTool("gh", ["pr", "create", "--repo", repoNwo, "--base", defaultBranch, "--head", branch, "--title", title, "--body-file", "/tmp/pr.md"], { timeout: 30000 });
    if (create.status !== 0) {
      const createOut = ((create.stdout || "") + "\n" + (create.stderr || "")).trim();
      warn(`[PR-UP] gh pr create failed\n` + tailText(createOut, 20));
      if (isReachabilityFailure(createOut)) {
        const bundleInfo = createOfflineBundle(branch, defaultBranch);
        printBundleRecovery(bundleInfo, { branch, repoNwo, defaultBranch });
        process.exit(1);
      }
      printRecoveryByRuntimeError(createOut);
      printFallback({ branch, repoNwo, defaultBranch, title });
      process.exit(1);
    }
    info(`[PR-UP] Created PR: ${(create.stdout || "").trim()}`);
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(`[PR-UP] FAILED: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
}

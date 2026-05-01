import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Keep the public PR bridge copies code-shape aligned. They ship to
// separate public repos through Copybara, so they cannot import shared code.
// Sibling bridge copies:
// - public/agents/.github/scripts/bridge-public-pr-to-monorepo.mjs
// - copybara/public-open-knowledge-overlay/.github/scripts/bridge-public-pr-to-monorepo.mjs
const BRIDGE_COMMENT_MARKER = "<!-- monorepo-pr-bridge -->";

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(details || `${command} ${args.join(" ")} failed`);
  }
}

async function githubRequest({
  token,
  method = "GET",
  path: requestPath,
  body,
  accept = "application/vnd.github+json",
}) {
  const response = await fetch(`https://api.github.com${requestPath}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "User-Agent": "inkeep-public-pr-bridge",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${requestPath} failed (${response.status}): ${text}`);
  }

  // .patch and .diff return raw text, not JSON. All other accept types
  // (incl. the default application/vnd.github+json) return JSON.
  const isTextResponse =
    accept === "application/vnd.github.patch" || accept === "application/vnd.github.diff";
  return isTextResponse ? text : (text ? JSON.parse(text) : null);
}

async function githubGraphql({ token, query, variables }) {
  const result = await githubRequest({
    token,
    method: "POST",
    path: "/graphql",
    body: { query, variables },
  });
  if (result?.errors?.length) {
    const messages = result.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${messages}`);
  }
  return result;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getPublicPrBranchName(prefix, prNumber) {
  return `${prefix}-${prNumber}`;
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error.message}`);
  }
}

function prefixPatchPaths(patch, prefix, pathRewrites = {}) {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const prefixedPath = (value) => {
    if (value === "/dev/null") {
      return value;
    }

    const unquoted = value.replace(/^"(.+)"$/, "$1");
    const segments = unquoted.split("/");
    if (segments.some((s) => s === ".." || s === ".")) {
      throw new Error(`Rejecting patch with path traversal: ${unquoted}`);
    }

    const rewrite = pathRewrites[unquoted];
    if (rewrite) {
      const rewriteSegments = rewrite.split("/");
      if (rewriteSegments.some((s) => s === ".." || s === ".")) {
        throw new Error(`Rejecting patch rewrite with path traversal: ${rewrite}`);
      }
    }

    const nextValue = rewrite ?? `${normalizedPrefix}/${unquoted}`.replace(/\/+/g, "/");
    return value.startsWith("\"") ? `"${nextValue}"` : nextValue;
  };

  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git a/")) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (!match) {
          return line;
        }
        return `diff --git a/${prefixedPath(match[1])} b/${prefixedPath(match[2])}`;
      }
      if (line.startsWith("--- a/")) {
        return `--- a/${prefixedPath(line.slice(6))}`;
      }
      if (line.startsWith("+++ b/")) {
        return `+++ b/${prefixedPath(line.slice(6))}`;
      }
      if (line.startsWith("rename from ")) {
        return `rename from ${prefixedPath(line.slice("rename from ".length))}`;
      }
      if (line.startsWith("rename to ")) {
        return `rename to ${prefixedPath(line.slice("rename to ".length))}`;
      }
      if (line.startsWith("copy from ")) {
        return `copy from ${prefixedPath(line.slice("copy from ".length))}`;
      }
      if (line.startsWith("copy to ")) {
        return `copy to ${prefixedPath(line.slice("copy to ".length))}`;
      }
      return line;
    })
    .join("\n");
}

function internalPullRequestTitle(publicPr) {
  return `Sync public PR #${publicPr.number}: ${publicPr.title}`;
}

function buildBridgeMetadata(publicPr, mirrorPath) {
  return [
    "<!-- public-pr-sync",
    `public_repo=${publicPr.base.repo.full_name}`,
    `public_pr_number=${publicPr.number}`,
    `public_pr_url=${publicPr.html_url}`,
    `public_author_login=${publicPr.user.login}`,
    `public_author_id=${publicPr.user.id}`,
    `mirror_path=${mirrorPath}`,
    "-->",
  ].join("\n");
}

// GitHub PR body hard limit. Exceeding returns 422 "body is too long".
const GITHUB_PR_BODY_LIMIT = 65536;

function buildInternalPrBody({ publicPr, branchName, mirrorPath }) {
  const rawOriginal = publicPr.body?.trim()
    ? publicPr.body.trim()
    : "_No public PR body was provided._";

  const compose = (original) => `## Summary
Mirror public PR [#${publicPr.number}](${publicPr.html_url}) from \`${publicPr.base.repo.full_name}\` into \`inkeep/agents-private\` for canonical review and merge.

## Attribution
- Original author: @${publicPr.user.login}
- Public branch: \`${publicPr.head.label}\`
- Monorepo branch: \`${branchName}\`
- Monorepo path: \`${mirrorPath}\`

## Original PR Body
<details>
<summary>Expand</summary>

${original}

</details>

## Notes
- This PR branch is auto-managed from the public repo PR.
- Merge the monorepo PR, not the public PR.
- After the internal PR merges, the public repo should be updated by the next non-dry-run mirror sync.

${buildBridgeMetadata(publicPr, mirrorPath)}`;

  let body = compose(rawOriginal);
  if (body.length > GITHUB_PR_BODY_LIMIT) {
    const footer = `\n\n_...truncated. Original body exceeded GitHub's ${GITHUB_PR_BODY_LIMIT}-char PR body limit; see [original PR](${publicPr.html_url}) for full content._`;
    const scaffolding = body.length - rawOriginal.length;
    const budget = GITHUB_PR_BODY_LIMIT - scaffolding - footer.length - 100;
    const truncated = rawOriginal.slice(0, Math.max(budget, 0)) + footer;
    console.log(
      `Bridge: PR body exceeded GitHub's ${GITHUB_PR_BODY_LIMIT}-char limit ` +
        `(original: ${rawOriginal.length} chars, truncated to: ${truncated.length} chars).`,
    );
    body = compose(truncated);
  }
  return body;
}

function buildPublicComment({ publicPr, internalPr, status, details }) {
  if (status === "synced") {
    return `${BRIDGE_COMMENT_MARKER}
A matching internal PR is ready in [inkeep/agents-private#${internalPr.number}](${internalPr.html_url}) for canonical review and merge.

- Original author attribution is preserved as @${publicPr.user.login}
- The internal PR is the authoritative merge surface
- The public repo will pick up the merged change through the normal mirror sync

This comment will be updated as the bridge state changes.`;
  }

  if (status === "no-op") {
    return `${BRIDGE_COMMENT_MARKER}
I checked this public PR, but there was no new diff to port into \`agents-private\`.

${details}`;
  }

  if (status === "closed") {
    return `${BRIDGE_COMMENT_MARKER}
The public PR was closed without merge, so the matching internal PR was closed as well.

${details}`;
  }

  if (status === "merged-upstream") {
    return `${BRIDGE_COMMENT_MARKER}
This public PR was merged directly in the public repo. The matching monorepo PR was left open for manual follow-up because \`agents-private\` remains the source of truth.

${details}`;
  }

  return `${BRIDGE_COMMENT_MARKER}
I could not sync this public PR into \`agents-private\` automatically.

${details}`;
}

async function upsertIssueComment({ token, repo, issueNumber, body }) {
  let existing = null;
  let page = 1;
  while (!existing) {
    const comments = await githubRequest({
      token,
      path: `/repos/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    });
    if (comments.length === 0) break;
    existing = comments.find((comment) => comment.body?.includes(BRIDGE_COMMENT_MARKER));
    if (!existing && comments.length < 100) break;
    page++;
  }
  if (existing) {
    await githubRequest({
      token,
      method: "PATCH",
      path: `/repos/${repo}/issues/comments/${existing.id}`,
      body: { body },
    });
    return existing.html_url;
  }

  const created = await githubRequest({
    token,
    method: "POST",
    path: `/repos/${repo}/issues/${issueNumber}/comments`,
    body: { body },
  });
  return created.html_url;
}

async function findOpenInternalPr({ token, repo, owner, branchName }) {
  const pulls = await githubRequest({
    token,
    path: `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branchName}`)}`,
  });
  return pulls[0] ?? null;
}

async function ensureDraftState({ token, pullRequest, shouldBeDraft }) {
  if (Boolean(pullRequest.draft) === Boolean(shouldBeDraft)) {
    return;
  }

  const query = shouldBeDraft
    ? `mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id } } }`
    : `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`;

  await githubGraphql({
    token,
    query,
    variables: { id: pullRequest.node_id },
  });
}

/**
 * Apply monorepo-specific patches that upstream configs don't have.
 * Currently patches next.config.ts to add outputFileTracingRoot which is
 * required for Next.js standalone builds in a monorepo context.
 * Returns true if any files were modified.
 */
function reconcileMonorepoPatches(repoDir, mirrorPath) {
  let changed = false;

  // Patch next.config.ts files under the mirror path to add outputFileTracingRoot
  const nextConfigPaths = [
    path.join(repoDir, mirrorPath, "agents-manage-ui", "next.config.ts"),
  ];

  for (const configPath of nextConfigPaths) {
    if (!existsSync(configPath)) continue;

    let content = readFileSync(configPath, "utf8");

    // Skip if already has outputFileTracingRoot
    if (content.includes("outputFileTracingRoot")) continue;

    // Add outputFileTracingRoot next to the output: 'standalone' line
    if (content.includes("output: 'standalone'")) {
      content = content.replace(
        "output: 'standalone'",
        "output: 'standalone',\n  outputFileTracingRoot: monorepoRoot"
      );
      writeFileSync(configPath, content, "utf8");
      console.log(`Patched outputFileTracingRoot into ${configPath}`);
      changed = true;
    }
  }

  return changed;
}

async function syncPublicPr() {
  const publicToken = requireEnv("PUBLIC_TOKEN");
  const internalToken = requireEnv("INTERNAL_TOKEN");
  const publicRepo = requireEnv("PUBLIC_REPO");
  const internalRepo = requireEnv("INTERNAL_REPO");
  const internalRepoDir = requireEnv("INTERNAL_REPO_DIR");
  const mirrorPath = requireEnv("MONOREPO_PATH_PREFIX");
  const internalBaseRef = requireEnv("INTERNAL_BASE_REF");
  const internalBranchPrefix = requireEnv("INTERNAL_BRANCH_PREFIX");
  const publicPrAction = process.env.PUBLIC_PR_ACTION ?? "opened";
  const publicPrNumber = Number.parseInt(requireEnv("PUBLIC_PR_NUMBER"), 10);
  const pathRewrites = parseJsonEnv("PUBLIC_PR_PATH_REWRITES", {});
  const internalOwner = internalRepo.split("/")[0];
  const branchName = getPublicPrBranchName(internalBranchPrefix, publicPrNumber);

  const publicPr = await githubRequest({
    token: publicToken,
    path: `/repos/${publicRepo}/pulls/${publicPrNumber}`,
  });

  let internalPr = await findOpenInternalPr({
    token: internalToken,
    repo: internalRepo,
    owner: internalOwner,
    branchName,
  });

  const metadataOnlyAction =
    internalPr &&
    (publicPrAction === "edited" ||
      publicPrAction === "ready_for_review" ||
      publicPrAction === "converted_to_draft");

  let hasStagedChanges = false;
  if (!metadataOnlyAction) {
    // Use .diff (unified squash) not .patch (multi-commit mailbox). .patch
    // returns one patch per commit with intermediate blob SHAs that only
    // exist in the public repo; any conflicting hunk forces --3way to look
    // up those intermediates and fail. See agents copy of this script for
    // full rationale.
    const patch = await githubRequest({
      token: publicToken,
      path: `/repos/${publicRepo}/pulls/${publicPrNumber}`,
      accept: "application/vnd.github.diff",
    });

    if (!patch.trim()) {
      await upsertIssueComment({
        token: publicToken,
        repo: publicRepo,
        issueNumber: publicPrNumber,
        body: buildPublicComment({
          publicPr,
          status: "no-op",
          details: "GitHub returned an empty patch, so there was nothing to port.",
        }),
      });
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "public-pr-bridge-"));
    const patchFile = path.join(tempDir, "public-pr.patch");
    writeFileSync(patchFile, prefixPatchPaths(patch, mirrorPath, pathRewrites), "utf8");

    try {
      run("git", ["-C", internalRepoDir, "fetch", "origin", internalBaseRef, "--prune"]);
      run("git", ["-C", internalRepoDir, "checkout", "-B", branchName, `origin/${internalBaseRef}`]);

      try {
        run("git", ["-C", internalRepoDir, "apply", "--index", "--3way", patchFile]);
      } catch (error) {
        await upsertIssueComment({
          token: publicToken,
          repo: publicRepo,
          issueNumber: publicPrNumber,
          body: buildPublicComment({
            publicPr,
            status: "failed",
            details: `Patch application failed.\n\n\`\`\`\n${error.message}\n\`\`\``,
          }),
        });
        throw error;
      }

      hasStagedChanges = (() => {
        const output = run("git", ["-C", internalRepoDir, "diff", "--cached", "--name-only"]);
        return output.length > 0;
      })();

      if (hasStagedChanges) {
        run("git", ["-C", internalRepoDir, "config", "user.name", "Inkeep Public PR Bridge"]);
        run("git", ["-C", internalRepoDir, "config", "user.email", "public-pr-bridge@inkeep.com"]);

        const authorEmail = `${publicPr.user.id}+${publicPr.user.login}@users.noreply.github.com`;
        run("git", [
          "-C",
          internalRepoDir,
          "commit",
          "--author",
          `${publicPr.user.login} <${authorEmail}>`,
          "-m",
          `chore(sync): mirror ${publicRepo}#${publicPr.number}`,
        ]);

        // Run monorepo reconciliation patches (e.g. outputFileTracingRoot for Next.js)
        const reconciled = reconcileMonorepoPatches(internalRepoDir, mirrorPath);
        if (reconciled) {
          run("git", ["-C", internalRepoDir, "add", "-A"]);
          run("git", [
            "-C",
            internalRepoDir,
            "commit",
            "--author",
            `Inkeep Public PR Bridge <public-pr-bridge@inkeep.com>`,
            "-m",
            `chore(sync): reconcile monorepo patches for ${publicRepo}#${publicPr.number}`,
          ]);
        }

        run("git", [
          "-C",
          internalRepoDir,
          "push",
          "--force-with-lease",
          "--set-upstream",
          "origin",
          branchName,
        ]);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    internalPr = await findOpenInternalPr({
      token: internalToken,
      repo: internalRepo,
      owner: internalOwner,
      branchName,
    });

    if (!internalPr && !hasStagedChanges) {
      await upsertIssueComment({
        token: publicToken,
        repo: publicRepo,
        issueNumber: publicPrNumber,
        body: buildPublicComment({
          publicPr,
          status: "no-op",
          details: "The diff already appears to be present on the internal base branch, so no new monorepo PR was opened.",
        }),
      });
      return;
    }
  }

  const title = internalPullRequestTitle(publicPr);
  const body = buildInternalPrBody({ publicPr, branchName, mirrorPath });

  if (internalPr) {
    internalPr = await githubRequest({
      token: internalToken,
      method: "PATCH",
      path: `/repos/${internalRepo}/pulls/${internalPr.number}`,
      body: { title, body },
    });
    await ensureDraftState({
      token: internalToken,
      pullRequest: internalPr,
      shouldBeDraft: publicPr.draft,
    });
  } else {
    internalPr = await githubRequest({
      token: internalToken,
      method: "POST",
      path: `/repos/${internalRepo}/pulls`,
      body: {
        title,
        head: branchName,
        base: internalBaseRef,
        body,
        draft: publicPr.draft,
      },
    });
  }

  await upsertIssueComment({
    token: publicToken,
    repo: publicRepo,
    issueNumber: publicPrNumber,
    body: buildPublicComment({
      publicPr,
      internalPr,
      status: "synced",
    }),
  });
}

async function closeLinkedInternalPr() {
  const publicToken = requireEnv("PUBLIC_TOKEN");
  const internalToken = requireEnv("INTERNAL_TOKEN");
  const publicRepo = requireEnv("PUBLIC_REPO");
  const internalRepo = requireEnv("INTERNAL_REPO");
  const internalBranchPrefix = requireEnv("INTERNAL_BRANCH_PREFIX");
  const publicPrNumber = Number.parseInt(requireEnv("PUBLIC_PR_NUMBER"), 10);
  const internalOwner = internalRepo.split("/")[0];
  const branchName = getPublicPrBranchName(internalBranchPrefix, publicPrNumber);

  const publicPr = await githubRequest({
    token: publicToken,
    path: `/repos/${publicRepo}/pulls/${publicPrNumber}`,
  });

  const internalPr = await findOpenInternalPr({
    token: internalToken,
    repo: internalRepo,
    owner: internalOwner,
    branchName,
  });

  if (!internalPr) {
    return;
  }

  if (publicPr.merged_at) {
    await upsertIssueComment({
      token: publicToken,
      repo: publicRepo,
      issueNumber: publicPrNumber,
      body: buildPublicComment({
        publicPr,
        internalPr,
        status: "merged-upstream",
        details: `Matching internal PR: [#${internalPr.number}](${internalPr.html_url})`,
      }),
    });
    return;
  }

  await githubRequest({
    token: internalToken,
    method: "POST",
    path: `/repos/${internalRepo}/issues/${internalPr.number}/comments`,
    body: {
      body: `Closing because the linked public PR [#${publicPr.number}](${publicPr.html_url}) was closed without merge.`,
    },
  });

  await githubRequest({
    token: internalToken,
    method: "PATCH",
    path: `/repos/${internalRepo}/pulls/${internalPr.number}`,
    body: { state: "closed" },
  });

  try {
    await githubRequest({
      token: internalToken,
      method: "DELETE",
      path: `/repos/${internalRepo}/git/refs/heads/${branchName}`,
    });
  } catch (error) {
    console.log(`Branch cleanup skipped: ${error.message}`);
  }

  await upsertIssueComment({
    token: publicToken,
    repo: publicRepo,
    issueNumber: publicPrNumber,
    body: buildPublicComment({
      publicPr,
      status: "closed",
      details: `Closed matching internal PR [#${internalPr.number}](${internalPr.html_url}).`,
    }),
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "sync") {
    await syncPublicPr();
    return;
  }

  if (mode === "close") {
    await closeLinkedInternalPr();
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

export { buildInternalPrBody, buildPublicComment, prefixPatchPaths };

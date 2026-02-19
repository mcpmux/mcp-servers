#!/usr/bin/env python3
"""
Process all claude/add-* branches:
1. Rebase onto main
2. Fix common issues in server definition JSON files
3. Commit changes
4. Push to new fix/* branch
"""
import subprocess
import json
import sys
import os
import re

REPO_DIR = r"d:\mcpmux\mcp-servers"

# Known icon fixes: MCP org icon -> actual project icon
ICON_FIXES = {
    "community.filesystem": "https://avatars.githubusercontent.com/u/182288589?v=4",  # keep MCP - it IS the MCP org project
    "community.puppeteer": "https://avatars.githubusercontent.com/u/182288589?v=4",
    "community.sqlite": "https://avatars.githubusercontent.com/u/182288589?v=4",
    "community.fetch": "https://avatars.githubusercontent.com/u/182288589?v=4",
    "community.memory": "https://avatars.githubusercontent.com/u/182288589?v=4",
    "community.sequential-thinking": "https://avatars.githubusercontent.com/u/182288589?v=4",
    "community.postgresql": "https://www.postgresql.org/media/img/about/press/elephant.png",
    "community.gitlab": "https://avatars.githubusercontent.com/u/1086321?v=4",
    "community.google-maps": "https://avatars.githubusercontent.com/u/1342004?v=4",
}

# Known repo URL fixes
REPO_FIXES = {
    "com.hubspot-mcp": "https://github.com/HubSpot/mcp-server",
    "com.resend-mcp": "https://github.com/resend/resend-mcp",
    "com.pagerduty-mcp": "https://github.com/PagerDuty/pagerduty-mcp-server",
}

# Known doc URL fixes
DOC_FIXES = {
    "community.postgresql": "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres#readme",
}

# Servers with known wrong packages
PACKAGE_FIXES = {
    "com.pagerduty-mcp": {"args": ["pagerduty-mcp"]},
}

# Stytch: repo URL is org page, should be removed or pointed to specific repo
STYTCH_REPO = "https://github.com/stytchauth/stytch-mcp"

VALID_INPUT_TYPES = ["text", "number", "boolean", "url", "select", "file_path", "directory_path"]

def run(cmd, cwd=REPO_DIR, check=True):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=True)
    if check and result.returncode != 0:
        return None, result.stderr.strip()
    return result.stdout.strip(), result.stderr.strip()

def fix_definition(filepath, server_id):
    """Fix common issues in a server definition JSON file. Returns list of fixes applied."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    fixes = []

    # Fix invalid input types
    transport = data.get('transport', {})
    metadata = transport.get('metadata', {})
    inputs = metadata.get('inputs', [])

    for inp in inputs:
        if inp.get('type') not in VALID_INPUT_TYPES:
            old_type = inp.get('type')
            inp['type'] = 'text'
            fixes.append(f"input type '{old_type}' -> 'text' for {inp['id']}")

    # Fix MCP org icon for non-MCP-org projects
    icon = data.get('icon', '')
    if server_id in ICON_FIXES:
        new_icon = ICON_FIXES[server_id]
        if icon != new_icon:
            data['icon'] = new_icon
            fixes.append(f"icon updated")

    # Fix known repo URLs
    if server_id in REPO_FIXES:
        links = data.get('links', {})
        if links.get('repository') != REPO_FIXES[server_id]:
            links['repository'] = REPO_FIXES[server_id]
            data['links'] = links
            fixes.append(f"repo URL fixed")

    # Fix known doc URLs
    if server_id in DOC_FIXES:
        links = data.get('links', {})
        if links.get('documentation') != DOC_FIXES[server_id]:
            links['documentation'] = DOC_FIXES[server_id]
            data['links'] = links
            fixes.append(f"doc URL fixed")

    # Fix stytch repo
    if server_id == "com.stytch-mcp":
        links = data.get('links', {})
        links['repository'] = STYTCH_REPO
        data['links'] = links
        fixes.append("repo URL: org page -> specific repo")

    # Fix pagerduty package
    if server_id in PACKAGE_FIXES:
        transport['args'] = PACKAGE_FIXES[server_id]['args']
        fixes.append("fixed package name")

    if fixes:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')

    return fixes

def get_remote_branches():
    out, _ = run('git for-each-ref --format="%(refname:short)" "refs/remotes/origin/claude/add-*"')
    if not out:
        return []
    return [b.strip().replace('origin/', '') for b in out.strip().split('\n') if b.strip()]

def process_branch(branch_name):
    """Process a single branch: rebase, fix, commit, push."""
    short_name = branch_name.replace('claude/add-', '').replace('-mcp-nYwV7', '').replace('-nYwV7', '')
    fix_branch = f"fix/{short_name}"

    # Create fix branch from the remote branch, rebased on main
    run(f'git branch -D {fix_branch}', check=False)
    out, err = run(f'git checkout -b {fix_branch} origin/{branch_name}')
    if out is None:
        return {"branch": branch_name, "status": "ERROR", "error": f"checkout failed: {err}"}

    # Rebase onto main
    out, err = run('git rebase main')
    if out is None:
        run('git rebase --abort', check=False)
        run('git checkout main', check=False)
        run(f'git branch -D {fix_branch}', check=False)
        return {"branch": branch_name, "status": "REBASE_CONFLICT", "error": err}

    # Find the server definition files that differ from main
    out, _ = run('git diff main --name-only -- servers/')
    if not out:
        run('git checkout main', check=False)
        run(f'git branch -D {fix_branch}', check=False)
        return {"branch": branch_name, "status": "NO_CHANGES", "error": "No server files differ from main"}

    diff_files = [f for f in out.strip().split('\n') if f.strip()]

    all_fixes = []
    for f in diff_files:
        filepath = os.path.join(REPO_DIR, f)
        if os.path.exists(filepath) and f.endswith('.json'):
            try:
                with open(filepath, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                server_id = data.get('id', '')
                fixes = fix_definition(filepath, server_id)
                if fixes:
                    all_fixes.extend([(f, fix) for fix in fixes])
            except Exception as e:
                all_fixes.append((f, f"PARSE_ERROR: {e}"))

    # Commit fixes if any
    if all_fixes:
        run('git add -A')
        fix_desc = "; ".join([fix for _, fix in all_fixes[:5]])
        commit_msg = f"fix: update server definition ({fix_desc})"
        run(f'git commit -m "{commit_msg}"')

    # Push
    out, err = run(f'git push -u origin {fix_branch} --force')
    if out is None and "error" in str(err).lower():
        result = {"branch": branch_name, "fix_branch": fix_branch, "status": "PUSH_ERROR", "error": err, "fixes": all_fixes}
    else:
        result = {"branch": branch_name, "fix_branch": fix_branch, "status": "PUSHED", "fixes": all_fixes, "files": diff_files}

    # Back to main
    run('git checkout main')

    return result

def create_pr(fix_branch, server_name, files):
    """Create a PR for a fix branch."""
    file_list = ", ".join([os.path.basename(f) for f in files])
    title = f"feat: add {server_name} MCP server definition"
    body = f"Add {server_name} MCP server definition.\\n\\nFiles: {file_list}"

    out, err = run(f'gh pr create --base main --head {fix_branch} --title "{title}" --body "{body}"')
    if out and "http" in out:
        return out.strip()
    return f"PR_ERROR: {err}"

if __name__ == "__main__":
    os.chdir(REPO_DIR)

    # Ensure we're on main
    run('git checkout main')

    branches = get_remote_branches()
    print(f"Found {len(branches)} branches to process")

    results = []
    for i, branch in enumerate(branches):
        print(f"\n[{i+1}/{len(branches)}] Processing {branch}...")
        result = process_branch(branch)
        results.append(result)
        print(f"  Status: {result['status']}")
        if result.get('fixes'):
            for f, fix in result['fixes']:
                print(f"    Fix: {fix}")

    # Summary
    print("\n\n=== SUMMARY ===")
    for r in results:
        status = r['status']
        branch = r['branch']
        fixes = len(r.get('fixes', []))
        print(f"  {status:20s} {branch} ({fixes} fixes)")

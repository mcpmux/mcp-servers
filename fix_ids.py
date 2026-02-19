"""
Fix definition IDs:
- Community-driven definitions: use GitHub org as domain (e.g., crystaldba.postgres-mcp-uvx)
- Official vendor definitions: keep current domain (com.redis-mcp, com.mongodb-mcp, etc.)
- Ensure all IDs match filename pattern

Rules:
- If contributor.github matches the repo org AND it's not a major vendor domain (com., io., etc.),
  use the GitHub org: githubuser.servername-tool
- For modelcontextprotocol/servers, keep "community." prefix
- For official vendor repos (company.com domains), keep existing convention
"""
import json, subprocess, re, os

os.chdir('d:\\mcpmux\\mcp-servers')

main_files = set(subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', 'main', '--', 'servers/'],
    text=True
).strip().split('\n'))

branches = subprocess.check_output(['git', 'branch', '--list', 'fix/*'], text=True).strip().split('\n')
branches = [b.strip().lstrip('* ') for b in branches if b.strip()]

# Map of current file -> what the ID SHOULD be based on repo org
# community.* prefix servers that should use github org instead
COMMUNITY_REMAP = {
    # crystaldba/postgres-mcp -> crystaldba.postgres-mcp-uvx
    'community.postgresql-uvx': 'crystaldba.postgres-mcp-uvx',
    # domdomegg/airtable-mcp-server -> domdomegg.airtable-mcp-npx
    'community.airtable-npx': 'domdomegg.airtable-mcp-npx',
    # ThetaBird/mcp-server-axiom-js -> thetabird.axiom-mcp-npx
    'community.axiom-npx': 'thetabird.axiom-mcp-npx',
    # orellazri/coda-mcp -> orellazri.coda-mcp-npx
    'community.coda-npx': 'orellazri.coda-mcp-npx',
    # aashari/mcp-server-atlassian-jira -> aashari.jira-mcp-npx
    'community.jira-npx': 'aashari.jira-mcp-npx',
    # CakeRepository/1Password-MCP -> cakerepository.1password-mcp-npx
    'community.1password-npx': 'cakerepository.1password-mcp-npx',
    # modelcontextprotocol/servers - these stay community.*
    # 'community.fetch-uvx': keep as is
    # 'community.memory-npx': keep as is
    # 'community.sequential-thinking-npx': keep as is
    # 'community.google-maps-npx': keep as is
    # 'community.gitlab-npx': keep as is
}

results = []

for branch in sorted(branches):
    files_out = subprocess.run(
        ['git', 'ls-tree', '-r', '--name-only', branch, '--', 'servers/'],
        capture_output=True, text=True
    )
    if files_out.returncode != 0:
        continue

    all_files = files_out.stdout.strip().split('\n')
    new_files = [f for f in all_files if f not in main_files and f.endswith('.json')]

    if not new_files:
        continue

    # Check if any file needs ID remap
    needs_fix = False
    for f in new_files:
        basename = os.path.basename(f).replace('.json', '')
        if basename in COMMUNITY_REMAP:
            needs_fix = True
            break

    if not needs_fix:
        continue

    # Checkout
    subprocess.run(['git', 'checkout', branch], capture_output=True, text=True)

    changed = False
    renames_done = []

    for f in new_files:
        basename = os.path.basename(f).replace('.json', '')
        if basename not in COMMUNITY_REMAP:
            continue

        new_id = COMMUNITY_REMAP[basename]
        new_filename = f"servers/{new_id}.json"

        # Read and update
        with open(f) as fh:
            defn = json.load(fh)

        old_id = defn['id']
        defn['id'] = new_id

        with open(f, 'w') as fh:
            json.dump(defn, fh, indent=2)
            fh.write('\n')

        # Git mv
        subprocess.run(['git', 'mv', f, new_filename], capture_output=True, text=True)
        renames_done.append((basename, new_id, old_id))
        changed = True

    if changed:
        subprocess.run(['git', 'add', '-A'], capture_output=True, text=True)
        msg = "fix: use GitHub org as ID domain for community definitions\n\n"
        for old, new, old_id in renames_done:
            msg += f"- {old_id} -> {new}\n"

        subprocess.run([
            'git', 'commit', '-s',
            '--author=Mohammod Al Amin Ashik <maa.ashik00@gmail.com>',
            '-m', msg
        ], capture_output=True, text=True)

        push = subprocess.run(['git', 'push', 'origin', branch], capture_output=True, text=True)
        for old, new, old_id in renames_done:
            status = "OK" if push.returncode == 0 else "PUSH_FAIL"
            print(f"{status} {branch}: {old_id} -> {new}")
            results.append((branch, old_id, new))

subprocess.run(['git', 'checkout', 'main'], capture_output=True, text=True)
print(f"\n=== Fixed {len(results)} community definition IDs ===")

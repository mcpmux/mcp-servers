"""Inventory all NEW server definitions across fix branches with transport details."""
import json, subprocess, re

main_files = set(subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', 'main', '--', 'servers/'],
    text=True
).strip().split('\n'))

branches = subprocess.check_output(['git', 'branch', '--list', 'fix/*'], text=True).strip().split('\n')
branches = [b.strip().lstrip('* ') for b in branches if b.strip()]

servers = []

for branch in sorted(branches):
    try:
        files = subprocess.check_output(
            ['git', 'ls-tree', '-r', '--name-only', branch, '--', 'servers/'],
            text=True
        ).strip().split('\n')
    except:
        continue

    new_files = [f for f in files if f not in main_files and f.endswith('.json')]

    for f in new_files:
        try:
            content = subprocess.check_output(['git', 'show', f'{branch}:{f}'], text=True)
            defn = json.loads(content)
        except:
            continue

        transport = defn.get('transport', {})
        t_type = transport.get('type', '?')
        command = transport.get('command', '')
        url = transport.get('url', '')
        repo = defn.get('links', {}).get('repository', '')
        name = defn.get('name', '?')
        defn_id = defn.get('id', '?')

        if t_type == 'stdio':
            tool = command  # npx, uvx, docker, etc.
        elif t_type == 'http':
            tool = 'http'
        else:
            tool = '?'

        # Check if filename already has transport suffix
        base = f.replace('servers/', '').replace('.json', '')
        has_suffix = any(base.endswith(s) for s in ['-npx', '-uvx', '-docker', '-http'])

        servers.append({
            'branch': branch,
            'file': f,
            'id': defn_id,
            'name': name,
            'transport': t_type,
            'tool': tool,
            'repo': repo,
            'has_suffix': has_suffix,
        })

# Print grouped by branch
print(f"{'Branch':<25} {'File':<45} {'Tool':<8} {'Has Suffix':<12} {'Repo'}")
print('-' * 160)
for s in servers:
    print(f"{s['branch']:<25} {s['file']:<45} {s['tool']:<8} {str(s['has_suffix']):<12} {s['repo']}")

# Summary: files needing rename (no transport suffix for stdio)
print(f"\n\n=== FILES NEEDING RENAME (no transport suffix) ===")
need_rename = [s for s in servers if not s['has_suffix'] and s['tool'] in ('npx', 'uvx', 'docker')]
for s in need_rename:
    suggested = s['file'].replace('.json', f"-{s['tool']}.json")
    print(f"  {s['branch']}: {s['file']} -> {suggested}")
print(f"\nTotal needing rename: {len(need_rename)}")

# Unique repos for Docker check
print(f"\n\n=== UNIQUE REPOS TO CHECK FOR DOCKER ===")
repos = sorted(set(s['repo'] for s in servers if s['repo'] and 'github.com' in s['repo']))
for r in repos:
    print(f"  {r}")
print(f"\nTotal repos: {len(repos)}")

"""Rename server definition files to include transport tool suffix.
Also updates the 'id' and 'name' fields inside each JSON file.
Skips HTTP-only servers (they don't need a suffix since HTTP implies remote).
Skips files that already have the correct suffix.
"""
import json, subprocess, sys, os

# Files that should NOT get renamed (HTTP-only, no stdio variant, or special cases)
SKIP_BRANCHES = set()
# HTTP servers don't need transport suffix - they use the URL as transport
HTTP_ONLY_FILES = {
    'com.asana-mcp.json',
    'com.clerk-mcp.json',
    'com.cloudflare-observability.json',
    'com.figma-mcp.json',
    'com.honeycomb-mcp.json',
    'io.intercom-mcp.json',
    'io.sanity-mcp.json',
    'com.stytch-mcp.json',
    'com.vercel-mcp.json',
    'town.val-mcp.json',
    # These already have proper suffixes
    'com.apify-mcp-http.json',
    'com.linear-mcp-http.json',
    'com.square-mcp-http.json',
    'com.vercel-mcp-http.json',
    'com.mongodb-mcp-npx.json',
    'com.mongodb-mcp-docker.json',
}

# Special: snyk uses 'snyk' command not npx/uvx/docker
SPECIAL_TOOLS = {
    'com.snyk-mcp.json': 'cli',  # snyk cli, not a standard transport
}

def get_tool_suffix(transport):
    """Determine the suffix based on transport command."""
    if transport.get('type') == 'http':
        return 'http'
    cmd = transport.get('command', '')
    if cmd in ('npx', 'uvx', 'docker'):
        return cmd
    if cmd == 'snyk':
        return 'cli'
    return cmd if cmd else None

def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)

def main():
    os.chdir('d:\\mcpmux\\mcp-servers')

    # Get main files to skip
    main_files = set(run(['git', 'ls-tree', '-r', '--name-only', 'main', '--', 'servers/']).stdout.strip().split('\n'))

    branches = run(['git', 'branch', '--list', 'fix/*']).stdout.strip().split('\n')
    branches = [b.strip().lstrip('* ') for b in branches if b.strip()]

    results = []

    for branch in sorted(branches):
        if branch in SKIP_BRANCHES:
            continue

        # Get new files in this branch
        files_out = run(['git', 'ls-tree', '-r', '--name-only', branch, '--', 'servers/'])
        if files_out.returncode != 0:
            continue
        all_files = files_out.stdout.strip().split('\n')
        new_files = [f for f in all_files if f not in main_files and f.endswith('.json')]

        if not new_files:
            continue

        # Check out branch
        co = run(['git', 'checkout', branch])
        if co.returncode != 0:
            print(f"SKIP {branch}: checkout failed")
            continue

        changed = False
        renames = []

        for f in new_files:
            basename = os.path.basename(f)

            if basename in HTTP_ONLY_FILES:
                continue

            # Check if already has suffix
            name_no_ext = basename.replace('.json', '')
            if any(name_no_ext.endswith(s) for s in ['-npx', '-uvx', '-docker', '-http', '-cli']):
                continue

            # Read and parse
            try:
                with open(f) as fh:
                    defn = json.load(fh)
            except:
                print(f"SKIP {branch}/{basename}: can't parse")
                continue

            transport = defn.get('transport', {})
            suffix = get_tool_suffix(transport)

            if not suffix:
                print(f"SKIP {branch}/{basename}: unknown tool")
                continue

            # For HTTP-only servers (no stdio), skip suffix
            if suffix == 'http' and basename not in HTTP_ONLY_FILES:
                # This is an HTTP file paired with a stdio variant - already has -http suffix check above
                continue

            # Compute new filename and id
            new_basename = name_no_ext + f'-{suffix}.json'
            new_path = f'servers/{new_basename}'
            new_id = defn['id'] + f'-{suffix}'

            # Update name to include tool
            old_name = defn.get('name', '')
            suffix_label = suffix.upper() if suffix == 'uvx' else suffix
            if suffix == 'npx':
                new_name = f"{old_name} (npx)"
            elif suffix == 'uvx':
                new_name = f"{old_name} (uvx)"
            elif suffix == 'docker':
                new_name = f"{old_name} (Docker)"
            elif suffix == 'cli':
                new_name = f"{old_name} (CLI)"
            else:
                new_name = old_name

            # Update definition
            defn['id'] = new_id
            defn['name'] = new_name

            with open(f, 'w') as fh:
                json.dump(defn, fh, indent=2)
                fh.write('\n')

            # Git mv
            mv = run(['git', 'mv', f, new_path])
            if mv.returncode != 0:
                print(f"ERROR {branch}: git mv {f} -> {new_path} failed: {mv.stderr}")
                continue

            renames.append((basename, new_basename, new_id))
            changed = True

        if changed:
            # Stage and commit
            run(['git', 'add', '-A'])
            msg = f"fix: rename server files with transport suffix\n\n"
            for old, new, nid in renames:
                msg += f"- {old} -> {new} (id: {nid})\n"

            commit = run(['git', 'commit', '-s',
                '--author=Mohammod Al Amin Ashik <maa.ashik00@gmail.com>',
                '-m', msg])
            if commit.returncode != 0:
                print(f"ERROR {branch}: commit failed: {commit.stderr}")
                continue

            # Push
            push = run(['git', 'push', 'origin', branch])
            if push.returncode != 0:
                print(f"ERROR {branch}: push failed: {push.stderr}")
                continue

            for old, new, nid in renames:
                print(f"OK {branch}: {old} -> {new}")
                results.append((branch, old, new))
        else:
            # Nothing to rename in this branch
            pass

    # Switch back to main
    run(['git', 'checkout', 'main'])

    print(f"\n=== SUMMARY ===")
    print(f"Renamed {len(results)} files across {len(set(r[0] for r in results))} branches")

if __name__ == '__main__':
    main()

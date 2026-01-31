# Contributing MCP Servers

Thank you for contributing to the MCPMux server registry!

## License

This repository is licensed under the [Elastic License 2.0 (ELv2)](LICENSE). By contributing, you agree that your contributions will be licensed under the same license.

## Developer Certificate of Origin (DCO)

All contributions must be signed off:

```bash
git commit -s -m "Add my-server"
```

By signing off, you certify you have the right to submit the contribution under this license. See [developercertificate.org](https://developercertificate.org/) for details.

## Adding a Server

### 1. Create Server Definition

Create a JSON file in `servers/` following this structure:

```json
{
  "id": "your-server-id",
  "name": "Your Server Name",
  "description": "What your server does",
  "author": "your-github-username",
  "repository": "https://github.com/you/your-server",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "your-package"]
  },
  "categories": ["category1", "category2"]
}
```

### 2. Validation

Your server definition will be validated against our schema. Ensure:

- `id` is unique and lowercase (e.g., `my-cool-server`)
- `name` is human-readable
- `description` clearly explains what the server does
- `repository` points to the source code
- `transport` specifies how to run the server

### 3. Submit PR

1. Fork this repository
2. Add your server file: `servers/your-server-id.json`
3. Sign off your commit: `git commit -s`
4. Create a Pull Request

### Review Process

- Automated validation checks schema compliance
- Maintainers review for quality and security
- Once approved, your server appears in the MCPMux registry

## Updating a Server

Follow the same process. Update your existing file and submit a PR.

## Questions?

Open an issue if you need help.

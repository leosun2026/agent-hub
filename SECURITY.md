# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not file a public Issue**. Instead, contact us privately:

- Open a GitHub Issue **marked as \`security\`** (visible only to project maintainers)
- Or contact the project maintainer directly

We will respond promptly and work to fix the issue.

## Known Security Measures

### API Key Protection

The \`auth\` field in \`agents.json\` supports environment variable references starting with \`$\` (e.g. \`$AUTH_TOKEN\`). This allows you to store API keys in environment variables or a \`.env\` file, and avoid committing them to version control.

**Never commit your \`.env\` file or API keys to Git.**

### Local-Only Networking

By default, the server binds to \`127.0.0.1\` and is only accessible from the local machine. If you expose it to a network, ensure you have proper firewall rules and authentication in place.

### Input Sanitization

User and Agent inputs are HTML-escaped before rendering to prevent XSS attacks.

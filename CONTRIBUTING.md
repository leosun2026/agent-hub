# Contributing

Thank you for your interest in Agent Hub! Here's how to participate.

## Reporting Issues

If you find a bug or want to request a feature, please open a GitHub Issue.

**When filing an issue, please include:**
- Description of the problem (what happened vs. what was expected)
- Steps to reproduce (if applicable)
- Browser version and operating system
- Server logs (available via the \`/api/log\` endpoint)

## Submitting Pull Requests

1. Fork the repository and create your branch from \`main\`.
2. If you've added code that should be tested, add tests.
3. Ensure your code lints and passes existing tests.
4. Update documentation if your changes affect the API or user-facing features.
5. Open a Pull Request with a clear description of the changes.

## Code Style

- Follow the existing code style in the project.
- Use meaningful variable names (avoid single-letter names except in loops).
- Keep functions focused and reasonably sized.
- Add comments for non-obvious logic.

## Development Setup

\`\`\`bash
git clone https://github.com/yourusername/agent-hub.git
cd agent-hub
npm install
node server.js
\`\`\`

The server will start at \`http://127.0.0.1:3457\`.

---

## Code of Conduct

This project follows a simple principle: be respectful and constructive. Harassment, trolling, and personal attacks are not welcome.

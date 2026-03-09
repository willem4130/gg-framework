# @kenkaiiii/ggcoder

<p align="center">
  <strong>The fast, lean coding agent. Four providers. Zero bloat.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/ggcoder"><img src="https://img.shields.io/npm/v/@kenkaiiii/ggcoder?style=for-the-badge" alt="npm version"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

The CLI that sits on top of the [GG Framework](../../README.md). Built on [`@kenkaiiii/gg-ai`](../gg-ai/README.md) and [`@kenkaiiii/gg-agent`](../gg-agent/README.md).

---

## Install

```bash
npm i -g @kenkaiiii/ggcoder
```

---

## Getting started

```bash
ggcoder login    # Pick provider, authenticate
ggcoder          # Start coding
```

OAuth for Anthropic and OpenAI (log in once, auto-refresh). API keys for GLM and Moonshot. Up and running in seconds either way.

---

## Four providers, one agent

Switch mid-conversation with `/model`. Not locked to anyone.

| Provider | Models | Auth |
|---|---|---|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | OAuth |
| **OpenAI** | GPT-4.1, o3, o4-mini | OAuth |
| **Z.AI (GLM)** | GLM-5, GLM-4.7 | API key |
| **Moonshot** | Kimi K2.5 | API key |

---

## Slash commands

Everything runs through slash commands inside the session. Not CLI flags.

```bash
/model claude-opus-4-6       # Switch models on the fly
/model kimi-k2.5
/compact                      # Compress context when it gets long

# Built-in workflows
/scan          # Dead code, bugs, security issues (5 parallel agents)
/verify        # Verify against docs and best practices (8 parallel agents)
/research      # Research best tools and patterns for your stack
/init          # Generate CLAUDE.md for your project
/setup-lint    # Generate a /fix command for your stack
/setup-commit  # Generate a /commit command with quality checks
/setup-tests   # Set up testing + generate /test
/setup-update  # Generate an /update command for deps
```

---

## Custom commands

Drop a markdown file in `.gg/commands/` and it becomes a slash command.

```markdown
---
name: deploy
description: Build, test, and deploy to production
---

1. Run the test suite
2. Build for production
3. Deploy using the project's deploy script
4. Verify the deployment is healthy
```

Now `/deploy` works in that project. Your React app gets `/deploy` and `/storybook`. Your API gets `/migrate` and `/seed`. Different projects, different commands.

---

## Skills

Reusable behaviors across projects. Drop `.md` files in:

- `~/.gg/skills/` for global skills (available everywhere)
- `.gg/skills/` for project-specific skills

They get loaded into the system prompt automatically. The agent knows what it can do without you explaining it each session.

---

## Project guidelines

Drop a `CLAUDE.md` or `AGENTS.md` in your repo root (or any parent directory). GG Coder picks it up automatically.

Your rules. Your conventions. The agent follows them.

---

## Tools

GG Coder comes with a focused set of tools:

| Tool | What it does |
|---|---|
| `bash` | Run shell commands |
| `read` | Read file contents |
| `write` | Write files |
| `edit` | Surgical string replacements |
| `grep` | Search file contents (regex) |
| `find` | Find files by glob pattern |
| `ls` | List directory contents |
| `web_fetch` | Fetch URL content |
| `subagent` | Spawn parallel sub-agents |

Plus the [Grep MCP](https://grep.dev) for searching across 1M+ public GitHub repos.

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) - tutorials and demos
- [Skool community](https://skool.com/kenkai) - come hang out

---

## License

MIT

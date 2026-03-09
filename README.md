# GG Framework

<p align="center">
  <strong>Modular TypeScript framework for building LLM-powered apps. From raw streaming to full coding agent.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/ggcoder"><img src="https://img.shields.io/npm/v/@kenkaiiii/ggcoder?style=for-the-badge" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

Three packages. Each one works on its own. Stack them together and you get a full coding agent.

| Package | What it does | README |
|---|---|---|
| [`@kenkaiiii/gg-ai`](https://www.npmjs.com/package/@kenkaiiii/gg-ai) | Unified LLM streaming API across four providers | [packages/gg-ai](packages/gg-ai/README.md) |
| [`@kenkaiiii/gg-agent`](https://www.npmjs.com/package/@kenkaiiii/gg-agent) | Agent loop with multi-turn tool execution | [packages/gg-agent](packages/gg-agent/README.md) |
| [`@kenkaiiii/ggcoder`](https://www.npmjs.com/package/@kenkaiiii/ggcoder) | CLI coding agent with OAuth, tools, and TUI | [packages/ggcoder](packages/ggcoder/README.md) |

```
@kenkaiiii/gg-ai (standalone)
  └─► @kenkaiiii/gg-agent (depends on gg-ai)
        └─► @kenkaiiii/ggcoder (depends on both)
```

---

## Why this exists

I've been writing code since before the AI wave hit. Been using Claude Code since release, and have gone through just about every coding agent out there since early 2024. I know what works and what's just overhead.

Claude Code is great. I use it daily. But after enough time with it, you notice how much baggage it carries. ~15,000 tokens of system prompt on every single request. The Claude Agent SDK does the same thing since it's Claude Code under the hood.

GG Framework is what happens when you strip all of that out and keep only what actually matters. A streaming layer, an agent loop, and a CLI. Each one clean enough to use on its own.

---

## The system prompt problem

Every token in the system prompt gets processed on **every single turn**. It's not a one-time cost. It's a tax on every request.

| | **Claude Code / Agent SDK** | **GG Coder** |
|---|---|---|
| System prompt size | ~15,000 tokens | **~1,100 tokens** |
| Ratio | baseline | **~13x smaller** |

### Why you should care

- **Slower responses.** More input tokens = longer time-to-first-token. In a 30-turn session, that wait adds up to minutes.
- **Worse instruction following.** More rules = more things the model ignores. "Lost in the middle" is well-documented. A 1,100 token prompt gets read. A 15,000 token one gets skimmed.
- **Context fills up faster.** ~15,000 tokens sitting in your window permanently. That's ~7.5% of a 200K model gone before you say hello. You hit compaction sooner, lose history faster, and the agent forgets what it was doing.
- **Higher cost.** Input tokens aren't free. Every cache miss charges you for the full bloat. Smaller prompt = smaller bill.

---

## The MCP problem

Same philosophy applies to tools. People collect MCPs like Pokemon. Slack MCP, GitHub MCP, Notion MCP, five different file system MCPs. Every single one injects its tool descriptions into the context. The model now has to figure out which of 40+ tools to use for any given task.

This doesn't help. It confuses the agent. More tool descriptions = more noise = worse tool selection. The model spends tokens reasoning about tools it will never call.

GG Coder ships with one MCP: [Grep](https://grep.dev). That's it. It lets the agent search across 1M+ public GitHub repos to verify implementations against real-world code. Correct API usage, library idioms, production patterns. One tool that actually makes the output better.

You can still add your own MCPs if you need them. But start with less. You'll get better results.

---

## Quick start

### Streaming API

```bash
npm i @kenkaiiii/gg-ai
```

```typescript
import { stream } from "@kenkaiiii/gg-ai";

// Stream events
for await (const event of stream({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  apiKey: "sk-...",
  messages: [{ role: "user", content: "Hello!" }],
})) {
  if (event.type === "text_delta") process.stdout.write(event.text);
}

// Or just await the final response
const response = await stream({
  provider: "openai",
  model: "gpt-4.1",
  apiKey: "sk-...",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Agent loop

```bash
npm i @kenkaiiii/gg-agent
```

```typescript
import { Agent } from "@kenkaiiii/gg-agent";
import { z } from "zod";

const agent = new Agent({
  provider: "moonshot",
  model: "kimi-k2.5",
  apiKey: "sk-...",
  system: "You are a helpful assistant.",
  tools: [{
    name: "get_weather",
    description: "Get the weather for a city",
    parameters: z.object({ city: z.string() }),
    async execute({ city }) {
      return { temperature: 72, condition: "sunny" };
    },
  }],
});

for await (const event of agent.prompt("What's the weather in Tokyo?")) {
  // text_delta, tool_call_start, tool_call_end, agent_done, etc.
}
```

### CLI

```bash
npm i -g @kenkaiiii/ggcoder
ggcoder login
ggcoder
```

---

## For developers

```bash
git clone https://github.com/KenKaiii/gg-framework.git
cd gg-framework
pnpm install
pnpm build
```

TypeScript 5.9 + pnpm workspaces + Ink 6 + React 19 + Vitest 4 + Zod v4

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) - tutorials and demos
- [Skool community](https://skool.com/kenkai) - come hang out

---

## License

MIT

---

<p align="center">
  <strong>Less bloat. More coding. Four providers. Three packages. One framework.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kenkaiiii/ggcoder"><img src="https://img.shields.io/badge/Install-npm%20i%20--g%20%40kenkaiiii%2Fggcoder-blue?style=for-the-badge" alt="Install"></a>
</p>

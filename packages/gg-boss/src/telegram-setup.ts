import readline from "node:readline/promises";
import chalk from "chalk";
import { COLORS, GRADIENT, LOGO_LINES, LOGO_GAP, BRAND, AUTHOR, VERSION } from "./branding.js";
import {
  loadBossTelegramConfig,
  saveBossTelegramConfig,
  type BossTelegramConfig,
} from "./serve-mode.js";

/**
 * `ggboss telegram` — interactive setup wizard. Mirrors `ggcoder telegram` but
 * writes to `~/.gg/boss/telegram.json` so the boss has its own bot identity
 * (distinct from ggcoder's coding bot).
 */
export async function runBossTelegramSetup(): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[H");
  printSetupBanner();

  const existing = await loadBossTelegramConfig();
  if (existing) {
    console.log(
      chalk.hex(COLORS.textDim)("  Current config:\n") +
        chalk.hex(COLORS.textDim)(
          `    Bot token: ${existing.botToken.slice(0, 10)}...${existing.botToken.slice(-4)}\n`,
        ) +
        chalk.hex(COLORS.textDim)(`    User ID:   ${existing.userId}\n`),
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      chalk.hex(COLORS.accent)("  Step 1: Bot Token\n") +
        chalk.hex(COLORS.textDim)("    1. Open BotFather: ") +
        chalk.hex(COLORS.primary).underline("https://t.me/BotFather") +
        "\n" +
        chalk.hex(COLORS.textDim)("    2. Send /newbot and follow the prompts\n") +
        chalk.hex(COLORS.textDim)("    3. Copy the bot token\n"),
    );

    const tokenPrompt = existing
      ? chalk.hex(COLORS.primary)("  Paste bot token (enter to keep current): ")
      : chalk.hex(COLORS.primary)("  Paste bot token: ");
    const tokenInput = await rl.question(tokenPrompt);
    const botToken = tokenInput.trim() || existing?.botToken;

    if (!botToken) {
      console.log(chalk.hex(COLORS.error)("\n  No bot token provided. Setup cancelled."));
      return;
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      console.log(
        chalk.hex(COLORS.error)("\n  Invalid token format. Expected: 123456789:ABCdef..."),
      );
      return;
    }

    console.log(
      chalk.hex(COLORS.accent)("\n  Step 2: User ID\n") +
        chalk.hex(COLORS.textDim)("    1. Open userinfobot: ") +
        chalk.hex(COLORS.primary).underline("https://t.me/userinfobot") +
        "\n" +
        chalk.hex(COLORS.textDim)("    2. Send any message — it replies with your numeric ID\n") +
        chalk.hex(COLORS.textDim)("    Only this user ID can control the boss.\n"),
    );

    const userPrompt = existing
      ? chalk.hex(COLORS.primary)(`  Your Telegram user ID (enter to keep ${existing.userId}): `)
      : chalk.hex(COLORS.primary)("  Your Telegram user ID: ");
    const userInput = await rl.question(userPrompt);
    const userId = userInput.trim() ? parseInt(userInput.trim(), 10) : existing?.userId;

    if (!userId || isNaN(userId)) {
      console.log(chalk.hex(COLORS.error)("\n  Invalid user ID. Must be a number."));
      return;
    }

    console.log(chalk.hex(COLORS.textDim)("\n  Verifying bot token..."));
    const verifyRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      method: "POST",
    });
    const verifyData = (await verifyRes.json()) as {
      ok: boolean;
      result?: { username: string; first_name: string };
    };
    if (!verifyData.ok || !verifyData.result) {
      console.log(
        chalk.hex(COLORS.error)(
          "\n  Invalid bot token — Telegram rejected it. Check and try again.",
        ),
      );
      return;
    }

    const config: BossTelegramConfig = { botToken, userId };
    await saveBossTelegramConfig(config);

    console.log(
      chalk.hex(COLORS.success)(
        `\n  ✓ Connected to @${verifyData.result.username} (${verifyData.result.first_name})\n`,
      ) +
        chalk.hex(COLORS.success)(`  ✓ Authorized user ID: ${userId}\n\n`) +
        chalk.hex(COLORS.primary)("  To start:\n") +
        chalk.hex(COLORS.textDim)("    ggboss serve\n"),
    );
  } finally {
    rl.close();
  }
}

function gradientText(text: string): string {
  let i = 0;
  return text
    .split("")
    .map((ch) => (ch === " " ? ch : chalk.hex(GRADIENT[i++ % GRADIENT.length]!)(ch)))
    .join("");
}

function printSetupBanner(): void {
  console.log();
  console.log(
    `  ${gradientText(LOGO_LINES[0]!)}${LOGO_GAP}` +
      chalk.hex(COLORS.primary).bold(BRAND) +
      chalk.hex(COLORS.textDim)(` v${VERSION}`) +
      chalk.hex(COLORS.textDim)(" · By ") +
      chalk.white.bold(AUTHOR),
  );
  console.log(
    `  ${gradientText(LOGO_LINES[1]!)}${LOGO_GAP}` + chalk.hex(COLORS.accent)("Telegram Setup"),
  );
  console.log(
    `  ${gradientText(LOGO_LINES[2]!)}${LOGO_GAP}` + chalk.hex(COLORS.textDim)("Remote Control"),
  );
  console.log();
}

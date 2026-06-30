import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthStorage, NotLoggedInError, XIAOMI_CREDITS_KEY } from "./auth-storage.js";

async function tempAuthFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gg-core-auth-storage-test-"));
  return path.join(dir, "auth.json");
}

const tmpFiles: string[] = [];

afterEach(async () => {
  while (tmpFiles.length > 0) {
    const f = tmpFiles.pop()!;
    await fs.rm(path.dirname(f), { recursive: true, force: true }).catch(() => {});
  }
});

async function makeStorage(): Promise<AuthStorage> {
  const filePath = await tempAuthFile();
  tmpFiles.push(filePath);
  return new AuthStorage(filePath);
}

describe("AuthStorage — Xiaomi dual credential (Token Plan vs. API Credits)", () => {
  it("hasProviderAuth is satisfied by either the Token Plan or the Credits key", async () => {
    const storage = await makeStorage();
    expect(await storage.hasProviderAuth("xiaomi")).toBe(false);

    await storage.setCredentials("xiaomi", {
      accessToken: "tp-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    });
    expect(await storage.hasProviderAuth("xiaomi")).toBe(true);

    const credsOnly = await makeStorage();
    await credsOnly.setCredentials(XIAOMI_CREDITS_KEY, {
      accessToken: "credits-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://api.xiaomimimo.com/v1",
    });
    expect(await credsOnly.hasProviderAuth("xiaomi")).toBe(true);
  });

  it("resolveCredentials with explicit storageKeys reads the first match directly, bypassing the provider id", async () => {
    const storage = await makeStorage();
    await storage.setCredentials(XIAOMI_CREDITS_KEY, {
      accessToken: "credits-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://api.xiaomimimo.com/v1",
    });

    // No plain "xiaomi" credential exists — a storageKeys-less resolve fails...
    await expect(storage.resolveCredentials("xiaomi")).rejects.toThrow(NotLoggedInError);

    // ...but resolving with the ordered storage keys succeeds and returns the
    // Credits credential untouched (no refresh attempted — static API key).
    const creds = await storage.resolveCredentials("xiaomi", {
      storageKeys: [XIAOMI_CREDITS_KEY],
    });
    expect(creds.accessToken).toBe("credits-key");
    expect(creds.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  });

  it("resolveCredentials prefers the first storageKey, falling back to the next when only that's configured", async () => {
    // Mirrors mimo-v2.5-pro: prefer Token Plan ("xiaomi"), fall back to
    // API Credits when only that's configured.
    const tokenPlanOnly = await makeStorage();
    await tokenPlanOnly.setCredentials("xiaomi", {
      accessToken: "tp-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    });
    expect(
      (
        await tokenPlanOnly.resolveCredentials("xiaomi", {
          storageKeys: ["xiaomi", XIAOMI_CREDITS_KEY],
        })
      ).accessToken,
    ).toBe("tp-key");

    const creditsOnly = await makeStorage();
    await creditsOnly.setCredentials(XIAOMI_CREDITS_KEY, {
      accessToken: "credits-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://api.xiaomimimo.com/v1",
    });
    expect(
      (
        await creditsOnly.resolveCredentials("xiaomi", {
          storageKeys: ["xiaomi", XIAOMI_CREDITS_KEY],
        })
      ).accessToken,
    ).toBe("credits-key");

    const both = await makeStorage();
    await both.setCredentials("xiaomi", {
      accessToken: "tp-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    });
    await both.setCredentials(XIAOMI_CREDITS_KEY, {
      accessToken: "credits-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://api.xiaomimimo.com/v1",
    });
    // Both configured — the FIRST preference (Token Plan) wins.
    expect(
      (await both.resolveCredentials("xiaomi", { storageKeys: ["xiaomi", XIAOMI_CREDITS_KEY] }))
        .accessToken,
    ).toBe("tp-key");
  });

  it("resolveCredentials throws NotLoggedInError when none of the requested storageKeys are configured", async () => {
    const storage = await makeStorage();
    await expect(
      storage.resolveCredentials("xiaomi", { storageKeys: [XIAOMI_CREDITS_KEY] }),
    ).rejects.toThrow(NotLoggedInError);
    await expect(
      storage.resolveCredentials("xiaomi", { storageKeys: ["xiaomi", XIAOMI_CREDITS_KEY] }),
    ).rejects.toThrow(NotLoggedInError);
  });

  it("storageKeys of exactly [provider] falls through to normal provider resolution", async () => {
    const storage = await makeStorage();
    await storage.setCredentials("xiaomi", {
      accessToken: "tp-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    });
    const creds = await storage.resolveCredentials("xiaomi", { storageKeys: ["xiaomi"] });
    expect(creds.accessToken).toBe("tp-key");
  });

  it("pickStorageKey returns the first key with stored credentials, or undefined", async () => {
    const storage = await makeStorage();
    expect(await storage.pickStorageKey(["xiaomi", XIAOMI_CREDITS_KEY])).toBeUndefined();

    await storage.setCredentials(XIAOMI_CREDITS_KEY, {
      accessToken: "credits-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
    });
    expect(await storage.pickStorageKey(["xiaomi", XIAOMI_CREDITS_KEY])).toBe(XIAOMI_CREDITS_KEY);

    await storage.setCredentials("xiaomi", {
      accessToken: "tp-key",
      refreshToken: "",
      expiresAt: Date.now() + 1_000_000,
    });
    // Order matters — "xiaomi" is listed first.
    expect(await storage.pickStorageKey(["xiaomi", XIAOMI_CREDITS_KEY])).toBe("xiaomi");
  });
});

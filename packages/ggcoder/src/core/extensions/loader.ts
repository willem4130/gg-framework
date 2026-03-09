import fs from "node:fs/promises";
import path from "node:path";
import type { Extension, ExtensionContext, ExtensionFactory } from "./types.js";

export class ExtensionLoader {
  private loaded: Extension[] = [];

  async loadAll(extensionsDir: string, context: ExtensionContext): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(extensionsDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      const filePath = path.join(extensionsDir, file);

      try {
        const mod = await import(filePath);
        const factory: ExtensionFactory =
          typeof mod.default === "function" ? mod.default : mod.createExtension;

        if (typeof factory !== "function") {
          console.error(`Extension ${file}: no default export or createExtension function`);
          continue;
        }

        const extension = factory();
        await extension.activate(context);
        this.loaded.push(extension);
      } catch (err) {
        console.error(
          `Failed to load extension ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  getLoaded(): Extension[] {
    return [...this.loaded];
  }

  async deactivateAll(): Promise<void> {
    for (const ext of this.loaded) {
      try {
        await ext.deactivate?.();
      } catch {
        // Ignore deactivation errors
      }
    }
    this.loaded = [];
  }
}

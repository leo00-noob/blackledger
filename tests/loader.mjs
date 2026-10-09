// Resolves the "@/..." path alias for tests run directly under Node
// (node --experimental-transform-types), without a bundler.
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const target = fileURLToPath(new URL(specifier, context.parentURL));
    if (!/\.[cm]?[jt]sx?$/.test(target) && existsSync(`${target}.ts`)) {
      return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith("@/")) {
    let target = fileURLToPath(new URL(specifier.slice(2), root));
    if (!/\.[cm]?[jt]sx?$/.test(target)) target = existsSync(`${target}.ts`) ? `${target}.ts` : join(target, "index.ts");
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return next(specifier, context);
}

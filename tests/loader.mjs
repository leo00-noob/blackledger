// Resolves the "@/..." path alias for tests run directly under Node
// (node --experimental-transform-types), without a bundler.
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    let target = new URL(specifier.slice(2), root).pathname;
    if (!/\.[cm]?[jt]sx?$/.test(target)) target += ".ts";
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return next(specifier, context);
}

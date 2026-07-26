import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  accentCssVar,
  colorCssVar,
  colorTokens,
  moduleAccentTokens,
  typographyTokens,
} from "./tokens";

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "tokens.css");
const css = readFileSync(cssPath, "utf-8");

function valueOf(varName: string): string | undefined {
  const match = css.match(new RegExp(`${varName}:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

describe("tokens.css mirrors tokens.ts", () => {
  it.each(Object.entries(colorTokens))("color token %s", (key, expected) => {
    expect(valueOf(colorCssVar(key as keyof typeof colorTokens))).toBe(expected);
  });

  it.each(Object.entries(moduleAccentTokens))("module accent %s", (key, expected) => {
    expect(valueOf(accentCssVar(key as keyof typeof moduleAccentTokens))).toBe(expected);
  });

  it("font-sans matches", () => {
    expect(valueOf("--font-sans")).toBe(typographyTokens.fontSans);
  });

  it("font-mono matches", () => {
    expect(valueOf("--font-mono")).toBe(typographyTokens.fontMono);
  });
});

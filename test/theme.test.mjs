import assert from "node:assert";
import { normalizeTheme } from "../lib/theme.mjs";
assert.equal(normalizeTheme("day"), "day");
assert.equal(normalizeTheme("dark"), "dark");
assert.equal(normalizeTheme("light"), "day");   // 잘못된 값 → 기본 day
assert.equal(normalizeTheme(null), "day");
console.log("theme: ok");

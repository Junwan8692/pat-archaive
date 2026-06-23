import assert from "node:assert";
import { normalizeSize } from "../lib/cardsize.mjs";
assert.equal(normalizeSize("s"), "s");
assert.equal(normalizeSize("m"), "m");
assert.equal(normalizeSize("l"), "l");
assert.equal(normalizeSize("xl"), "m");   // 잘못된 값 → 기본 m
assert.equal(normalizeSize(null), "m");
assert.equal(normalizeSize(undefined), "m");
console.log("cardsize: ok");

import assert from "node:assert";
import { sha256Hex } from "../lib/hash.mjs";

const h = await sha256Hex("test");
assert.equal(h, "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
assert.equal((await sha256Hex("")).length, 64);
console.log("hash: ok");

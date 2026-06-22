// pat-archive/test/authors.test.mjs
import assert from "node:assert";
import { addAuthorName, removeAuthorName } from "../lib/authors.mjs";

assert.deepEqual(addAuthorName(["Pat"], "Moon"), ["Pat","Moon"]);
assert.deepEqual(addAuthorName(["Pat"], "Pat"), ["Pat"]);      // 중복 무시
assert.deepEqual(addAuthorName(["Pat"], " "), ["Pat"]);        // 공백 무시
assert.deepEqual(removeAuthorName(["Pat","Moon"], "Moon"), ["Pat"]);
console.log("authors: ok");

// pat-archive/test/data-layer.test.mjs
import assert from "node:assert";
import { mapRow, toRow } from "../lib/map.mjs";

// snake_case row → camelCase 객체
const row = { id:"1", created_at:111, comment_count:3, prompt_intro:"hi", tags:["AI"] };
const m = mapRow(row);
assert.equal(m.createdAt, 111);
assert.equal(m.commentCount, 3);
assert.equal(m.promptIntro, "hi");
assert.deepEqual(m.tags, ["AI"]);

// camelCase 입력 → snake_case row (insert/update용)
const r = toRow({ title:"t", createdAt:222, commentCount:0, promptText:"p", tags:["Idea"] });
assert.equal(r.created_at, 222);
assert.equal(r.comment_count, 0);
assert.equal(r.prompt_text, "p");
assert.equal(r.title, "t");

console.log("data-layer: ok");

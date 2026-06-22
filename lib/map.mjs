// pat-archive/lib/map.mjs
const SNAKE = {
  createdAt:"created_at", pinnedAt:"pinned_at", commentCount:"comment_count",
  promptIntro:"prompt_intro", promptEnv:"prompt_env", promptText:"prompt_text",
  promptTip:"prompt_tip",
};
const CAMEL = Object.fromEntries(Object.entries(SNAKE).map(([k,v]) => [v,k]));

export function mapRow(row) {            // DB row → 앱 객체
  const o = {};
  for (const [k,v] of Object.entries(row)) o[CAMEL[k] ?? k] = v;
  return o;
}
export function toRow(obj) {             // 앱 객체 → DB row
  const o = {};
  for (const [k,v] of Object.entries(obj)) o[SNAKE[k] ?? k] = v;
  return o;
}

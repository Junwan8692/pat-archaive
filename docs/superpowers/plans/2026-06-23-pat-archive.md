# Pat Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `hyc_gongyoulink` 링크 아카이브를 Gumroad풍 네오브루탈리즘으로 리스킨하고, Firebase→Supabase로 백엔드 이전한 뒤 Vercel에 배포한다.

**Architecture:** 정적 단일 페이지 앱. `index.html`(마크업) + `style.css`(디자인 시스템) + `app.js`(앱 로직) + `supabase.js`(DB 클라이언트). 원본 `index.html`의 구조·기능을 그대로 포팅하되, 데이터 계층만 Firestore→Supabase로 치환하고 스타일을 네오브루탈로 교체.

**Tech Stack:** Vanilla JS (ES module, 빌드 없음), Supabase JS v2 (Postgres + Realtime + Storage), microlink.io API, Vercel 정적 배포.

## Global Constraints

- 브랜딩: 제목 **PAT ARCHIVE**(부제 없음), 헤더 명언 **삭제**, 추천픽 섹션명 **Pat recommendation**, `<title>` = `Pat Archive`.
- 태그 12종 정확히: `AI, Vibecoding, Image, Video, Product, Github, ComfyUI, Design, Prompt, Idea, Assets, ETC`. 프롬프트 상세 입력 트리거 태그는 **`Prompt`**.
- 디자인 토큰은 `Design.md` 단일 출처. 핑크 `#FF90E8` / 옐로 `#FFC900` / 검정 `#000` / 흰색 `#FFF`, 테두리 `3px solid #000`, 그림자 `4px 4px 0 #000`(blur 0), `border-radius: 0`, 폰트 `Space Grotesk`.
- 백엔드: Supabase. anon 공개키만 코드 노출. 데이터는 빈 DB 새 시작(원작자 데이터 미이전).
- 작성자 퀵버튼 기본값 `Pat` 1개. `+`로 추가, `✕`로 삭제, localStorage(`patAuthors`) 영속.
- 공지 팝업 기능 **제거**.
- 원본 참조 경로: `D:\code\share_url\hyc_gongyoulink\index.html` (읽기 전용 참고, 수정 금지).
- 작업 루트: `D:\code\share_url\pat-archive`.

## Subagent 트랙 배정

| 트랙 | 담당 | 태스크 | 병렬 가능? |
|------|------|--------|-----------|
| **백엔드** | Backend Architect | 1, 2, 3 | 1→2→3 순차 |
| **프론트** | Frontend Developer | 4, 5, 6 | 4·5 선행, 6은 5 이후. 백엔드와 병렬 가능 |
| **통합** | Frontend Developer | 7 | 3·6 완료 후 |
| **디자인 검수** | UI Designer / Accessibility Auditor | 8 | 7 완료 후 |
| **배포** | DevOps Automator | 9 | 8 통과 후 |

의존성: **Task 2(supabase.js)** 와 **Task 4/5(UI)** 는 서로 독립 → 백엔드·프론트 동시 착수 가능. **Task 7(통합 배선)** 이 합류 지점.

---

## Track A — 백엔드 (Supabase)

### Task 1: Supabase 스키마 정의

**Files:**
- Create: `pat-archive/schema.sql`

**Interfaces:**
- Produces: 테이블 `links`, `comments`; RPC `increment_views(row_id uuid)`, `adjust_likes(row_id uuid, delta int)`; Storage 버킷 `prompts`. app.js가 이 이름들에 의존.

- [ ] **Step 1: schema.sql 작성**

```sql
-- Pat Archive — Supabase schema. Supabase SQL Editor에서 1회 실행.

create table if not exists links (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 500),
  url           text,
  "desc"        text,
  author        text,
  tags          text[] default '{}',
  image         text,
  images        text[] default '{}',
  pinned        boolean default false,
  pinned_at     bigint,
  created_at    bigint not null,
  views         int default 0,
  likes         int default 0,
  comment_count int default 0,
  prompt_intro  text,
  prompt_env    text,
  prompt_text   text,
  prompt_tip    text
);

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references links(id) on delete cascade,
  author     text,
  text       text not null check (char_length(text) between 1 and 1000),
  created_at bigint not null
);

create index if not exists comments_link_id_idx on comments(link_id);

-- 원자적 증감 RPC
create or replace function increment_views(row_id uuid) returns void
  language sql as $$ update links set views = views + 1 where id = row_id $$;

create or replace function adjust_likes(row_id uuid, delta int) returns void
  language sql as $$ update links set likes = likes + delta where id = row_id $$;

-- RLS (로그인 없는 신뢰 그룹 정책 — firestore.rules 동등)
alter table links enable row level security;
alter table comments enable row level security;

create policy links_read   on links for select using (true);
create policy links_insert on links for insert with check (char_length(title) between 1 and 500);
create policy links_update on links for update using (true);
create policy links_delete on links for delete using (true);

create policy comments_read   on comments for select using (true);
create policy comments_insert on comments for insert with check (char_length(text) between 1 and 1000);
create policy comments_delete on comments for delete using (true);
-- comments update 정책 없음 = 수정 불가

-- Realtime publication
alter publication supabase_realtime add table links;
alter publication supabase_realtime add table comments;
```

- [ ] **Step 2: 수동 검증 항목 기록 (README에서 안내)**

Storage 버킷 `prompts`는 SQL로 안 만들고 대시보드에서 생성(Public 버킷). README Task 9에서 안내. 여기선 주석으로만 명시.

- [ ] **Step 3: 커밋**

```bash
git add pat-archive/schema.sql
git commit -m "feat(backend): Supabase 스키마·RLS·RPC 정의"
```

---

### Task 2: Supabase 클라이언트

**Files:**
- Create: `pat-archive/supabase.js`

**Interfaces:**
- Consumes: Supabase 프로젝트 URL·anon key (Task 9에서 사용자가 발급, 플레이스홀더로 시작).
- Produces: `export const supabase`, `export const STORAGE_BUCKET = 'prompts'`.

- [ ] **Step 1: supabase.js 작성**

```js
// Supabase 클라이언트. URL·anon key는 본인 프로젝트 값으로 교체.
// anon key는 공개되어도 안전(RLS로 보호). 자세한 건 README 참고.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";   // ← 교체
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";                  // ← 교체

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const STORAGE_BUCKET = "prompts";
```

- [ ] **Step 2: 검증 (플레이스홀더 확인)**

Run: `node -e "const s=require('fs').readFileSync('pat-archive/supabase.js','utf8'); if(!s.includes('YOUR_PROJECT')) throw new Error('placeholder missing'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add pat-archive/supabase.js
git commit -m "feat(backend): Supabase 클라이언트 스캐폴드"
```

---

### Task 3: 데이터 계층 (app.js) — Firestore→Supabase 포팅

**Files:**
- Create: `pat-archive/app.js`
- Reference: `D:\code\share_url\hyc_gongyoulink\index.html:1636-2406` (원본 인라인 로직)
- Test: `pat-archive/test/data-layer.test.mjs`

**Interfaces:**
- Consumes: `supabase`, `STORAGE_BUCKET` from `./supabase.js`.
- Produces (window 전역, index.html이 호출): `openModal`, `closeModal`, `saveLink`, `onUrlChange`, `handleBgClick`, `_openDetail`, `closeDetail`, `_toggleLike`, `_copyPrompt`, `submitComment`, `_editLink`, `_deleteLink`, `_filterByAuthor`, `_clearAuthorFilter`, `_carouselPrev/Next/Go`. 그리고 작성자 퀵버튼 API `addAuthor`, `_removeAuthor`, `_setAuthor`(Task 6).

**포팅 규칙 (원본 → Supabase):**

| 원본 (Firestore) | → 신규 (Supabase) |
|---|---|
| `onSnapshot(query(colRef, orderBy('createdAt','desc')), cb)` | 초기 `await supabase.from('links').select('*').order('created_at',{ascending:false})` + `supabase.channel('links').on('postgres_changes',{event:'*',schema:'public',table:'links'}, reload).subscribe()` |
| 필드 `createdAt/pinnedAt/commentCount/promptIntro/...` | snake_case `created_at/pinned_at/comment_count/prompt_intro/...` — 로드 직후 `mapRow()`로 camelCase 변환해 기존 render 코드 그대로 사용 |
| `addDoc(colRef, data)` | `supabase.from('links').insert(toRow(data))` |
| `updateDoc(doc(db,'links',id), data)` | `supabase.from('links').update(toRow(data)).eq('id', id)` |
| `deleteDoc` + 댓글 수동삭제 | `supabase.from('links').delete().eq('id', id)` (FK `on delete cascade`가 댓글 자동삭제 → 수동 루프 제거) |
| `updateDoc(..., {views: increment(1)})` | `supabase.rpc('increment_views',{row_id:id})` |
| `updateDoc(..., {likes: increment(±1)})` | `supabase.rpc('adjust_likes',{row_id:id, delta:±1})` |
| 댓글 `collection(...,'comments')` onSnapshot | `supabase.from('comments').select('*').eq('link_id',id).order('created_at')` + 채널 구독 |
| 댓글 추가 + commentCount increment | `insert` 후 `update comment_count = comment_count+1` (또는 별도 rpc 불필요, 단순 update) |
| Storage `uploadBytes`+`getDownloadURL` | `supabase.storage.from(STORAGE_BUCKET).upload(path, blob)` + `getPublicUrl(path)` |
| 공지 팝업 IIFE + `closeNotice` | **삭제** |

나머지 순수 UI 함수(`render`, `renderFeatured`, `_openDetail`의 DOM 조립, 캐러셀, 검색/정렬/태그 필터, `escHtml`, `getDomain`, `getSiteEmoji`, `compressToBlob`, microlink `fetchMeta`)는 **원본 그대로 복사**. `getSiteEmoji`도 그대로 유지.

- [ ] **Step 1: 변환 헬퍼 테스트 작성 (실패하는 테스트)**

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `node pat-archive/test/data-layer.test.mjs`
Expected: FAIL — `Cannot find module '../lib/map.mjs'`

- [ ] **Step 3: 매핑 헬퍼 구현**

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node pat-archive/test/data-layer.test.mjs`
Expected: `data-layer: ok`

- [ ] **Step 5: app.js 작성 (원본 포팅 + 위 매핑·치환 규칙 적용)**

원본 `index.html:1636-2406`의 로직을 `app.js`로 옮기고, 상단 포팅 표대로 Firestore 호출을 Supabase로 치환. `import { supabase, STORAGE_BUCKET } from "./supabase.js"`, `import { mapRow, toRow } from "./lib/map.mjs"`. 로드/실시간은 다음 패턴:

```js
import { supabase, STORAGE_BUCKET } from "./supabase.js";
import { mapRow, toRow } from "./lib/map.mjs";

let links = [];
async function loadLinks() {
  const { data, error } = await supabase.from("links")
    .select("*").order("created_at", { ascending: false });
  if (error) { document.getElementById("status").textContent = "DB 연결 실패: " + error.message; return; }
  links = data.map(mapRow);
  document.getElementById("status").style.display = "none";
  document.getElementById("grid").style.display = "grid";
  render(); renderFeatured();
}
supabase.channel("links-rt")
  .on("postgres_changes", { event: "*", schema: "public", table: "links" }, loadLinks)
  .subscribe();
loadLinks();
```

저장(`saveLink`/`savePrompt`)은 `insert(toRow({...}))`, 조회수 `supabase.rpc("increment_views",{row_id:id})`, 좋아요 `supabase.rpc("adjust_likes",{row_id:id, delta:liked?-1:1})`, 삭제 `supabase.from("links").delete().eq("id",id)` (cascade로 댓글 자동삭제). 댓글 로드/추가는 `comments` 테이블 + `link_id`. 이미지 업로드:

```js
const path = `${Date.now()}_${safeName}`;
await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
imageUrls.push(pub.publicUrl);
```

- [ ] **Step 6: 커밋**

```bash
git add pat-archive/app.js pat-archive/lib/map.mjs pat-archive/test/data-layer.test.mjs
git commit -m "feat(backend): app.js 데이터 계층 Supabase 포팅 + 매핑 헬퍼"
```

---

## Track B — 프론트 (디자인 시스템 + 마크업)

### Task 4: 네오브루탈 디자인 시스템 (style.css)

**Files:**
- Create: `pat-archive/style.css`
- Reference: `pat-archive/Design.md` (토큰·컴포넌트 스펙 단일 출처)

**Interfaces:**
- Produces: `index.html`이 쓰는 CSS 클래스 — 원본과 **동일한 클래스명** 유지(`.card`, `.card-thumb`, `.card-title`, `.tag-btn`, `.modal`, `.detail-modal`, `.like-btn`, `.featured-section` 등). 비주얼만 네오브루탈로 재정의.

- [ ] **Step 1: 토큰·기본 골격 작성**

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');
:root{
  --pink:#FF90E8; --yellow:#FFC900; --black:#000; --white:#FFF;
  --mint:#23A094; --purple:#90A8ED; --orange:#FF7051; --lime:#B4F39E;
  --bg:#F5F5F5; --muted:#666; --bw:3px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Space Grotesk',Arial,sans-serif;background:var(--bg);color:var(--black);font-size:14px;min-height:100vh}
.box,.card,.modal,.detail-modal{border:var(--bw) solid var(--black);border-radius:0;background:var(--white);box-shadow:4px 4px 0 var(--black)}
```

- [ ] **Step 2: 컴포넌트별 스타일 작성 (Design.md §4 따라)**

원본 클래스명 그대로, Design.md 컴포넌트 스펙대로 재정의. 핵심:
- 워드마크 `header h1`: `font-size:clamp(40px,10vw,120px);font-weight:700;letter-spacing:-.03em;color:var(--black)`
- `.card`: 흰 면+3px 테두리+`4px 4px 0` 그림자, `:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--black)}`, 고정 높이 유지
- `.card-tag`/`.tag-btn`: 2px 테두리, 미선택 흰 면, `.active`/선택 시 `background:var(--pink)`
- 버튼류(`.add-btn`,`.btn-save`): 핑크 면+검정 글자+그림자, `:active{transform:translate(4px,4px);box-shadow:0 0 0}`
- `.del-btn`: 면 `var(--orange)`
- `.like-btn.liked`: 면 `var(--pink)`
- `.new-badge`: 노란 면+검정 테두리+`transform:rotate(-4deg)`
- 입력창: 3px 테두리, `:focus{border-color:var(--pink);outline:none}`
- 모달: 4px 테두리+`8px 8px 0` 그림자, radius 0
- 원본의 sparkle/float/blink/shine/marquee 키프레임 및 도트 배경 **제거**

- [ ] **Step 3: 시각 자체점검 (브라우저)**

`pat-archive/index.html`(Task 5 완료 후) 열어 카드·버튼·모달이 Design.md §7 체크리스트(테두리/하드그림자/radius 0/비비드면) 만족하는지 눈으로 확인. (이 스텝은 Task 5 이후 수행)

- [ ] **Step 4: 커밋**

```bash
git add pat-archive/style.css
git commit -m "feat(design): 네오브루탈 디자인 시스템 CSS"
```

---

### Task 5: index.html 마크업 (브랜딩·태그·구조)

**Files:**
- Create: `pat-archive/index.html`
- Reference: `D:\code\share_url\hyc_gongyoulink\index.html:1388-1634` (원본 body 마크업)

**Interfaces:**
- Consumes: `style.css` 클래스, `app.js`의 window 전역 함수.
- Produces: `app.js`가 참조하는 DOM id 전부 유지 — `status, grid, searchInput, sortSelect, modalBg, modalTitle, urlInput, titleInput, descInput, authorInput, detailBg, detail*` 등.

- [ ] **Step 1: 원본 body를 복사 후 변환**

원본 `index.html`의 `<body>`~`</body>` 구조를 복사하되:
- `<head>`의 인라인 `<style>` 제거 → `<link rel="stylesheet" href="style.css">`
- 인라인 `<script type=module>` 제거 → `<script type="module" src="app.js"></script>`
- `<title>` → `Pat Archive`
- 헤더 `h1` → `PAT ARCHIVE` (별 span 제거), `.header-quote`(명언) 요소 **삭제**, `.header-deco-bar`(흐르는 ♥★) **삭제**
- `featured-title` 텍스트 → `Pat recommendation`, 부제 자유
- 공지 팝업 마크업(`noticeBg`) **삭제**

- [ ] **Step 2: 태그 목록 교체**

컨트롤 바 `.tag-filters`와 추가 모달 `.modal-tags` 양쪽의 버튼을 12종으로 교체:

```html
<button class="tag-btn active" data-tag="전체">전체</button>
<button class="tag-btn" data-tag="AI">AI</button>
<button class="tag-btn" data-tag="Vibecoding">Vibecoding</button>
<button class="tag-btn" data-tag="Image">Image</button>
<button class="tag-btn" data-tag="Video">Video</button>
<button class="tag-btn" data-tag="Product">Product</button>
<button class="tag-btn" data-tag="Github">Github</button>
<button class="tag-btn" data-tag="ComfyUI">ComfyUI</button>
<button class="tag-btn" data-tag="Design">Design</button>
<button class="tag-btn" data-tag="Prompt">Prompt</button>
<button class="tag-btn" data-tag="Idea">Idea</button>
<button class="tag-btn" data-tag="Assets">Assets</button>
<button class="tag-btn" data-tag="ETC">ETC</button>
```

추가 모달 태그는 `전체` 빼고 동일. `app.js`에서 프롬프트 필드 트리거 문자열을 `'프롬프트'`→`'Prompt'`로 맞췄는지 확인.

- [ ] **Step 3: 작성자 퀵버튼 영역을 동적 컨테이너로 교체**

원본의 하드코딩 7버튼(혜인…건우)을 제거하고 컨테이너만 남김:

```html
<div class="author-quick-btns" id="authorQuickBtns"></div>
<button type="button" class="author-add-btn" onclick="window.addAuthor()">+ 이름 추가</button>
```

(렌더는 Task 6.)

- [ ] **Step 4: 브라우저 로드 확인**

`pat-archive/index.html`을 브라우저로 열어 콘솔 에러 없이 헤더/태그/그리드 골격이 보이는지 확인(데이터는 Task 9 전까지 비어있음 정상).

- [ ] **Step 5: 커밋**

```bash
git add pat-archive/index.html
git commit -m "feat(frontend): index.html 마크업 — Pat Archive 브랜딩·태그·구조"
```

---

### Task 6: 작성자 퀵버튼 +/✕ (localStorage)

**Files:**
- Modify: `pat-archive/app.js` (전역 함수 추가)
- Test: `pat-archive/test/authors.test.mjs`

**Interfaces:**
- Consumes: DOM `#authorQuickBtns`, 입력칸 `#authorInput`(및 프롬프트 모달 `#pAuthorInput`).
- Produces: `window.addAuthor()`, `window._removeAuthor(name)`, `window._setAuthor(name)`; 순수 헬퍼 `getAuthors()/saveAuthors()` in `lib/authors.mjs`.

- [ ] **Step 1: 헬퍼 테스트 작성 (실패)**

```js
// pat-archive/test/authors.test.mjs
import assert from "node:assert";
import { addAuthorName, removeAuthorName } from "../lib/authors.mjs";

assert.deepEqual(addAuthorName(["Pat"], "Moon"), ["Pat","Moon"]);
assert.deepEqual(addAuthorName(["Pat"], "Pat"), ["Pat"]);      // 중복 무시
assert.deepEqual(addAuthorName(["Pat"], " "), ["Pat"]);        // 공백 무시
assert.deepEqual(removeAuthorName(["Pat","Moon"], "Moon"), ["Pat"]);
console.log("authors: ok");
```

- [ ] **Step 2: 실패 확인**

Run: `node pat-archive/test/authors.test.mjs`
Expected: FAIL — module 없음

- [ ] **Step 3: 순수 헬퍼 구현**

```js
// pat-archive/lib/authors.mjs
export function addAuthorName(list, name){
  const n = (name||"").trim();
  if(!n || list.includes(n)) return list;
  return [...list, n];
}
export function removeAuthorName(list, name){
  return list.filter(x => x !== name);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node pat-archive/test/authors.test.mjs`
Expected: `authors: ok`

- [ ] **Step 5: app.js에 UI 배선 추가**

```js
import { addAuthorName, removeAuthorName } from "./lib/authors.mjs";
const AUTHORS_KEY = "patAuthors";
function getAuthors(){ try{ return JSON.parse(localStorage.getItem(AUTHORS_KEY)) || ["Pat"]; }catch{ return ["Pat"]; } }
function saveAuthors(a){ localStorage.setItem(AUTHORS_KEY, JSON.stringify(a)); }
function renderAuthors(){
  const box = document.getElementById("authorQuickBtns");
  box.innerHTML = getAuthors().map(n => `
    <span class="author-chip">
      <button type="button" onclick="window._setAuthor('${n.replace(/'/g,"\\'")}')">${n}</button>
      <button type="button" class="author-x" onclick="window._removeAuthor('${n.replace(/'/g,"\\'")}')">✕</button>
    </span>`).join("");
}
window._setAuthor = n => {
  const a = document.getElementById("authorInput"); if(a) a.value = n;
  const p = document.getElementById("pAuthorInput"); if(p) p.value = n;
};
window.addAuthor = () => {
  const n = prompt("추가할 이름:"); if(!n) return;
  saveAuthors(addAuthorName(getAuthors(), n)); renderAuthors();
};
window._removeAuthor = n => { saveAuthors(removeAuthorName(getAuthors(), n)); renderAuthors(); };
renderAuthors();
```

`.author-chip`/`.author-x`/`.author-add-btn` 스타일은 style.css에 네오브루탈 칩으로 추가(2px 테두리, hover 시 ✕ 노출).

- [ ] **Step 6: 커밋**

```bash
git add pat-archive/app.js pat-archive/lib/authors.mjs pat-archive/test/authors.test.mjs pat-archive/style.css
git commit -m "feat(frontend): 작성자 퀵버튼 +/✕ localStorage 영속"
```

---

## Track C — 통합 · 검수 · 배포

### Task 7: 통합 배선 검증 (로컬 E2E)

**Files:**
- Modify: 필요 시 `pat-archive/app.js`, `index.html` (id/함수명 불일치 수정)
- Reference: 임시 Supabase 프로젝트(검수자가 무료 생성) 또는 사용자 제공 키

**Interfaces:**
- Consumes: Task 1~6 산출물 전부.

- [ ] **Step 1: 임시 Supabase 연결**

검수 Supabase 프로젝트에 `schema.sql` 실행, `prompts` 버킷 생성(Public), URL·anon key를 `supabase.js`에 임시 기입.

- [ ] **Step 2: 핵심 플로우 수동 검증**

브라우저에서 순서대로 확인하고 결과 기록:
1. 링크 추가(URL 붙여넣기 → microlink 메타 자동) → 그리드에 카드 등장
2. 다른 탭/창에서 열어 **실시간 반영** 확인
3. 카드 클릭 → 상세 모달 → **조회수 +1**
4. 좋아요 토글 → 숫자 증감, 새로고침 후에도 '눌림' 유지(localStorage)
5. 댓글 작성 → 실시간 표시, commentCount 증가
6. Prompt 태그 글 → 프롬프트 섹션 + 복사 버튼 동작
7. 이미지 여러 장 업로드 → Storage 저장 + 캐러셀
8. 수정/삭제(삭제 시 댓글 cascade)
9. 검색·태그필터·정렬·작성자필터
10. 작성자 +추가/✕삭제 → 재방문 유지

- [ ] **Step 3: 발견 버그 수정 + 커밋**

```bash
git add -A
git commit -m "fix(integration): 로컬 E2E 검증 후 배선 수정"
```

---

### Task 8: 디자인 검수 (서브에이전트: UI Designer)

**Files:**
- Create: `pat-archive/docs/design-review.md` (검수 결과)

- [ ] **Step 1: Design.md 체크리스트 대조**

렌더된 화면을 `Design.md §7` 체크리스트로 평가: radius 0 / 3px+ 검정 테두리 / 하드 그림자(blur 0, 검정) / 비비드 면·검정 선 / 제목 대비 / 클릭 눌림 모션 / 장식 애니 제거. 위반 항목을 `design-review.md`에 PASS/FAIL로 기록.

- [ ] **Step 2: 접근성 기본 점검**

대비비(핑크 면+검정 글자 OK), 포커스 가시성, 키보드(Esc 모달 닫힘), `img` alt, 버튼 라벨 확인. FAIL 항목 기록.

- [ ] **Step 3: FAIL 수정 → style.css/index.html 반영 → 커밋**

```bash
git add -A
git commit -m "fix(design): 디자인 검수 지적사항 반영"
```

---

### Task 9: 배포 (Vercel)

**Files:**
- Create: `pat-archive/vercel.json`, `pat-archive/README.md`

- [ ] **Step 1: vercel.json 작성**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "trailingSlash": false
}
```

(정적 사이트라 빌드 설정 불필요. Vercel이 루트 정적 서빙.)

- [ ] **Step 2: README.md 작성 (셋업·배포 가이드)**

내용: ① Supabase 프로젝트 생성 → SQL Editor에서 `schema.sql` 실행 → Storage에 Public `prompts` 버킷 생성 → Project Settings에서 URL·anon key 복사 → `supabase.js`에 기입. ② GitHub repo 생성 후 push. ③ Vercel에서 repo Import(Framework Preset: Other, 빌드 명령 없음) → Deploy. ④ 배포 URL 확인.

- [ ] **Step 3: 최종 커밋 + 배포**

```bash
git add pat-archive/vercel.json pat-archive/README.md
git commit -m "chore(deploy): Vercel 설정 + 셋업 README"
# 이후 GitHub push → Vercel Import (사용자 계정 작업, README 따라)
```

---

## Self-Review

- **Spec coverage:** 브랜딩(T5)·태그(T5)·작성자버튼(T6)·디자인시스템(T4/Design.md)·Supabase 스키마/RLS/RPC(T1)·데이터계층(T3)·Storage(T3)·공지팝업 제거(T3/T5)·기능 유지(T3/T7)·Vercel 배포(T9) → 스펙 전 항목 태스크로 커버됨.
- **Placeholder scan:** supabase.js의 `YOUR_PROJECT`/`YOUR_ANON_KEY`는 의도된 사용자 입력 플레이스홀더(Step 검증·README에서 명시). 그 외 TBD 없음.
- **Type consistency:** `mapRow`/`toRow` 양방향 동일 키 매핑, RPC명 `increment_views`/`adjust_likes`가 T1·T3 일치, DOM id가 원본 유지로 app.js 참조와 일치.
```

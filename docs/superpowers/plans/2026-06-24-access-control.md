# Admin/Guest 접근 제어 + 모더레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pat Archive에 Supabase Auth 기반 admin/guest 로그인 게이트, RLS로 강제되는 쓰기 권한, 게스트 댓글(암호 삭제), Admin-only 콘텐츠 숨김을 추가한다.

**Architecture:** 실제 권한은 전부 Supabase RLS + security-definer RPC로 DB에서 강제(anon 키 공개 전제). 프론트는 `<html data-role>`로 쓰기 UI를 숨기는 억제층일 뿐. 로그인 오버레이는 세션/게스트 플래그로 노출 제어.

**Tech Stack:** Supabase Auth(email/password) + Postgres RLS + plpgsql RPC, Vanilla JS ESM, `crypto.subtle`(SHA-256), localStorage.

## Global Constraints

- 작업 루트 `D:\code\share_url\pat-archive\`. 커밋 author 미설정 시 `git -c user.name="pat" -c user.email="creative2@lezhin.com" commit ...`.
- 역할: `<html data-role="admin|guest">`. admin = Supabase 세션 보유, guest = 비로그인.
- 게스트 플래그 localStorage 키 `patGuest`("1"이면 게스트 진입 기억).
- 신규 컬럼: `links.admin_only boolean default false`, `comments.del_hash text`(SHA-256 hex 또는 null).
- 권한(RLS 강제): 글/태그/이미지 쓰기 = authenticated만. 글 읽기 = `admin_only=false OR authenticated`. 댓글 insert = 공개. 댓글 delete = 직접정책 없음(링크삭제 cascade + RPC로만).
- RPC(전부 security definer): `increment_views(row_id)`, `adjust_likes(row_id, delta)`(likes는 `sign(delta)`로 ±1 클램프), `delete_comment(comment_id, pw_hash)`(게스트, 해시일치+count감소), `delete_comment_admin(comment_id)`(admin전용, auth체크+count감소).
- camelCase↔snake: `adminOnly↔admin_only`를 map.mjs SNAKE에 추가. 댓글 insert는 `del_hash`를 직접 키로 사용.
- 댓글 삭제 ✕: admin은 `delete_comment_admin`, 게스트는 암호입력→`sha256Hex`→`delete_comment`.
- comment_count는 삭제 RPC 내부에서 감소(클라이언트가 직접 update 안 함 — 게스트는 links update 권한 없음).
- 테스트 실행 `node test/<f>.mjs`. SQL은 러너 없음 → Task 6에서 주인이 적용 후 REST로 검증.

## 파일 / 책임
| 파일 | 책임 |
|------|------|
| `schema.sql` | 컬럼·RLS·RPC (Task 1) |
| `lib/hash.mjs` | `sha256Hex` 순수 헬퍼 (Task 2) |
| `lib/map.mjs` | `adminOnly↔admin_only` 매핑 추가 (Task 4) |
| `index.html` | 로그인 오버레이·로그아웃·admin-only 체크·댓글 암호칸 (T3·T4·T5) |
| `style.css` | 오버레이·role 숨김·🔒 배지 (T3·T4·T5) |
| `app.js` | 인증/역할/admin-only/댓글암호 (T3·T4·T5) |
| `README.md` | 주인 셋업 (Task 6) |

## 병렬화 가이드 (subagent)
- **Task 1(schema.sql) ∥ Task 2(lib/hash.mjs)** — 서로 다른 파일, 동시 실행 가능.
- **Task 3 → (Task 4, Task 5)** — 3 완료 후. 4·5는 논리적으로 독립이나 `app.js/index.html/style.css`를 공유하므로 **순차**(또는 worktree 격리 후 병합 시 병렬). 같은 트리 SDD에선 4 → 5.
- **Task 6** 마지막(전부 의존, 주인 SQL 적용 + 검증).
- 권장 순서: {1,2 병렬} → 3 → 4 → 5 → 6.

---

## Task 1: DB 스키마 · RLS · RPC

**Files:** Modify `schema.sql`

**Interfaces:**
- Produces: `links.admin_only`, `comments.del_hash` 컬럼; RLS 정책(쓰기 authenticated, 읽기 admin_only 필터); RPC `increment_views/adjust_likes/delete_comment/delete_comment_admin`. app.js(T3–T5)가 이 RPC명·컬럼에 의존.

- [ ] **Step 1: schema.sql 끝에 접근제어 블록 추가**

`schema.sql` 맨 끝에 추가(기존 정의를 idempotent하게 교체):

```sql
-- ===== 접근 제어 (admin/guest) =====
alter table links    add column if not exists admin_only boolean default false;
alter table comments add column if not exists del_hash text;

-- links: 읽기는 공개분만(또는 로그인), 쓰기는 authenticated
drop policy if exists links_read   on links;
drop policy if exists links_insert on links;
drop policy if exists links_update on links;
drop policy if exists links_delete on links;
create policy links_read   on links for select
  using (admin_only = false or auth.role() = 'authenticated');
create policy links_insert on links for insert to authenticated
  with check (char_length(title) between 1 and 500);
create policy links_update on links for update to authenticated using (true);
create policy links_delete on links for delete to authenticated using (true);

-- comments: insert 공개, 읽기는 부모글 가시성 따름, 직접 delete 정책 없음(cascade/RPC만)
drop policy if exists comments_read   on comments;
drop policy if exists comments_insert on comments;
drop policy if exists comments_delete on comments;
create policy comments_read on comments for select using (
  exists (select 1 from links l
          where l.id = comments.link_id
          and (l.admin_only = false or auth.role() = 'authenticated'))
);
create policy comments_insert on comments for insert
  with check (char_length(text) between 1 and 1000);

-- tags: 쓰기 authenticated
drop policy if exists tags_insert on tags;
drop policy if exists tags_delete on tags;
create policy tags_insert on tags for insert to authenticated with check (char_length(name) between 1 and 40);
create policy tags_delete on tags for delete to authenticated using (true);

-- storage: 업로드 authenticated만(읽기 공개 유지)
drop policy if exists "prompts anon insert" on storage.objects;
create policy "prompts auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'prompts');

-- RPC: 조회/좋아요는 security definer로 게스트도 가능(좁은 범위)
create or replace function increment_views(row_id uuid) returns void
  language sql security definer as $$ update links set views = views + 1 where id = row_id $$;
create or replace function adjust_likes(row_id uuid, delta int) returns void
  language sql security definer as $$ update links set likes = likes + sign(delta) where id = row_id $$;

-- RPC: 게스트 댓글 삭제(해시 일치 시) + count 감소
create or replace function delete_comment(comment_id uuid, pw_hash text) returns void
  language plpgsql security definer as $$
  declare lid uuid;
  begin
    select link_id into lid from comments
      where id = comment_id and del_hash is not null and del_hash = pw_hash;
    if lid is null then return; end if;
    delete from comments where id = comment_id;
    update links set comment_count = greatest(comment_count - 1, 0) where id = lid;
  end; $$;

-- RPC: admin 댓글 전체 삭제(인증 확인) + count 감소
create or replace function delete_comment_admin(comment_id uuid) returns void
  language plpgsql security definer as $$
  declare lid uuid;
  begin
    if auth.role() <> 'authenticated' then raise exception 'not authorized'; end if;
    select link_id into lid from comments where id = comment_id;
    delete from comments where id = comment_id;
    if lid is not null then update links set comment_count = greatest(comment_count - 1, 0) where id = lid; end if;
  end; $$;
```

- [ ] **Step 2: 정적 점검**

이 환경엔 DB가 없으므로 실행 검증 불가. 괄호/`$$` 짝과 정책명 중복만 눈으로 확인. (실제 적용·검증은 Task 6에서 주인이 수행.)

- [ ] **Step 3: 커밋**

```bash
git add schema.sql
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat(db): admin/guest RLS·admin_only·댓글삭제 RPC"
```

---

## Task 2: sha256Hex 순수 헬퍼

**Files:** Create `lib/hash.mjs`, `test/hash.test.mjs`

**Interfaces:**
- Produces: `async sha256Hex(str) -> string`(64자 hex 소문자). T5(댓글 암호)가 import.

- [ ] **Step 1: 실패 테스트 작성**

```js
// test/hash.test.mjs
import assert from "node:assert";
import { sha256Hex } from "../lib/hash.mjs";
const h = await sha256Hex("test");
assert.equal(h, "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
assert.equal((await sha256Hex("")).length, 64);
console.log("hash: ok");
```

- [ ] **Step 2: 실패 확인**

Run: `node test/hash.test.mjs`
Expected: FAIL — `Cannot find module '../lib/hash.mjs'`

- [ ] **Step 3: 구현**

```js
// lib/hash.mjs
// 브라우저·Node(>=18) 공용: globalThis.crypto.subtle
export async function sha256Hex(str) {
  const data = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/hash.test.mjs`
Expected: `hash: ok`

- [ ] **Step 5: 커밋**

```bash
git add lib/hash.mjs test/hash.test.mjs
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat: sha256Hex 순수 헬퍼"
```

---

## Task 3: 로그인 오버레이 + 인증/역할 코어

**Files:** Modify `index.html`, `style.css`, `app.js`

**Interfaces:**
- Consumes: `supabase` from `./supabase.js`.
- Produces: 전역 `window.adminLogin()`, `window.enterAsGuest()`, `window.logout()`; 모듈 내 `isAdmin`(boolean) 상태와 `setRole(admin)`; DOM `#authOverlay`, `#loginEmail`, `#loginPw`, `#loginError`, `#logoutBtn`. T4·T5가 `isAdmin`/`data-role`에 의존.

- [ ] **Step 1: index.html — 로그인 오버레이 + 로그아웃 버튼 추가**

`<body>` 바로 다음(헤더 앞)에 오버레이 추가:

```html
<div class="auth-overlay" id="authOverlay">
  <div class="auth-card">
    <h2>PAT ARCHIVE</h2>
    <p class="auth-sub">관리자 로그인 또는 게스트로 둘러보기</p>
    <input type="email" id="loginEmail" placeholder="이메일">
    <input type="password" id="loginPw" placeholder="비밀번호" onkeydown="if(event.key==='Enter')adminLogin()">
    <div class="auth-error" id="loginError"></div>
    <button class="btn-save" onclick="adminLogin()">로그인</button>
    <button class="btn-cancel" onclick="enterAsGuest()">게스트로 둘러보기</button>
  </div>
</div>
```

헤더 `.header-btns`에 로그아웃 버튼 추가(테마 토글과 + 링크 추가 사이 또는 끝):

```html
    <button class="add-btn-secondary" id="logoutBtn" onclick="logout()">로그아웃</button>
```

- [ ] **Step 2: style.css — 오버레이 + 역할 숨김 규칙 추가**

`style.css` 끝에 추가:

```css
/* ===== 로그인 오버레이 ===== */
.auth-overlay {
  display: none;
  position: fixed; inset: 0; z-index: 500;
  align-items: center; justify-content: center;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(8px);
}
.auth-overlay.open { display: flex; }
.auth-card {
  background: var(--white);
  border: 4px solid var(--black);
  box-shadow: var(--shadow-modal);
  padding: 28px 24px;
  width: 360px; max-width: 92vw;
  display: flex; flex-direction: column; gap: 10px;
}
.auth-card h2 { font-size: 28px; font-weight: 800; }
.auth-sub { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.auth-card input {
  border: var(--bw) solid var(--black); border-radius: var(--radius);
  padding: 8px 10px; font-family: inherit; font-size: 14px; background: var(--white); color: var(--black);
}
.auth-card input:focus { outline: none; border-color: var(--pink); }
.auth-error { color: var(--orange); font-size: 12px; font-weight: 700; min-height: 1em; }
.auth-card .btn-save, .auth-card .btn-cancel { width: 100%; }

/* ===== 역할 기반 숨김 (게스트는 쓰기 UI 안 보임) ===== */
html:not([data-role="admin"]) #logoutBtn,
html:not([data-role="admin"]) .header-btns .add-btn,
html:not([data-role="admin"]) .author-add-btn,
html:not([data-role="admin"]) .card-actions,
html:not([data-role="admin"]) .upload-area { display: none !important; }
```
(`#logoutBtn`은 admin일 때만 보이고, `.add-btn`(+링크추가)·`.author-add-btn`(+이름/+태그)·`.card-actions`(수정/삭제)·`.upload-area`는 게스트에게 숨김. 테마/크기 토글·검색·정렬은 게스트도 사용 가능하므로 건드리지 않는다.)

- [ ] **Step 3: app.js — 인증/역할 코어 추가**

`app.js` 끝에 추가:

```js
// ========== 인증 / 역할 (admin/guest) ==========
let isAdmin = false;
function setRole(admin) {
  isAdmin = admin;
  document.documentElement.dataset.role = admin ? "admin" : "guest";
  render();   // 역할에 따라 admin-only 카드 노출/숨김 갱신(T4)
}
function showAuthOverlay() { document.getElementById("authOverlay").classList.add("open"); }
function hideAuthOverlay() { document.getElementById("authOverlay").classList.remove("open"); }

window.adminLogin = async function() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPw").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { document.getElementById("loginError").textContent = "로그인 실패: " + error.message; return; }
  localStorage.removeItem("patGuest");
  hideAuthOverlay();   // onAuthStateChange가 admin 역할 설정
};
window.enterAsGuest = function() {
  localStorage.setItem("patGuest", "1");
  setRole(false);
  hideAuthOverlay();
};
window.logout = async function() {
  await supabase.auth.signOut();
  localStorage.removeItem("patGuest");
  setRole(false);
  showAuthOverlay();
};

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) { setRole(true); hideAuthOverlay(); }
  else { setRole(false); }
});

(async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { setRole(true); hideAuthOverlay(); }
  else if (localStorage.getItem("patGuest") === "1") { setRole(false); hideAuthOverlay(); }
  else { setRole(false); showAuthOverlay(); }
})();
```

- [ ] **Step 4: 문법 검증**

Run: `node --input-type=module --check < app.js`
Expected: 에러 없음(exit 0)

- [ ] **Step 5: 회귀 테스트**

Run: `node test/data-layer.test.mjs && node test/authors.test.mjs && node test/cardsize.test.mjs && node test/theme.test.mjs`
Expected: 4개 모두 `ok`

- [ ] **Step 6: 커밋**

```bash
git add index.html style.css app.js
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat(auth): 로그인 오버레이 + admin/guest 역할 게이팅"
```

---

## Task 4: Admin-only 콘텐츠

**Files:** Modify `lib/map.mjs`, `index.html`, `app.js`, `style.css`

**Interfaces:**
- Consumes: `isAdmin`(T3).
- Produces: `admin_only` 저장/필터/배지. DOM `#adminOnlyInput`.

- [ ] **Step 1: lib/map.mjs — adminOnly 매핑 추가**

`lib/map.mjs`의 SNAKE 객체에 `adminOnly:"admin_only"` 추가:

```js
const SNAKE = {
  createdAt:"created_at", pinnedAt:"pinned_at", commentCount:"comment_count",
  promptIntro:"prompt_intro", promptEnv:"prompt_env", promptText:"prompt_text",
  promptTip:"prompt_tip", linkId:"link_id", adminOnly:"admin_only",
};
```

기존 test/data-layer.test.mjs에 한 줄 추가(매핑 검증):

```js
assert.equal(toRow({ adminOnly: true }).admin_only, true);
assert.equal(mapRow({ admin_only: true }).adminOnly, true);
```
(파일의 `console.log("data-layer: ok")` 직전에 삽입.)

Run: `node test/data-layer.test.mjs` → `data-layer: ok`

- [ ] **Step 2: index.html — 모달에 Admin-only 체크박스 추가**

링크 모달의 핀 토글(`<label class="pin-toggle">...Pat recommendation에 고정...`) 바로 앞 또는 뒤에 추가:

```html
    <label class="pin-toggle">
      <input type="checkbox" id="adminOnlyInput">
      <span>🔒 Admin only (게스트에게 숨김)</span>
    </label>
```

- [ ] **Step 3: app.js — 저장/복원/필터/배지 배선**

(a) `saveLink`에서 `data` 구성에 admin_only 추가 — `const data = { ... };` 다음 줄에:
```js
    data.adminOnly = document.getElementById("adminOnlyInput").checked;
```

(b) `openModal`에서 수정 시 체크박스 복원 — 편집 분기의 `document.getElementById("pinnedInput").checked = l.pinned === true;` 다음에:
```js
    document.getElementById("adminOnlyInput").checked = l.adminOnly === true;
```
그리고 신규(else) 분기의 `document.getElementById("pinnedInput").checked = false;` 다음에:
```js
    document.getElementById("adminOnlyInput").checked = false;
```

(c) `render()`의 grid 필터(`let filtered = sorted.filter(l => {`) 안, `if (isPromptOnly) return false;` 다음에 게스트 안전망 추가:
```js
    if (!isAdmin && l.adminOnly) return false;
```
그리고 `renderFeatured()`의 `.filter(l => {` 안 `if (l.pinned !== true) return false;` 다음에:
```js
      if (!isAdmin && l.adminOnly) return false;
```

(d) 카드 마크업에 🔒 배지 — `render()`의 카드 템플릿에서 NEW 배지(`<span class="new-badge">`) 부분을 찾아, 그 근처에 admin-only 배지를 조건부로 추가. 카드 HTML을 만드는 map 콜백 안에서 thumb 위에 삽입:
```js
      ${l.adminOnly ? '<span class="admin-badge">🔒</span>' : ''}
```
(NEW 배지와 같은 레이어에 위치하도록 카드 컨테이너 바로 안쪽에 배치.)

- [ ] **Step 4: style.css — 🔒 배지 스타일**

```css
.admin-badge {
  position: absolute; top: 8px; right: 8px; z-index: 3;
  background: var(--black); color: var(--white);
  border: 2px solid var(--black);
  font-size: 11px; padding: 2px 6px; font-weight: 700;
}
```

- [ ] **Step 5: 문법 + 회귀**

Run: `node --input-type=module --check < app.js && node test/data-layer.test.mjs`
Expected: 문법 OK, `data-layer: ok`

- [ ] **Step 6: 커밋**

```bash
git add lib/map.mjs index.html app.js style.css test/data-layer.test.mjs
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat: Admin-only 콘텐츠(체크박스·RLS연동 필터·🔒배지)"
```

---

## Task 5: 게스트 댓글 + 암호 삭제

**Files:** Modify `index.html`, `app.js`

**Interfaces:**
- Consumes: `sha256Hex` from `./lib/hash.mjs`(T2); `isAdmin`(T3); RPC `delete_comment`/`delete_comment_admin`(T1).
- Produces: 댓글 작성 시 del_hash 저장, 댓글별 ✕ 삭제(admin=전부, guest=암호).

- [ ] **Step 1: app.js — hash import 추가**

상단 import 블록에:
```js
import { sha256Hex } from "./lib/hash.mjs";
```

- [ ] **Step 2: index.html — 댓글 폼에 삭제암호 입력칸 추가**

댓글 폼(`.comment-form`)의 닉네임 input 다음에 추가:
```html
        <input type="text" id="commentPw" placeholder="삭제용 암호(선택)">
```

- [ ] **Step 3: schema.sql — 댓글 수 증가 RPC 추가**

게스트는 `links` update 권한이 없으므로(RLS authenticated 전용), 댓글 작성 시 count 증가를 security-definer RPC로 처리한다. `schema.sql` 끝(다른 RPC 옆)에 추가:
```sql
create or replace function bump_comment_count(row_id uuid) returns void
  language sql security definer as $$ update links set comment_count = comment_count + 1 where id = row_id $$;
```

- [ ] **Step 4: app.js — submitComment 교체(del_hash 저장 + count RPC)**

현재 `window.submitComment`를 통째로 다음으로 교체:
```js
window.submitComment = async function() {
  if (!currentDetailLink) return;
  const author = document.getElementById("commentAuthor").value.trim() || "익명";
  const text = document.getElementById("commentText").value.trim();
  if (!text) return;
  const pw = document.getElementById("commentPw").value;
  const row = { link_id: currentDetailLink.id, author, text, created_at: Date.now() };
  if (pw) row.del_hash = await sha256Hex(pw);
  const { error } = await supabase.from("comments").insert(row);
  if (error) { alert("댓글 등록 실패: " + error.message); return; }
  await supabase.rpc("bump_comment_count", { row_id: currentDetailLink.id });
  document.getElementById("commentText").value = "";
  document.getElementById("commentPw").value = "";
};
```

- [ ] **Step 5: app.js — renderComments에 ✕ 삭제 버튼 + 핸들러**

`renderComments`가 각 댓글을 그릴 때 삭제 버튼을 추가하고(모두에게 노출), 클릭 핸들러를 위임으로 처리. 댓글 아이템 템플릿에 다음을 포함:
```js
`<button type="button" class="comment-del" data-cid="${c.id}">✕</button>`
```
그리고 댓글 리스트 컨테이너(`#commentsList`)에 위임 리스너(최초 1회 bind):
```js
function bindCommentDelete() {
  const list = document.getElementById("commentsList");
  if (list.dataset.bound) return;
  list.addEventListener("click", async e => {
    const b = e.target.closest(".comment-del"); if (!b) return;
    const id = b.dataset.cid;
    if (isAdmin) {
      if (!confirm("이 댓글을 삭제할까요?")) return;
      const { error } = await supabase.rpc("delete_comment_admin", { comment_id: id });
      if (error) alert("삭제 실패: " + error.message);
    } else {
      const pw = prompt("댓글 삭제 암호:");
      if (!pw) return;
      const pw_hash = await sha256Hex(pw);
      await supabase.rpc("delete_comment", { comment_id: id, pw_hash });
      // 일치하지 않으면 아무 행도 안 지워짐(조용). 실시간 구독이 목록 갱신.
    }
  });
  list.dataset.bound = "1";
}
```
`renderComments` 호출 직후 또는 내부에서 `bindCommentDelete()`를 부른다(컨테이너는 항상 존재하므로 1회 bind). 삭제 후 갱신은 댓글 실시간 구독(`detailCommentChannel`)이 처리한다.

- [ ] **Step 6: 문법 + 회귀**

Run: `node --input-type=module --check < app.js && node test/hash.test.mjs && node test/data-layer.test.mjs`
Expected: 문법 OK, `hash: ok`, `data-layer: ok`

- [ ] **Step 7: 커밋**

```bash
git add index.html app.js schema.sql
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat: 게스트 댓글 + 암호삭제(RPC) + count RPC"
```

---

## Task 6: 주인 셋업 + 통합 검증 (배포본)

**Files:** Modify `README.md`. 필요 시 직전 태스크 보정 후 재커밋.

- [ ] **Step 1: README — 주인 셋업 절차 추가**

`README.md`에 "접근 제어 셋업" 섹션 추가:
1. Supabase → Authentication → Sign In / Providers에서 **이메일 회원가입(Sign-ups) 비활성화**.
2. Authentication → Users → **Add user**로 admin 계정(이메일+비번) 생성.
3. SQL Editor에서 `schema.sql`의 접근제어 블록(Task 1) + `bump_comment_count`(Task 5) 실행.

- [ ] **Step 2: 배포 + 주인 SQL 적용**

`git push origin <branch>` → Vercel 재배포. 주인이 Step 1의 1~3 수행.

- [ ] **Step 3: REST로 RLS 강제 확인(익명 키)**

익명 키로 직접 호출해 쓰기가 막히는지 확인(컨트롤러가 실행 가능):
1. `POST /rest/v1/links`(anon) → **401/403**(authenticated 아님) 이어야 함.
2. admin-only 글 1개를 admin으로 만든 뒤, anon `GET /rest/v1/links?select=id,admin_only` → admin_only=true 행이 **안 옴**.
3. anon `POST /rest/v1/comments`(text 포함) → **성공**(게스트 댓글 허용).
4. anon `POST /rest/v1/rpc/increment_views` → **성공**(security definer).

- [ ] **Step 4: 라이브 UI 체크리스트**

1. 시크릿 창 → 로그인 오버레이(블러) 노출. "게스트로 둘러보기" → 글 보기 O, `+ 링크 추가`·수정/삭제·+태그/+이름·이미지 업로드 **안 보임**, 로그아웃 버튼 없음.
2. admin 로그인 → 쓰기 UI 전부 노출, 로그아웃 버튼 보임.
3. admin이 글에 🔒 Admin only 체크 후 저장 → 게스트 화면엔 그 카드 **안 보이고**, admin 화면엔 🔒 배지로 보임.
4. 게스트 댓글 작성(암호 설정) → 본인 암호로 ✕ 삭제 O, 틀린 암호 삭제 X. admin은 암호 무시하고 ✕ 삭제 O. 삭제/추가 시 💬 카운트 정확.
5. 게스트 좋아요·조회수 증가 동작.

- [ ] **Step 5: 발견 이슈 수정 후 재커밋(있으면)**

```bash
git add -A
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "fix: 접근제어 검증 후 보정"
```

---

## Self-Review

- **Spec coverage:** 인증 플로우(T3) · UI 역할 게이팅(T3) · RLS/스키마(T1) · RPC definer(T1) · 댓글 게스트+암호삭제(T5) · admin 전체삭제(T1·T5) · 조회수=클릭(T1 definer + 기존 동작) · admin-only(T1·T4) · 주인 셋업(T6) · sha256(T2) → spec 전 항목 커버. comment_count 방식은 **RPC(bump_comment_count 증가 / delete RPC 내부 감소)** 단일 경로로 확정.
- **Placeholder scan:** TBD/placeholder 없음. 댓글 수 증가는 `bump_comment_count` RPC(T5 Step 3·4), 감소는 삭제 RPC 내부로 단일화.
- **Type consistency:** RPC명 `increment_views/adjust_likes/delete_comment/delete_comment_admin/bump_comment_count`가 T1 정의와 T4·T5 호출 일치. `admin_only`↔`adminOnly`(map.mjs), `del_hash`(직접), `data-role`/`isAdmin`이 T3 정의와 T4·T5 사용 일치. DOM id `adminOnlyInput/commentPw/authOverlay/loginEmail/loginPw/loginError/logoutBtn` 마크업(T3·T4·T5)과 app.js 참조 일치.

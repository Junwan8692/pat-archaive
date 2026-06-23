# 카드 크기 조절 + Day/Dark 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pat Archive에 카드 크기 S/M/L 조절과 Day/Dark 테마 전환을 추가한다(클라이언트 UI, localStorage 영속).

**Architecture:** `<html>` 요소의 `data-size`·`data-theme` 속성만 토글하면 CSS 변수가 캐스케이드되어 전체가 바뀐다. JS는 속성 set + localStorage 저장 + 버튼 상태 갱신만 담당. 순수 헬퍼는 잘못된 저장값을 정규화한다.

**Tech Stack:** Vanilla JS (ES module), CSS custom properties, localStorage. 빌드 없음. node assert 테스트.

## Global Constraints

- 대상 파일은 모두 `D:\code\share_url\pat-archive\` 하위. 현재 작업 브랜치에서 진행.
- 카드 크기 단계 3종, `data-size` 값 = `s|m|l`, 기본 `m`. localStorage 키 `cardSize`.
- 테마 2종, `data-theme` 값 = `day|dark`, 기본 `day`. localStorage 키 `theme`. **첫 방문 항상 day**(OS prefers-color-scheme 따르지 않음).
- 크기 프리셋 변수: `--card-min / --card-h / --thumb-h / --title-fs`. 값(튜닝 가능): M=240/340/140/16px, S=185/300/115/14px, L=310/410/190/18px.
- 테마 다크 오버라이드 변수 4개: `--bg:#161616; --white:#242424; --black:#F0F0F0; --muted:#9AA0A6;`. 포인트색(pink/yellow/mint/orange/lime) 불변.
- 기존 CSS·마크업의 클래스/ID 명은 보존. 포인트색·테두리·그림자는 이미 `var(--black)/var(--white)` 사용.
- 테스트 실행: `node test/<파일>.mjs` (프레임워크 없음).
- 커밋 author 미설정 시: `git -c user.name="pat" -c user.email="creative2@lezhin.com" commit ...`

---

## Task 1: 순수 헬퍼 (normalizeSize, normalizeTheme)

**Files:**
- Create: `lib/cardsize.mjs`, `lib/theme.mjs`
- Test: `test/cardsize.test.mjs`, `test/theme.test.mjs`

**Interfaces:**
- Produces: `normalizeSize(v) -> 's'|'m'|'l'` (유효하지 않으면 `'m'`); `normalizeTheme(v) -> 'day'|'dark'` (유효하지 않으면 `'day'`). Task 4(app.js)가 import.

- [ ] **Step 1: 실패 테스트 작성**

```js
// test/cardsize.test.mjs
import assert from "node:assert";
import { normalizeSize } from "../lib/cardsize.mjs";
assert.equal(normalizeSize("s"), "s");
assert.equal(normalizeSize("m"), "m");
assert.equal(normalizeSize("l"), "l");
assert.equal(normalizeSize("xl"), "m");   // 잘못된 값 → 기본 m
assert.equal(normalizeSize(null), "m");
assert.equal(normalizeSize(undefined), "m");
console.log("cardsize: ok");
```

```js
// test/theme.test.mjs
import assert from "node:assert";
import { normalizeTheme } from "../lib/theme.mjs";
assert.equal(normalizeTheme("day"), "day");
assert.equal(normalizeTheme("dark"), "dark");
assert.equal(normalizeTheme("light"), "day");   // 잘못된 값 → 기본 day
assert.equal(normalizeTheme(null), "day");
console.log("theme: ok");
```

- [ ] **Step 2: 실패 확인**

Run: `node test/cardsize.test.mjs`
Expected: FAIL — `Cannot find module '../lib/cardsize.mjs'`

- [ ] **Step 3: 구현**

```js
// lib/cardsize.mjs
export function normalizeSize(v) {
  return v === "s" || v === "l" ? v : "m";
}
```

```js
// lib/theme.mjs
export function normalizeTheme(v) {
  return v === "dark" ? "dark" : "day";
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/cardsize.test.mjs && node test/theme.test.mjs`
Expected: `cardsize: ok` 그리고 `theme: ok`

- [ ] **Step 5: 커밋**

```bash
git add lib/cardsize.mjs lib/theme.mjs test/cardsize.test.mjs test/theme.test.mjs
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat: normalizeSize/normalizeTheme 순수 헬퍼"
```

---

## Task 2: CSS — 크기 프리셋 변수 배선 + 다크 테마 + 토글 스타일 + 색 감사

**Files:**
- Modify: `style.css`

**Interfaces:**
- Consumes: 없음 (CSS만).
- Produces: `html[data-size=s|m|l]` 프리셋, `html[data-theme=dark]` 오버라이드, `.size-toggle/.size-btn`·`.theme-toggle` 스타일. Task 3 마크업과 Task 4 JS가 이 클래스/속성에 의존.

- [ ] **Step 1: `:root`에 크기 변수 기본값(M) 추가**

`style.css`의 `:root { ... }` 블록 안(기존 토큰 옆)에 추가:

```css
  /* 카드 크기 (M 기본) */
  --card-min: 240px;
  --card-h:   340px;
  --thumb-h:  140px;
  --title-fs: 16px;
```

- [ ] **Step 2: 크기 프리셋 + 다크 테마 블록 추가**

`:root { ... }` 닫는 중괄호 바로 다음에 추가:

```css
/* 카드 크기 프리셋 */
html[data-size="s"] { --card-min:185px; --card-h:300px; --thumb-h:115px; --title-fs:14px; }
html[data-size="m"] { --card-min:240px; --card-h:340px; --thumb-h:140px; --title-fs:16px; }
html[data-size="l"] { --card-min:310px; --card-h:410px; --thumb-h:190px; --title-fs:18px; }

/* 다크 테마 — 시맨틱 변수 4개만 오버라이드 (포인트색 불변) */
html[data-theme="dark"] {
  --bg:    #161616;
  --white: #242424;
  --black: #F0F0F0;
  --muted: #9AA0A6;
}
```

- [ ] **Step 3: 그리드·카드·썸네일·제목을 변수로 배선**

`style.css`에서 아래 4곳의 고정값을 변수로 교체(선택자는 그대로, 값만 변경):

- `.grid`의 `grid-template-columns`: `repeat(auto-fill, minmax(240px, 1fr))` → `repeat(auto-fill, minmax(var(--card-min), 1fr))`
- `.card`의 `height: 340px` → `height: var(--card-h)`
- `.card-thumb`의 `height: 140px` → `height: var(--thumb-h)` (그리고 `.card-thumb-placeholder`의 height도 동일하게 `var(--thumb-h)`)
- `.card-title`의 `font-size`(현재 16px) → `font-size: var(--title-fs)`

부드러운 전환을 위해 `.card`에 `transition: box-shadow 0.1s, transform 0.1s, height 0.15s;`가 없으면 height 트랜지션을 더해도 됨(선택, 튜닝 노브).

- [ ] **Step 4: 토글 컴포넌트 스타일 추가**

`style.css` 끝에 추가:

```css
/* ===== 크기 토글 (S/M/L) ===== */
.size-toggle { display: inline-flex; }
.size-btn {
  width: 30px; height: 30px;
  border: 2px solid var(--black);
  border-left-width: 0;
  background: var(--white);
  color: var(--black);
  font-family: inherit; font-weight: 700; font-size: 12px;
  cursor: pointer;
}
.size-btn:first-child { border-left-width: 2px; }
.size-btn:hover { background: var(--pink); }
.size-btn.active { background: var(--pink); }

/* ===== 테마 토글 ===== */
.theme-toggle {
  width: 38px; height: 38px;
  border: 3px solid var(--black);
  background: var(--white);
  box-shadow: 4px 4px 0 var(--black);
  font-size: 16px; line-height: 1; cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
.theme-toggle:hover { transform: translate(-2px,-2px); box-shadow: 6px 6px 0 var(--black); }
.theme-toggle:active { transform: translate(4px,4px); box-shadow: 0 0 0 var(--black); }
```

- [ ] **Step 5: 하드코딩 색 감사**

Run: `grep -nE "#000|#fff|#FFF|#333|#222|#161616|#242424" style.css`
다크에서 바뀌어야 하는데 하드코딩된 색(텍스트/면/테두리/그림자 역할)을 `var(--black)/--white/--bg/--muted`로 교체. 단, **포인트색 hex(#FF90E8 등)와 프리셋/테마 정의 블록 자체의 값은 그대로 둔다.** 교체한 항목을 커밋 메시지에 적는다. (없으면 "감사 결과 교체 없음"으로 기록)

- [ ] **Step 6: 커밋**

```bash
git add style.css
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat(css): 카드 크기 프리셋·다크 테마·토글 스타일 + 색 감사"
```

---

## Task 3: index.html — 토글 마크업 + 배지 토큰 교정

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2의 `.size-toggle/.size-btn/.theme-toggle` 스타일.
- Produces: `#sizeToggle`(내부 `.size-btn[data-size]` 3개), `#themeToggle` 버튼(onclick=`toggleTheme()`). Task 4 JS가 이 ID들에 의존.

- [ ] **Step 1: 헤더에 테마 토글 추가**

`index.html` 헤더의 `.header-btns` 블록(현재 `+ 링크 추가` 버튼만 있음)을 다음으로 교체:

```html
  <div class="header-btns">
    <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()" title="테마 전환">☀</button>
    <button class="add-btn" onclick="openModal()">+ 링크 추가</button>
  </div>
```

- [ ] **Step 2: 컨트롤 바에 크기 토글 추가**

`index.html`의 `.controls` 안, 정렬 셀렉트(`<select class="sort-select" id="sortSelect">...`) 바로 앞에 추가:

```html
  <div class="size-toggle" id="sizeToggle">
    <button type="button" class="size-btn" data-size="s">S</button>
    <button type="button" class="size-btn active" data-size="m">M</button>
    <button type="button" class="size-btn" data-size="l">L</button>
  </div>
```

- [ ] **Step 3: 작성자 필터 배지의 옛 토큰 교정**

`index.html`의 `#authorFilterBadge` 인라인 스타일에서 존재하지 않는 옛 토큰을 네오브루탈 변수로 교체:
- `background:#eef6fc` → `background:var(--white)`
- `border:1px solid var(--border-dark)` → `border:2px solid var(--black)`
- `color:var(--sky)` → `color:var(--black)`
- 내부 ✕ 버튼의 `color:var(--muted)`는 유효하므로 유지.

- [ ] **Step 4: 로드 확인 (수동, 배포/로컬서버)**

브라우저(HTTP)로 페이지 열어 콘솔 에러 없이 헤더에 ☀ 버튼, 컨트롤 바에 S/M/L이 보이는지 확인(아직 클릭 동작은 Task 4에서). 단계 기록만.

- [ ] **Step 5: 커밋**

```bash
git add index.html
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat(frontend): 크기/테마 토글 마크업 + 배지 토큰 교정"
```

---

## Task 4: app.js — applySize/applyTheme + 핸들러 + 초기 복원

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `normalizeSize` from `./lib/cardsize.mjs`, `normalizeTheme` from `./lib/theme.mjs`; DOM `#sizeToggle`, `.size-btn[data-size]`, `#themeToggle`.
- Produces: `window.toggleTheme()` (헤더 버튼 onclick이 호출).

- [ ] **Step 1: import 추가**

`app.js` 최상단 import 블록(기존 `import { addAuthorName, ... }` 옆)에 추가:

```js
import { normalizeSize } from "./lib/cardsize.mjs";
import { normalizeTheme } from "./lib/theme.mjs";
```

- [ ] **Step 2: 크기/테마 로직 + 초기화 추가**

`app.js` 맨 끝(작성자 퀵버튼 섹션 다음)에 추가:

```js
// ========== 카드 크기 / 테마 ==========
function applySize(size) {
  const s = normalizeSize(size);
  document.documentElement.dataset.size = s;
  localStorage.setItem("cardSize", s);
  document.querySelectorAll("#sizeToggle .size-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.size === s));
}
function applyTheme(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.dataset.theme = t;
  localStorage.setItem("theme", t);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = t === "dark" ? "🌙" : "☀";
}
window.toggleTheme = function() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "day" : "dark");
};
const sizeBox = document.getElementById("sizeToggle");
if (sizeBox) sizeBox.addEventListener("click", e => {
  const b = e.target.closest(".size-btn");
  if (b) applySize(b.dataset.size);
});
applySize(localStorage.getItem("cardSize"));   // null이면 normalizeSize가 'm'
applyTheme(localStorage.getItem("theme"));      // null이면 normalizeTheme가 'day'
```

- [ ] **Step 3: 문법 검증**

Run: `node --input-type=module --check < app.js`
Expected: 에러 없음(종료코드 0)

- [ ] **Step 4: 회귀 테스트**

Run: `node test/data-layer.test.mjs && node test/authors.test.mjs && node test/cardsize.test.mjs && node test/theme.test.mjs`
Expected: 4개 모두 `ok`

- [ ] **Step 5: 커밋**

```bash
git add app.js
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "feat(frontend): 카드 크기/테마 적용·영속·초기 복원"
```

---

## Task 5: 통합 수동 검증 (배포본)

**Files:** 없음(검증만). 필요 시 직전 태스크들에 수정 후 재커밋.

- [ ] **Step 1: 배포 + 새로고침**

`git push origin <브랜치>` 후 Vercel 재배포. 배포 URL을 하드 리프레시(Ctrl+Shift+R).

- [ ] **Step 2: 체크리스트 확인**

1. 컨트롤 바 `[S][M][L]` 클릭 → 카드 너비·높이·썸네일·제목이 단계별로 변함, active 버튼 핑크.
2. 헤더 `☀/🌙` 클릭 → 전체 다크/데이 전환(배경·카드면·글자·테두리·하드그림자 반전, 포인트색 유지).
3. 새로고침/새 탭 → 크기·테마 유지(localStorage).
4. 다크에서 모달·상세·댓글·태그칩·입력창 가독성 OK(하드코딩 색 잔여 없음).
5. 첫 방문(시크릿 창) → Day + M.
6. 콘솔 에러 없음.

- [ ] **Step 3: 발견 이슈 수정 후 재커밋(있으면)**

```bash
git add -A
git -c user.name="pat" -c user.email="creative2@lezhin.com" commit -m "fix: 카드크기/테마 검증 후 보정"
```

---

## Self-Review

- **Spec coverage:** 카드크기 컨트롤(T3)·메커니즘(T2)·영속(T4)·헬퍼(T1) / 테마 컨트롤(T3)·오버라이드(T2)·영속+첫방문 day(T4)·색 감사(T2)·배지 교정(T3)·헬퍼(T1) / 초기화(T4) / 수동검증(T5) → spec 전 항목 커버.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "튜닝 노브"는 의도된 보정 여지(값은 기본 제시됨), 미완성 아님.
- **Type consistency:** `normalizeSize`→`s|m|l`, `normalizeTheme`→`day|dark`가 T1 정의와 T4 사용처 일치. `data-size/data-theme` 속성명, `#sizeToggle/#themeToggle/.size-btn` ID·클래스가 T2·T3·T4에서 동일.

# Pat Archive — 카드 크기 조절 + Day/Dark 모드 (Spec)

작성일: 2026-06-23
대상: 기존 Pat Archive (네오브루탈 링크 아카이브, Supabase 백엔드)
목표: **카드 크기 S/M/L 조절** + **Day/Dark 테마 전환** 두 가지 클라이언트 UI 기능 추가.

---

## 1. 개요 / 비목표

순수 **클라이언트 사이드 UI** 기능. DB·실시간·배포 구조 변경 없음.
- 카드 크기: 그리드 카드의 너비·높이·썸네일·제목을 S/M/L 3단계로 조절.
- 테마: Day(현재 라이트) ↔ Dark 전환.
- 둘 다 **localStorage**에 저장(내 브라우저 한정), 새로고침·재방문 시 복원.

비목표(YAGNI): 사용자별(공유) 설정 동기화, 무단계 슬라이더, 자동 다크 스케줄, 카드별 개별 크기.

---

## 2. 카드 크기 (S / M / L)

### 2.1 컨트롤 UI
- 위치: 컨트롤 바(`.controls`) 우측, 정렬 셀렉트 옆.
- 형태: 세그먼트 토글 — 버튼 3개 `[S][M][L]`. 네오브루탈(2~3px 검정 테두리, 붙은 형태). active = `--pink` 채움.
- 기본 선택: **M**(현재 크기).

### 2.2 메커니즘 (CSS 변수 프리셋)
JS 계산 없음. `<html data-size="s|m|l">` 속성만 토글 → CSS 변수 캐스케이드.

```css
:root, html[data-size="m"] { --card-min:240px; --card-h:340px; --thumb-h:140px; --title-fs:16px; }
html[data-size="s"]        { --card-min:185px; --card-h:300px; --thumb-h:115px; --title-fs:14px; }
html[data-size="l"]        { --card-min:310px; --card-h:410px; --thumb-h:190px; --title-fs:18px; }
```
배선:
- `.grid { grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr)); }`
- `.card { height: var(--card-h); }`
- `.card-thumb, .card-thumb-placeholder { height: var(--thumb-h); }`
- `.card-title { font-size: var(--title-fs); }`

> px 값은 **조정 가능한 튜닝 노브**. S에서 본문 텍스트가 잘리지 않게 보정(필요 시 desc line-clamp/폰트 미세조정). 기본값은 위 표.

### 2.3 영속
- localStorage `cardSize` (기본 `m`). 로드 시 복원.
- 순수 헬퍼 `normalizeSize(v)` → `s|m|l` 외 값이면 `m`.

---

## 3. Day / Dark 테마

### 3.1 컨트롤 UI
- 위치: **헤더 우측**, `+ 링크 추가` 버튼 옆.
- 형태: 단일 토글 버튼, 라벨 `☀`(현재 day, 누르면 dark로) / `🌙`(현재 dark). 네오브루탈 버튼.

### 3.2 메커니즘 (시맨틱 변수 오버라이드)
기존 CSS가 전부 `var(--black) / var(--white) / var(--bg) / var(--muted)`를 쓰므로, `<html data-theme="dark">`에서 이 값만 오버라이드 → 전체 반전. 대규모 스윕 불필요.

```css
html[data-theme="dark"] {
  --bg:    #161616;   /* 페이지 배경 */
  --white: #242424;   /* surface = 카드·모달·입력 면 */
  --black: #F0F0F0;   /* ink = 글자·테두리·하드그림자 */
  --muted: #9AA0A6;
}
```
- 의미 전환: 다크에서 `--black`은 "잉크(밝은색)", `--white`는 "면(어두운색)". 변수명은 유지(스윕 회피), 의미만 시맨틱하게 본다.
- 포인트색(`--pink/--yellow/--mint/--orange/--lime`) **불변** — 다크에서도 대비 좋음.
- 하드 그림자/테두리가 `var(--black)`이라 다크에선 **밝은 오프셋 그림자**로 뒤집혀 네오브루탈 톤 유지.

### 3.3 영속 + 초기값
- localStorage `theme` (기본 `day`).
- **첫 방문은 항상 Day** (OS `prefers-color-scheme` 따르지 않음).
- 로드 시 복원. 순수 헬퍼 `normalizeTheme(v)` → `day|dark` 외 값이면 `day`.

### 3.4 색 감사 (테마 정상 작동 위해 필수)
- `style.css`에서 **하드코딩 색(#000, #fff, #333 등) 잔여분**을 찾아 변수로 라우팅. 안 그러면 다크에서 안 바뀌는 요소 발생.
- `index.html`의 작성자 필터 배지(`#authorFilterBadge`) 인라인 스타일이 **존재하지 않는 옛 토큰**(`--sky`, `--border-dark`)을 참조 → 현재도 무효. 네오브루탈/테마 변수로 교정.

---

## 4. 적용 순서 (초기화)
모듈 로드 시 즉시:
1. `applySize(normalizeSize(localStorage.cardSize))` → `html[data-size]` + active 버튼.
2. `applyTheme(normalizeTheme(localStorage.theme))` → `html[data-theme]` + 토글 라벨.

플래시 방지: 가능하면 `<head>`의 인라인 스크립트로 `data-theme/data-size`를 **렌더 전** 설정(소규모라 우선순위 낮음; 미적용 시 깜빡임 한 번). 기본은 app.js 초기화로 처리, 깜빡임 거슬리면 head 인라인으로 승격(튜닝 노브).

---

## 5. 파일 변경
| 파일 | 변경 |
|------|------|
| `index.html` | 컨트롤 바에 S/M/L 토글, 헤더에 테마 토글, 배지 인라인 스타일 토큰 교정 |
| `style.css` | `[data-size]` 3프리셋 + 카드/그리드/썸네일/제목 변수 배선, `[data-theme="dark"]` 오버라이드, 토글 2종 스타일, 하드코딩 색 감사 |
| `app.js` | `applySize/applyTheme` + 토글 핸들러(위임) + 로드 복원 |
| `lib/cardsize.mjs`, `lib/theme.mjs` | 순수 헬퍼 `normalizeSize`, `normalizeTheme` |
| `test/cardsize.test.mjs`, `test/theme.test.mjs` | 헬퍼 단위 테스트(node assert) |

---

## 6. 테스트
- 순수 헬퍼: `normalizeSize('x')==='m'`, `normalizeSize('l')==='l'`; `normalizeTheme('x')==='day'`, `normalizeTheme('dark')==='dark'`.
- UI/영속: 배포본에서 수동 확인(버튼 클릭 → 크기/테마 변경, 새로고침 후 유지).

## 7. 미해결/튜닝 포인트
- S/L 프리셋 px는 실제 화면 보며 보정.
- 테마 깜빡임(FOUC) 거슬리면 head 인라인 초기화로 승격.

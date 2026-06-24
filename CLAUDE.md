# CLAUDE.md — Pat Archive

로그인 없이 함께 쓰는 실시간 링크/프롬프트 아카이브. Gumroad풍 네오브루탈리즘 UI.
원본 `hyc_gongyoulink`(싸이월드 Y2K)를 리스킨 + 백엔드를 Supabase로 이전한 버전.

## 스택

- **프런트**: 바닐라 ES module (프레임워크/번들러 없음). `index.html`이 `style.css` + `app.js`를 직접 로드.
- **백엔드**: Supabase (Postgres + RLS + RPC + Realtime + Storage). 서버 코드 없음 — 브라우저가 `anon` 키로 직접 호출.
- **호스팅**: Vercel 정적 서빙. **빌드 단계 없음.**
- **링크 메타 추출**: microlink.io (무료 티어). HF는 antibot으로 차단되어 자체 썸네일 URL로 우회(`fetchMeta`).

## 구조

| 파일 | 역할 |
|------|------|
| `index.html` | 마크업만 (158줄). 외부 css/js 로드 |
| `style.css` | 네오브루탈 디자인 시스템 + 카드크기/다크테마 프리셋 |
| `app.js` | 앱 로직 전체. `// ===` 주석으로 섹션 구분 (STATE/INIT/HELPERS/RENDER/DETAIL/MODAL/CAROUSEL/업로드/작성자/크기·테마) |
| `supabase.js` | Supabase 클라이언트 + URL/anon 키 + 버킷명 |
| `lib/*.mjs` | 의존성 없는 순수 헬퍼 (`map` 행매핑, `authors`, `hash` sha256, `cardsize`, `theme`) — 각각 `test/`에 테스트 |
| `schema.sql` | DB 테이블·RLS·RPC·Realtime·Storage·접근제어 전부 (멱등 작성) |
| `supabase/functions/og/` | Edge Function. 썸네일 og:image 추출 프록시 (reddit 등 antibot 우회) |
| `vercel.json` | `cleanUrls`/`trailingSlash` 정적 설정 |
| `Design.md` | 디자인 시스템 토큰 |
| `docs/superpowers/` | 설계 spec·구현 계획서 |

## 아키텍처 핵심

- **권한은 Supabase RLS가 강제.** `authenticated`(로그인) = **admin**(전권), `anon`(비로그인) = **guest**(보기 + 댓글·좋아요만). anon 키가 공개돼도 RLS가 실제로 막음 → 클라이언트 가드는 UX용일 뿐, 신뢰 경계는 DB.
  - ⚠️ Supabase에서 **이메일 회원가입(Sign-ups) 비활성 필수** — 안 그러면 누구나 admin 생성 가능.
- **순수 로직은 `lib/`에 분리** → node 테스트로 검증. UI/DB 의존 로직만 `app.js`에.
- **댓글 삭제**: 게스트는 작성 시 정한 암호 → `delete_comment` RPC가 서버에서 해시 검증. admin은 `delete_comment_admin`으로 전부 삭제. `del_hash` 컬럼은 클라이언트에 비노출(RLS 컬럼 grant).
- **카운트(조회/좋아요)**: 클라가 값 못 쓰게 `increment_views`/`adjust_likes` RPC로만.
- **로컬 영속**: 작성자 퀵버튼·좋아요 여부·카드크기·테마는 `localStorage`.

## 작업 시 주의 (gotchas)

- **반드시 HTTP 서버로 실행.** ES module이라 `file://`로 열면 Chrome이 CORS(origin `null`)로 `app.js` 차단 → 버튼 먹통. 디버깅 전 이거부터 확인.
- **`anon` 키는 코드에 박아도 안전**(RLS 보호). `service_role` 키는 **절대 커밋 금지**.
- 순수 헬퍼 고치면 `lib/`에서 하고 대응 `test/` 갱신. `app.js`에 로직 복붙하지 말 것.
- DB 스키마/정책 변경은 `schema.sql`에 멱등하게 반영 후 Supabase SQL Editor에서 실행. 코드만 고치고 끝내지 말 것.
- `fetchMeta` 순서: ①HF 직접 CDN → ②자체 og 프록시(Edge Function, Discordbot UA) → ③microlink fallback. 새 사이트가 안 뜨면 보통 ②가 og 태그 못 받는 경우 → 그 사이트가 어떤 crawler UA에 og를 주는지 확인 후 함수 UA 조정, 정 안 되면 HF처럼 직접 패턴 우회.

## 명령어

```bash
# 로컬 실행 (둘 중 하나)
python -m http.server 8000      # → http://127.0.0.1:8000/index.html
npx serve .

# 테스트 (순수 헬퍼, 의존성 없음)
node test/data-layer.test.mjs
node test/authors.test.mjs
node test/hash.test.mjs
node test/cardsize.test.mjs
node test/theme.test.mjs
```

## 배포 (Vercel)

GitHub repo: **`Junwan8692/pat-archaive`** (브랜치 `master`). Vercel이 이 repo에 연결돼 **push 시 자동 배포**.

```bash
git add -A
git commit -m "..."
git push origin master        # → Vercel 자동 배포, 1~2분 후 반영
```

- 빌드/환경변수 설정 불필요 (`supabase.js`에 키 내장, 정적 서빙).
- **DB 변경을 동반하면** push만으론 부족 — Supabase SQL Editor에서 `schema.sql`의 해당 블록을 별도 실행해야 함.
- **Edge Function(`supabase/functions/og`) 변경을 동반하면** push만으론 부족 — CLI로 별도 배포:
  ```bash
  supabase functions deploy og --project-ref whrnisglpzcvebdttmxc
  ```
  최초 1회: `npm i -g supabase` → `supabase login`. (썸네일 추출 프록시. reddit 등 antibot 사이트는 브라우저가 직접 못 긁어서 이 함수가 Discordbot UA로 대신 긁음.)
- 최초 1회 연결: Vercel → Add New → Project → repo Import → Framework **Other**, Build Command 비움, Output Directory `.`.

### 최초 셋업 (새 Supabase 프로젝트 기준)

1. Supabase New project → SQL Editor에서 `schema.sql` 전체 실행.
2. Storage → New bucket `prompts` (Public) 생성.
3. Settings → API의 `Project URL` + `anon public` 키를 `supabase.js`에 기입.
4. Authentication: Sign-ups **비활성** → Users에서 admin 계정 수동 추가.

자세한 절차는 `README.md` 참고.

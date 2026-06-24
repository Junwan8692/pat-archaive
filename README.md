# Pat Archive

Gumroad풍 **네오브루탈리즘** 링크/프롬프트 아카이브. 로그인 없이 함께 쓰는 실시간 보관함.
원본 `hyc_gongyoulink`(싸이월드 Y2K)를 리스킨하고 백엔드를 **Supabase**로 이전한 버전.

- 디자인 시스템: [`Design.md`](./Design.md)
- 설계/계획: [`docs/superpowers/`](./docs/superpowers/)

## 구성

| 파일 | 역할 |
|------|------|
| `index.html` | 마크업 (외부 css/js 로드) |
| `style.css` | 네오브루탈 디자인 시스템 |
| `app.js` | 앱 로직 (Supabase) |
| `supabase.js` | Supabase 클라이언트 + 키 |
| `lib/` | 순수 헬퍼 (`map.mjs`, `authors.mjs`) |
| `schema.sql` | DB 테이블·RLS·RPC·Storage 정책 |
| `vercel.json` | 정적 배포 설정 |

빌드 단계 없음. 정적 파일을 그대로 서빙한다.

## 셋업 (Supabase)

1. https://supabase.com → **New project** 생성.
2. **SQL Editor**에서 [`schema.sql`](./schema.sql) 전체 실행 (테이블·RLS·RPC·Realtime·Storage 정책).
3. **Storage** → **New bucket** → 이름 `prompts`, **Public** 체크 → 생성.
4. **Project Settings → API**에서 `Project URL` 과 `anon` `public` 키 복사 → [`supabase.js`](./supabase.js) 상단 두 상수에 기입.
   - `anon` 키만 사용. RLS로 보호되므로 코드에 박혀도 안전. `service_role` 키는 절대 커밋 금지.

## 접근 제어 셋업 (admin/guest) — 주인 1회 작업

쓰기 권한은 Supabase RLS로 강제된다. **admin(로그인)만** 글 생성/수정/삭제·태그·이미지·admin-only가 가능하고, **guest(비로그인)**는 보기 + 댓글·좋아요만 된다. anon 키가 공개돼도 RLS가 실제로 막는다.

1. **Authentication → Sign In / Providers**에서 이메일 **회원가입(Sign-ups)을 비활성화**.
   - ⚠️ 필수: 가입이 열려있으면 누구나 admin 계정을 만들 수 있다(`authenticated`=admin 전제).
2. **Authentication → Users → Add user**로 **admin 계정**(이메일+비밀번호) 생성. 여러 명 가능, 모두 동일 권한.
3. **SQL Editor**에서 [`schema.sql`](./schema.sql)의 접근제어/보안 블록(파일 하단 `===== 접근 제어 =====` 이후 전부)을 실행. (`create extension pgcrypto`, RLS 교체, RPC, 댓글수 트리거 포함)

설정 후: 사이트 첫 진입 시 블러된 로그인 화면 → admin은 로그인, guest는 "게스트로 둘러보기". admin은 글에 `🔒 Admin only` 체크로 게스트에게 숨길 수 있다. 게스트 댓글은 작성 시 정한 삭제암호로만 본인이 삭제, admin은 전부 삭제 가능.

## 로컬 실행

ES module을 쓰므로 **반드시 로컬 HTTP 서버로 띄워야 한다.** `file://`로 직접 열면 Chrome이 모듈 스크립트를 CORS(origin `null`)로 차단해 app.js가 로드되지 않는다(버튼이 안 먹힘).

```bash
python -m http.server 8000      # → http://127.0.0.1:8000/index.html
# 또는: npx serve .
```

## 테스트

순수 헬퍼는 의존성 없는 node 테스트:

```bash
node test/data-layer.test.mjs   # mapRow/toRow
node test/authors.test.mjs      # 작성자 목록 헬퍼
```

## 배포 (Vercel)

1. 이 폴더를 GitHub repo로 push.
2. https://vercel.com → **Add New → Project** → 해당 repo **Import**.
3. Framework Preset: **Other**, Build Command: 비움, Output Directory: `.` (루트).
4. **Deploy** → 발급된 URL에서 확인.

`supabase.js`에 키가 들어있으므로 Vercel 환경변수 설정은 불필요.

# Pat Archive — 설계 문서 (Spec)

작성일: 2026-06-23
기반: `hyyyein/hyc_gongyoulink` (싸이월드 Y2K 링크 아카이브)
목표: **네오브루탈리즘 리스킨 + Supabase 백엔드 이전 + Vercel 배포**

---

## 1. 개요

기존 링크 아카이브 앱의 **기능·구조는 유지**하되:
1. 디자인을 Gumroad풍 **네오브루탈리즘**으로 전면 교체 (→ `Design.md`)
2. 백엔드를 **Firebase → Supabase**로 이전
3. 브랜딩을 **Pat Archive**로 변경
4. **Vercel**에 git 연동 배포

비목표(YAGNI): 로그인/회원 시스템, 권한 세분화, 다국어, 프롬프트 갤러리 별도 페이지(`prompts.html`) 부활. (필요 시 v2.)

---

## 2. 브랜딩 변경

| 항목 | 기존 | 신규 |
|------|------|------|
| 서비스 제목 | "링크 보관함 by hyeincho" | **PAT ARCHIVE** (부제 없음) |
| 헤더 명언 | "AI도 맞들면 낫다" | **삭제** |
| 추천픽 섹션명 | "혜인님 추천픽" | **Pat recommendation** |
| `<title>` | "링크 보관함 ✦ hyc" | "Pat Archive" |

---

## 3. 태그 재구성

기존 17개 → 신규 12개로 교체. 컨트롤 바 필터 + 추가 모달 태그 버튼 **양쪽 모두** 반영.

```
AI, Vibecoding, Image, Video, Product, Github, ComfyUI, Design, Prompt, Idea, Assets, ETC
```

- 기존 데이터에 남아있는 옛 태그는 그대로 표시되되, 필터 버튼은 신규 12개만 노출.
- `Prompt` 태그 선택 시 프롬프트 상세 입력칸 펼침 동작은 **유지**(기존 '프롬프트' → 'Prompt'로 키 변경).

---

## 4. 작성자 퀵버튼 (동작 변경)

- 기본 노출: **`Pat`** 1개.
- **`+` 버튼** → 이름 입력(prompt 또는 인라인 input) → 퀵버튼 칩 추가.
- 추가 목록은 **localStorage**(`patAuthors`)에 저장 → 재방문 시 복원.
- 각 칩 hover 시 **✕**로 삭제.
- 데이터 모델 변화 없음(글의 `author`는 그대로 문자열). 퀵버튼은 입력 편의 기능일 뿐.
- v2 옵션: 전원 공유가 필요하면 Supabase `authors` 테이블로 승격.

---

## 5. 디자인 시스템

→ 별도 문서 **`Design.md`** 에서 단일 관리. 요지:
- 색: 핑크 `#FF90E8` / 옐로 `#FFC900` / 검정 / 흰색 + 액센트(mint·purple·orange·lime)
- 테두리 3px 검정, 그림자 `4px 4px 0 #000`(번짐 0), radius 0
- 폰트 Space Grotesk (그로테스크 볼드)
- 컴포넌트 위치·기능 유지, 비주얼만 치환
- 기존 sparkle/float/marquee 등 장식 애니 제거 → 인터랙션 피드백 위주

---

## 6. 백엔드 — Supabase

### 6.1 스택
- DB: Supabase Postgres
- 실시간: Supabase Realtime (Postgres Changes 구독)
- 이미지: Supabase Storage (`prompts` 버킷)
- 보안: RLS 정책

### 6.2 스키마 (`schema.sql`)
```sql
create table links (
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

create table comments (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references links(id) on delete cascade,
  author     text,
  text       text not null check (char_length(text) between 1 and 1000),
  created_at bigint not null
);

-- 조회수/좋아요 원자적 증감 RPC
create function increment_views(row_id uuid) returns void
  language sql as $$ update links set views = views + 1 where id = row_id $$;

create function adjust_likes(row_id uuid, delta int) returns void
  language sql as $$ update links set likes = likes + delta where id = row_id $$;
```

### 6.3 RLS 정책 (기존 firestore.rules와 동등)
- `links`: 읽기 누구나 / insert(title 검증) / update 허용 / delete 허용
- `comments`: 읽기 누구나 / insert(text 검증) / update 불가 / delete 허용
- Storage `prompts` 버킷: 공개 읽기 / 업로드 허용
- ⚠️ 로그인 없는 신뢰 그룹 정책. 공개 확장 시 인증 + "본인 글만" 정책 필요(v2).

### 6.4 데이터 계층 매핑
| 기존 (Firestore) | → Supabase |
|---|---|
| `onSnapshot(query)` | `supabase.channel().on('postgres_changes', ...)` + 초기 `select` |
| `addDoc` | `.insert()` |
| `updateDoc` | `.update().eq('id', ...)` |
| `deleteDoc` | `.delete().eq('id', ...)` |
| `increment(views)` | `.rpc('increment_views', {row_id})` |
| `increment(likes, ±1)` | `.rpc('adjust_likes', {row_id, delta})` |
| comments 서브컬렉션 | `comments` 테이블 + `link_id` FK |
| Storage `uploadBytes` | `supabase.storage.from('prompts').upload()` |
| 이미지 압축(1200px/0.82) | **유지**(클라이언트 canvas 압축 그대로) |

### 6.5 설정 분리
- `supabase.js`에 `SUPABASE_URL` + `SUPABASE_ANON_KEY`(공개키, RLS로 보호).
- 키는 코드에 노출되어도 안전한 anon 키만 사용.

---

## 7. 유지되는 기능 (변경 없음, 백엔드만 교체)
실시간 동기화 · 검색(제목·URL) · 태그 다중 필터(OR) · 정렬(최신/오래된/좋아요/댓글) · 작성자 필터 · 카드 그리드 · 상세 모달(이미지 캐러셀·좋아요·댓글·프롬프트 복사) · 추가/수정/삭제(댓글 cascade) · URL 자동 메타(microlink) · 추천픽(pinned) · NEW 뱃지(48h) · 좋아요 중복방지(localStorage).

> 공지 팝업(특정일 하드코딩)은 **제거**(기존 4/17 1회성, Pat Archive엔 불필요).

---

## 8. 프로젝트 구조
```
pat-archive/
├── index.html      ← 마크업 + 네오브루탈 스타일(인라인 또는 style.css)
├── style.css       ← 디자인 시스템 CSS (Design.md 토큰 구현)
├── app.js          ← 앱 로직 (Supabase 버전)
├── supabase.js     ← Supabase 클라이언트 + config
├── schema.sql      ← 테이블·RLS·RPC·Storage (Supabase에 1회 실행)
├── vercel.json     ← 정적 배포 설정
├── Design.md       ← 디자인 시스템 참고 문서
└── README.md       ← 셋업(Supabase 생성)·배포(Vercel) 가이드
```
> 기존 단일 파일 구조를 약간 분리(스타일·로직·설정). 유지보수성↑, "스킨 교체" 원칙은 컴포넌트 단위로 준수.

---

## 9. 배포 — Vercel
1. GitHub repo 생성 → push
2. Vercel에서 repo import (정적 사이트, 빌드 불필요)
3. `vercel.json`으로 루트 정적 서빙
4. Supabase 프로젝트 생성 → `schema.sql` 실행 → URL·anon key를 `supabase.js`에 기입
5. 배포 확인

---

## 10. 구현 순서(요약)
1. Supabase 프로젝트·스키마 준비 (`schema.sql`)
2. `supabase.js` 클라이언트
3. `style.css` 네오브루탈 디자인 시스템
4. `index.html` 마크업(브랜딩·태그·작성자 +버튼)
5. `app.js` 로직 이식(Firestore→Supabase 매핑)
6. 로컬 검증(추가·실시간·좋아요·댓글·이미지)
7. git → Vercel 배포

---

## 11. 미해결/확인 포인트
- Supabase 프로젝트는 **사용자가 생성**(이메일·비밀번호 필요) → 본인이 만들고 키 전달, 또는 설정 단계 안내.
- 기존 원작자 데이터는 **이전하지 않음**(빈 DB로 새 시작). 필요 시 마이그레이션 별도.

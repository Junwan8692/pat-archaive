# Pat Archive — Admin/Guest 접근 제어 + 모더레이션 (Spec)

작성일: 2026-06-24
대상: Pat Archive (네오브루탈 링크 아카이브, Supabase 백엔드, Vercel 배포)
목표: 로그인 게이트(admin/guest) + 역할 기반 쓰기 제한 + 게스트 댓글(암호 삭제) + Admin-only 콘텐츠 숨김.

---

## 1. 개요 / 핵심 원칙

소수 신뢰 그룹용 큐레이션 공간. anon 키가 소스에 공개되므로 **모든 실제 권한은 DB(RLS)에서 강제**한다. 프론트(블러 오버레이·버튼 숨김)는 UX·억제용일 뿐 보안이 아니다.

- **admin** = Supabase Auth 로그인 사용자. 글 생성/수정/삭제·태그·이미지·admin-only·댓글 전체삭제 가능.
- **guest** = 비로그인(익명). 공개 글 보기 + 댓글·좋아요만. 본인 댓글은 암호로 삭제.
- 가입(sign-up) **비활성화** → 주인이 만든 admin 계정만 존재.

비목표(YAGNI): 사용자별 프로필/권한 등급 세분화, 비밀번호 재설정 UI, 댓글 수정, 감사 로그.

---

## 2. 진입 / 인증 플로우

1. 로드 시 `supabase.auth.getSession()`로 세션 확인.
2. 세션 있음 → **admin**. 오버레이 없이 진입, 쓰기 UI 노출.
3. 세션 없음 + `localStorage.patGuest !== "1"` → **로그인 오버레이**(배경 블러).
   - 오버레이: 이메일·비밀번호 입력 + **[로그인]** / **[게스트로 둘러보기]**.
   - 로그인: `supabase.auth.signInWithPassword({email,password})`. 성공 → 오버레이 닫고 admin 모드. 실패 → 에러 메시지.
   - 게스트: `localStorage.patGuest="1"` 저장 → 오버레이 닫고 guest 모드.
4. 세션 없음 + `patGuest==="1"` → 바로 guest 진입(재방문 게스트).
5. admin은 **로그아웃** 버튼 → `supabase.auth.signOut()` + `patGuest` 제거 → 오버레이 복귀.
6. `supabase.auth.onAuthStateChange`로 로그인/로그아웃 시 역할 UI 갱신.

역할 표현: `<html data-role="admin|guest">`. JS가 세션 상태로 설정.

---

## 3. UI 역할 게이팅 (프론트, 억제용)

`data-role`로 CSS 표시/숨김 (테마·크기 토글과 동일 패턴). 게스트에게 숨김:
- 헤더 `+ 링크 추가`
- 카드 hover `수정`/`삭제` 버튼
- 링크 모달 진입 자체(게스트는 못 염)
- `+ 태그 추가`, `+ 이름 추가`, 이미지 업로드 영역
- admin 전용: **로그아웃 버튼**, admin-only 체크박스, 🔒 배지

> DOM 조작으로 버튼을 되살려도 RLS가 실제 쓰기를 막으므로 안전.

---

## 4. RLS / 스키마 (실제 방어 — 핵심)

### 4.1 스키마 변경
```sql
alter table links    add column if not exists admin_only boolean default false;
alter table comments add column if not exists del_hash text;   -- 게스트 삭제암호 SHA-256 (없으면 null)
```

### 4.2 권한 매트릭스
| 동작 | 게스트(anon) | admin(authenticated) | 강제 위치 |
|------|:---:|:---:|------|
| 공개 글 보기 | ✅ | ✅ | RLS select |
| admin-only 글 보기 | ❌ | ✅ | RLS select 필터 |
| 글 insert/update/delete | ❌ | ✅ | RLS `to authenticated` |
| 태그 insert/delete | ❌ | ✅ | RLS `to authenticated` |
| 이미지 업로드(storage) | ❌ | ✅ | storage RLS `to authenticated` |
| 댓글 insert | ✅ | ✅ | RLS using(true) |
| 댓글 delete(본인 암호) | ✅(RPC) | — | `delete_comment` RPC |
| 댓글 delete(전부) | — | ✅ | RLS delete `to authenticated` |
| 좋아요/조회 | ✅ | ✅ | security definer RPC |

### 4.3 RLS 정책 (교체)
```sql
-- links
drop policy if exists links_insert on links;
drop policy if exists links_update on links;
drop policy if exists links_delete on links;
drop policy if exists links_read   on links;
create policy links_read   on links for select
  using (admin_only = false or auth.role() = 'authenticated');
create policy links_insert on links for insert to authenticated
  with check (char_length(title) between 1 and 500);
create policy links_update on links for update to authenticated using (true);
create policy links_delete on links for delete to authenticated using (true);

-- comments (insert 공개 유지, delete는 admin만 직접; 게스트는 RPC)
drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete to authenticated using (true);
-- comments_read: admin-only 글의 댓글은 게스트에게 숨김
drop policy if exists comments_read on comments;
create policy comments_read on comments for select using (
  exists (select 1 from links l
          where l.id = comments.link_id
          and (l.admin_only = false or auth.role() = 'authenticated'))
);
-- comments_insert 정책은 기존 유지(text 길이 검증, 익명 허용)

-- tags
drop policy if exists tags_insert on tags;
drop policy if exists tags_delete on tags;
create policy tags_insert on tags for insert to authenticated with check (char_length(name) between 1 and 40);
create policy tags_delete on tags for delete to authenticated using (true);

-- storage prompts: 업로드 authenticated만 (읽기 공개 유지)
drop policy if exists "prompts anon insert" on storage.objects;
create policy "prompts auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'prompts');
```

### 4.4 RPC (security definer — 게스트도 가능하되 안전하게)
```sql
-- 조회수 +1 (RLS 우회, views만 변경)
create or replace function increment_views(row_id uuid) returns void
  language sql security definer as $$ update links set views = views + 1 where id = row_id $$;

-- 좋아요 ±1 (delta 부호만 사용해 어뷰징 방지)
create or replace function adjust_likes(row_id uuid, delta int) returns void
  language sql security definer as $$ update links set likes = likes + sign(delta) where id = row_id $$;

-- 게스트 댓글 삭제: 해시 일치 시에만
create or replace function delete_comment(comment_id uuid, pw_hash text) returns void
  language sql security definer as $$
    delete from comments where id = comment_id and del_hash is not null and del_hash = pw_hash;
  $$;
```
> security definer 함수는 소유자 권한으로 실행되어 RLS를 우회하므로, **딱 그 컬럼/행만** 건드리도록 좁게 작성. `search_path`는 Supabase 기본(`public`) 사용.

---

## 5. 댓글 동작 (프론트)

- 댓글 폼: 닉네임 + 내용 + **삭제용 암호(선택)**.
- 작성 시: 암호가 있으면 `del_hash = SHA-256(pw)` (브라우저 `crypto.subtle.digest`)로 변환해 insert. 암호 없으면 `del_hash=null`(게스트는 못 지움, admin만).
- 댓글에 ✕(삭제) 표시:
  - admin: 항상 노출 → 직접 `supabase.from('comments').delete().eq('id',id)`.
  - guest: 노출하되 클릭 시 암호 입력 → `SHA-256(입력)` → `rpc('delete_comment',{comment_id, pw_hash})`. 일치하면 삭제, 아니면 "암호가 일치하지 않아요".
- `comment_count` 감소: 삭제 후 처리(admin 직접 삭제 시 update; RPC 삭제 시 RPC 내에서 처리하거나 클라이언트가 보정). → **구현 시: comment_count는 댓글 실시간 구독 길이로 표시하거나, 삭제 경로마다 감소 update.** (계획서에서 단일 방식으로 고정한다.)

---

## 6. 조회수 = 클릭수
기존 동작 유지: 카드 클릭 → 상세 열람 시 `increment_views` +1. (중복 제거 없음, raw 클릭수.) RPC만 security definer로 바꿔 게스트도 카운트되게 함.

---

## 7. Admin-only 콘텐츠
- 모달 하단 체크박스 `🔒 Admin only` → `admin_only` 저장(생성·수정 모두).
- 게스트: RLS가 admin-only 글·댓글을 응답에서 제외(직접 API도 차단).
- admin: 전부 보임. 카드에 🔒 배지(`admin_only===true`일 때).
- 프론트도 안전망으로 admin-only 카드를 게스트 화면에서 거름(이중 방어).

---

## 8. 주인 1회 셋업 (README에 기록)
1. Supabase → Authentication → Providers/Settings에서 **Sign-ups 비활성화**(Email 회원가입 off).
2. Authentication → Users → **admin 계정 수동 생성**(이메일+비번). (여러 명 가능, 모두 동일 권한)
3. `schema.sql`의 신규 SQL(섹션 4) 실행.

---

## 9. 파일 변경
| 파일 | 변경 |
|------|------|
| `schema.sql` | admin_only/del_hash 컬럼, RLS 교체, RPC 3종(definer), storage 정책 |
| `index.html` | 로그인 오버레이, 로그아웃 버튼, admin-only 체크박스, 댓글 암호 입력칸 |
| `style.css` | 오버레이(블러 백드롭+네오브루탈 로그인 카드), `data-role` 숨김 규칙, 🔒 배지 |
| `app.js` | 세션/로그인/게스트/로그아웃, data-role, admin-only 저장·필터·배지, 댓글 암호 해시·삭제(RPC) |
| `lib/hash.mjs` (+test) | `sha256Hex(str)` 순수 헬퍼(Node·브라우저 공용 crypto.subtle 래퍼) — 테스트로 알려진 입력→해시 검증 |
| `README.md` | 주인 셋업 절차 |

---

## 10. 테스트
- 순수 헬퍼: `sha256Hex("test")` === 알려진 SHA-256 hex 고정값.
- RLS/Auth/UI: 배포본에서 수동 — admin 로그인 시 쓰기 가능, 게스트 쓰기 차단(REST 직접 호출로도 차단 확인), admin-only 글이 게스트에 안 보임, 게스트 댓글 작성/암호삭제, admin 전체삭제.

## 11. 미해결/주의
- `comment_count` 감소 방식은 계획서에서 단일 경로로 확정.
- security definer RPC는 좁은 범위 유지(전체 update 노출 금지).
- 첫 로그인 후 FOUC/오버레이 깜빡임은 허용(소규모).

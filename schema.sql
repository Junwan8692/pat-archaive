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

-- Storage: prompts 버킷 익명 읽기/업로드 허용
-- (대시보드에서 prompts 버킷을 Public으로 생성한 뒤 아래 정책 실행)
-- 공개 버킷은 읽기만 열리므로, 익명 업로드(insert)는 정책이 별도로 필요함.
create policy "prompts public read" on storage.objects
  for select using (bucket_id = 'prompts');
create policy "prompts anon insert" on storage.objects
  for insert with check (bucket_id = 'prompts');

-- ===== 공유 태그 테이블 =====
create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 40),
  created_at bigint not null
);
alter table tags enable row level security;
create policy tags_read   on tags for select using (true);
create policy tags_insert on tags for insert with check (char_length(name) between 1 and 40);
create policy tags_delete on tags for delete using (true);
alter publication supabase_realtime add table tags;

-- 기본 태그 12종 시드 (created_at = 1..12 로 원래 순서 유지; 사용자 추가분은 Date.now()라 뒤에 정렬됨)
insert into tags (name, created_at)
select name, ord
from unnest(array['AI','Vibecoding','Image','Video','Product','Github','ComfyUI','Design','Prompt','Idea','Assets','ETC'])
     with ordinality as t(name, ord)
on conflict (name) do nothing;

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
  language sql security definer as $$ update links set likes = likes + sign(delta)::int where id = row_id $$;

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

create or replace function bump_comment_count(row_id uuid) returns void
  language sql security definer as $$ update links set comment_count = comment_count + 1 where id = row_id $$;

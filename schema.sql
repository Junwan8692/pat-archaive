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

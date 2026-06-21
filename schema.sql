-- ============================================================
-- Supabase Realtime 群聊 + 匿名树洞 数据库 Schema
-- 在 Supabase Dashboard > SQL Editor 中执行
-- ============================================================

-- ---------- 1. 频道表 ----------
create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null default 'group' check (type in ('group','treehole')),
  description text,
  created_at  timestamptz not null default now()
);

-- ---------- 2. 消息表 ----------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  user_id     text not null,           -- 客户端生成的用户ID
  username    text not null,           -- 显示名
  avatar_color text not null default '#611f69', -- 头像背景色
  content     text not null,
  is_anon     boolean not null default false,  -- 树洞匿名标记
  created_at  timestamptz not null default now()
);

create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

-- ---------- 3. 表情回应表 ----------
create table if not exists public.reactions (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.messages(id) on delete cascade,
  emoji       text not null,
  user_id     text not null,
  created_at  timestamptz not null default now(),
  unique (message_id, emoji, user_id)
);

-- ---------- 4. 初始频道数据 ----------
insert into public.channels (name, type, description) values
  ('general',   'group',     '综合讨论区，畅所欲言'),
  ('random',    'group',     '闲聊灌水，摸鱼圣地'),
  ('tech',      'group',     '技术交流 & 代码分享'),
  ('treehole',  'treehole',  '匿名树洞 · 无人知晓你是谁')
on conflict do nothing;

-- ---------- 5. 开启 RLS ----------
alter table public.channels  enable row level security;
alter table public.messages  enable row level security;
alter table public.reactions enable row level security;

-- ---------- 6. RLS 策略（演示用：开放匿名读写） ----------
-- 生产环境请收紧为 authenticated 角色 + 具体策略
create policy "channels read"  on public.channels  for select to anon, authenticated using (true);
create policy "messages read"  on public.messages  for select to anon, authenticated using (true);
create policy "messages write" on public.messages  for insert to anon, authenticated with check (true);
create policy "messages del"   on public.messages  for delete to anon, authenticated using (true);

create policy "reactions read"  on public.reactions for select to anon, authenticated using (true);
create policy "reactions write" on public.reactions for insert to anon, authenticated with check (true);
create policy "reactions del"   on public.reactions for delete to anon, authenticated using (true);

-- ---------- 7. 启用 Realtime 发布 ----------
-- 方式一：SQL（推荐）
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.channels;

-- 方式二：Dashboard > Database > Publications > supabase_realtime 勾选三张表

-- ---------- 8. 让 UPDATE/DELETE 能拿到旧记录 ----------
alter table public.messages  replica identity full;
alter table public.reactions replica identity full;

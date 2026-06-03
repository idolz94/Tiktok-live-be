-- Optional helper migration for Python -> Node -> Supabase/SSE flow.
-- Run in Supabase SQL Editor if your existing schema is missing these columns.

alter table public.shops
add column if not exists default_tiktok_username text;

alter table public.live_sessions
add column if not exists external_session_id text,
add column if not exists tiktok_username text,
add column if not exists started_at timestamptz,
add column if not exists ended_at timestamptz,
add column if not exists duration_seconds integer not null default 0,
add column if not exists comment_count integer not null default 0,
add column if not exists order_count integer not null default 0,
add column if not exists customer_count integer not null default 0,
add column if not exists status text not null default 'running',
add column if not exists end_reason text,
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists live_sessions_shop_external_session_id_uq
on public.live_sessions(shop_id, external_session_id)
where external_session_id is not null;

alter table public.live_comments
add column if not exists external_comment_id text,
add column if not exists tiktok_comment_id text,
add column if not exists tiktok_username text,
add column if not exists tiktok_unique_id text,
add column if not exists display_name text,
add column if not exists avatar_url text,
add column if not exists comment_text text,
add column if not exists text text,
add column if not exists raw_text text,
add column if not exists intent text not null default 'normal',
add column if not exists priority_level text not null default 'normal',
add column if not exists final_score numeric not null default 0,
add column if not exists has_number boolean not null default false,
add column if not exists can_create_order boolean not null default true,
add column if not exists is_order_created boolean not null default false,
add column if not exists order_id uuid references public.orders(id) on delete set null,
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists live_comments_shop_external_comment_id_uq
on public.live_comments(shop_id, external_comment_id)
where external_comment_id is not null;

select pg_notify('pgrst', 'reload schema');

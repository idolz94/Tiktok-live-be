-- Bảng quản lý nhiều kênh TikTok cho mỗi shop
create table if not exists public.shop_tiktok_channels (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  tiktok_username text not null,
  display_name text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shop_tiktok_channels_shop_username_uq
  on public.shop_tiktok_channels(shop_id, tiktok_username);

-- Chỉ 1 kênh được là default mỗi shop
create unique index if not exists shop_tiktok_channels_shop_default_uq
  on public.shop_tiktok_channels(shop_id)
  where is_default = true;

alter table public.shop_tiktok_channels enable row level security;

-- Migrate kênh cũ từ shops.default_tiktok_username vào bảng mới
insert into public.shop_tiktok_channels (shop_id, tiktok_username, is_default)
select id, default_tiktok_username, true
from public.shops
where default_tiktok_username is not null
  and default_tiktok_username != ''
on conflict do nothing;

select pg_notify('pgrst', 'reload schema');

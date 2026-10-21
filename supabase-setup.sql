-- =====================================================================
-- supabase-setup.sql — Serene Mind : catalogue, rôles, RLS
--
-- ORDRE D'EXÉCUTION (SQL Editor de Supabase) :
--   1) supabase-setup.sql    (ce fichier)
--   2) supabase-orders.sql
--   3) supabase-admin.sql    (APRÈS avoir créé un compte via signup.html)
--
-- ⚠ Conçu pour un projet Supabase NEUF (aucune table products/user_roles).
--   Il est relançable sans perte : create ... if not exists, policies
--   recréées, données initiales insérées avec "on conflict do nothing".
--   Si vous avez déjà des tables products/user_roles de schéma différent,
--   NE LANCEZ PAS ce script : écrivez d'abord une migration distincte.
--
-- Montants : entiers en centimes (1200 = 12,00 TND).
-- =====================================================================

-- ---------- Catalogue ----------
create table if not exists public.products (
  id           text primary key
               check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 60),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  category     text not null check (category in ('tea', 'stationery', 'candles', 'music')),
  description  text not null default '' check (char_length(description) <= 1000),
  price_cents  integer not null check (price_cents > 0 and price_cents <= 100000000),
  -- fichier du site (ex. images/the.jpg) ou URL HTTPS publique
  image_url    text check (
                 image_url is null
                 or image_url ~* '^(https://[^[:space:]]+|[a-z0-9_./-]+\.(png|jpe?g|webp|gif|svg|avif))$'
               ),
  features     text[] not null default '{}' check (cardinality(features) <= 20),
  is_available boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- Rôles ----------
-- L'absence de ligne = compte client. Seul le rôle 'admin' existe.
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin')),
  created_at timestamptz not null default now()
);

-- Fonction utilisée par les politiques RLS. SECURITY DEFINER pour lire
-- user_roles sans dépendre des droits de l'appelant ; search_path vide.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- Droits SQL + RLS : products ----------
alter table public.products enable row level security;

revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated; -- filtré par RLS (admin)

drop policy if exists "products_public_read_available" on public.products;
create policy "products_public_read_available"
  on public.products for select
  to anon, authenticated
  using (is_available);

drop policy if exists "products_admin_read_all" on public.products;
create policy "products_admin_read_all"
  on public.products for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "products_admin_insert" on public.products;
create policy "products_admin_insert"
  on public.products for insert
  to authenticated
  with check ((select public.is_admin()));

drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update"
  on public.products for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete"
  on public.products for delete
  to authenticated
  using ((select public.is_admin()));

-- ---------- Droits SQL + RLS : user_roles ----------
-- Lecture de SON propre rôle uniquement. Aucune écriture depuis le navigateur,
-- même pour un admin : l'attribution se fait dans SQL Editor (supabase-admin.sql).
alter table public.user_roles enable row level security;

revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

drop policy if exists "user_roles_read_own" on public.user_roles;
create policy "user_roles_read_own"
  on public.user_roles for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Données initiales (catalogue actuel du site) ----------
insert into public.products (id, name, category, description, price_cents, features) values
  ('herbal-botanical-tea', 'Herbal Botanical Tea Blend', 'tea',
   'Calming Chamomile & Lavender', 1200, array['Chamomile', 'Lavender', 'Caffeine free']),
  ('vintage-linen-journal', 'Vintage Linen Journal & Pen', 'stationery',
   'Parchment paper for self-reflection', 2500, array['Linen cover', 'Parchment pages']),
  ('aromatherapy-soy-candle', 'Aromatherapy Soy Candle', 'candles',
   'Sage & Dried Rose scent', 1800, array['Soy wax', 'Sage & dried rose']),
  ('rainy-lofi-vinyl', 'Rainy Lo-Fi Vinyl Record', 'music',
   'Relaxing acoustic ambient music', 3500, array['Acoustic', 'Ambient'])
on conflict (id) do nothing;

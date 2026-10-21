-- SERENE MIND: ملف واحد = supabase-setup.sql + supabase-orders.sql (الصقه كله في SQL Editor ثم Run)

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


-- =====================================================================
-- supabase-orders.sql — commandes de démonstration
--
-- ORDRE : à exécuter APRÈS supabase-setup.sql (utilise products et is_admin()).
-- Relançable sans supprimer les commandes : create table if not exists,
-- create or replace function, policies/trigger recréés.
--
-- Paiement : SIMULATION uniquement. Aucune donnée bancaire n'est stockée.
-- Livraison : 7,00 TND, offerte dès 100,00 TND de sous-total
--   (constantes c_shipping_fee / c_free_threshold dans la fonction ;
--    gardez les mêmes valeurs dans script.js).
-- =====================================================================

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  user_id         uuid not null references auth.users (id) on delete restrict,
  attempt_id      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,        -- détection de modification concurrente
  customer_email  text,
  customer_name   text not null,
  items           jsonb not null,                    -- instantané : id, nom, prix unitaire, quantité
  shipping        jsonb not null,                    -- full_name, phone, address, city, postal_code
  payment_method  text not null check (payment_method in ('cash_on_delivery_demo', 'card_demo')),
  subtotal_cents  integer not null check (subtotal_cents >= 0),
  shipping_cents  integer not null check (shipping_cents >= 0),
  total_cents     integer not null check (total_cents >= 0),
  status          text not null default 'new'
                  check (status in ('new', 'preparing', 'completed', 'cancelled')),
  constraint orders_user_attempt_unique unique (user_id, attempt_id)
);

create index if not exists orders_user_created_idx   on public.orders (user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_created_idx        on public.orders (created_at desc, id desc);

-- ---------- Trigger : version + updated_at ----------
create or replace function public.orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_touch_trg on public.orders;
create trigger orders_touch_trg
  before update on public.orders
  for each row execute function public.orders_touch();

-- ---------- Droits SQL + RLS ----------
alter table public.orders enable row level security;

revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
-- Seule la colonne status est modifiable depuis le navigateur (et seulement par un admin via RLS).
grant update (status) on public.orders to authenticated;
-- Aucun INSERT/DELETE direct : la création passe par create_demo_order().

drop policy if exists "orders_read_own" on public.orders;
create policy "orders_read_own"
  on public.orders for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "orders_admin_read_all" on public.orders;
create policy "orders_admin_read_all"
  on public.orders for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "orders_admin_update_status" on public.orders;
create policy "orders_admin_update_status"
  on public.orders for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------- Création atomique et idempotente d'une commande ----------
create or replace function public.create_demo_order(
  p_attempt_id           uuid,
  p_items                jsonb,   -- [{"id":"tea-...","quantity":2}, ...]
  p_shipping             jsonb,   -- {full_name, phone, address, city, postal_code}
  p_payment_method       text,
  p_expected_total_cents integer  -- total affiché au client, pour détecter un changement de prix
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_free_threshold constant bigint := 10000;
  c_shipping_fee   constant integer := 700;

  v_uid       uuid := (select auth.uid());
  v_existing  public.orders;
  v_order     public.orders;
  v_bad       integer;
  v_maxqty    integer;
  v_requested integer;
  v_found     integer;
  v_snapshot  jsonb;
  v_subtotal  bigint;
  v_shipping  integer;
  v_total     bigint;
  v_name      text;
  v_phone     text;
  v_addr      text;
  v_city      text;
  v_postal    text;
  v_ship      jsonb;
  v_ref       text;
  v_try       integer := 0;
begin
  -- Identité : toujours auth.uid(), jamais une valeur envoyée par le navigateur
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_attempt_id is null then
    raise exception 'invalid_attempt';
  end if;

  -- Nouvelle tentative identique (coupure réseau) : renvoie la commande déjà créée
  select * into v_existing
  from public.orders o
  where o.user_id = v_uid and o.attempt_id = p_attempt_id;
  if found then
    return v_existing;
  end if;

  -- Validation des lignes
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid_items';
  end if;

  select count(*) into v_bad
  from (
    select
      (jsonb_typeof(e) = 'object'
       and jsonb_typeof(e -> 'id') = 'string'
       and jsonb_typeof(e -> 'quantity') = 'number') as ok,
      case when jsonb_typeof(e -> 'quantity') = 'number'
           then (e ->> 'quantity')::numeric else 0 end as q
    from jsonb_array_elements(p_items) e
  ) parsed
  where not ok or q <> trunc(q) or q not between 1 and 20;

  if v_bad > 0 then
    raise exception 'invalid_items';
  end if;

  -- Prix et noms lus dans le catalogue, jamais dans la requête
  with parsed as (
    select e ->> 'id' as id, (e ->> 'quantity')::integer as q
    from jsonb_array_elements(p_items) e
  ),
  agg as (
    select id, sum(q)::integer as qty from parsed group by id
  )
  select
    count(a.id),
    count(p.id),
    coalesce(max(a.qty), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'unit_price_cents', p.price_cents,
          'quantity', a.qty,
          'line_total_cents', p.price_cents::bigint * a.qty
        ) order by p.id
      ) filter (where p.id is not null),
      '[]'::jsonb
    ),
    coalesce(sum(p.price_cents::bigint * a.qty), 0)
  into v_requested, v_found, v_maxqty, v_snapshot, v_subtotal
  from agg a
  left join public.products p on p.id = a.id and p.is_available;

  if v_requested = 0 or v_maxqty > 20 or v_subtotal > 100000000 then
    raise exception 'invalid_items';
  end if;
  if v_found <> v_requested then
    raise exception 'product_unavailable';
  end if;

  -- Montants calculés ici
  v_shipping := case when v_subtotal >= c_free_threshold then 0 else c_shipping_fee end;
  v_total := v_subtotal + v_shipping;

  if p_expected_total_cents is distinct from v_total::integer then
    raise exception 'price_changed' using hint = v_total::text;
  end if;

  -- Coordonnées de livraison
  if p_shipping is null or jsonb_typeof(p_shipping) <> 'object' then
    raise exception 'invalid_shipping';
  end if;
  v_name   := btrim(coalesce(p_shipping ->> 'full_name', ''));
  v_phone  := btrim(coalesce(p_shipping ->> 'phone', ''));
  v_addr   := btrim(coalesce(p_shipping ->> 'address', ''));
  v_city   := btrim(coalesce(p_shipping ->> 'city', ''));
  v_postal := btrim(coalesce(p_shipping ->> 'postal_code', ''));

  if char_length(v_name) not between 2 and 120
     or char_length(v_phone) not between 6 and 30
     or v_phone !~ '^[0-9+()./ -]+$'
     or char_length(v_addr) not between 5 and 250
     or char_length(v_city) not between 2 and 100
     or char_length(v_postal) > 20 then
    raise exception 'invalid_shipping';
  end if;

  v_ship := jsonb_build_object(
    'full_name', v_name, 'phone', v_phone, 'address', v_addr,
    'city', v_city, 'postal_code', v_postal
  );

  if coalesce(p_payment_method, '') not in ('cash_on_delivery_demo', 'card_demo') then
    raise exception 'invalid_payment';
  end if;

  -- Insertion atomique (la fonction entière est une seule transaction)
  loop
    v_ref := 'SM-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-'
             || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.orders (
        reference, user_id, attempt_id, customer_email, customer_name,
        items, shipping, payment_method,
        subtotal_cents, shipping_cents, total_cents
      ) values (
        v_ref, v_uid, p_attempt_id, (select auth.jwt() ->> 'email'), v_name,
        v_snapshot, v_ship, p_payment_method,
        v_subtotal::integer, v_shipping, v_total::integer
      )
      returning * into v_order;
      exit;
    exception when unique_violation then
      -- Soit la même tentative vient d'être créée en parallèle, soit collision de référence
      select * into v_existing
      from public.orders o
      where o.user_id = v_uid and o.attempt_id = p_attempt_id;
      if found then
        return v_existing;
      end if;
      v_try := v_try + 1;
      if v_try > 5 then
        raise;
      end if;
    end;
  end loop;

  return v_order;
end;
$$;

-- Réservé aux utilisateurs connectés
revoke all on function public.create_demo_order(uuid, jsonb, jsonb, text, integer) from public, anon;
grant execute on function public.create_demo_order(uuid, jsonb, jsonb, text, integer) to authenticated;

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

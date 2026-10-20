-- =====================================================================
--  BRELLOR · Configuración de la base de datos en Supabase
--  Cómo usarlo: Supabase > SQL Editor > New query > pega TODO esto > Run
--  Se puede volver a correr sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Administradores (correos que pueden entrar al panel) ----------
create table if not exists public.admins (
  email text primary key
);

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.es_admin() to anon, authenticated;

-- ---------- Categorías (secciones del catálogo) ----------
create table if not exists public.categorias (
  id     text primary key,
  nombre text not null,
  orden  int  not null default 0
);

insert into public.categorias (id, nombre, orden) values
  ('cadenas',   'Cadenas',   1),
  ('aretes',    'Aretes',    2),
  ('anillos',   'Anillos',   3),
  ('pulsos',    'Pulsos',    4),
  ('ice-chain', 'Ice Chain', 5)
on conflict (id) do nothing;

-- ---------- Productos / inventario ----------
create table if not exists public.productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text not null default '',
  categoria   text not null references public.categorias(id),
  material    text not null default '',
  precio      numeric(12,2) not null check (precio >= 0),
  existencias int  not null default 0 check (existencias >= 0),
  fotos       text[] not null default '{}',
  publicado   boolean not null default true,
  destacado   boolean not null default false,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists productos_categoria_idx on public.productos (categoria);

-- ---------- Pedidos ----------
create table if not exists public.pedidos (
  id               uuid primary key default gen_random_uuid(),
  folio            bigint generated always as identity,
  cliente_nombre   text not null,
  cliente_telefono text not null,
  cliente_ciudad   text not null default '',
  notas            text not null default '',
  articulos        jsonb not null,
  total            numeric(12,2) not null,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','pagado','enviado','entregado','cancelado')),
  creado           timestamptz not null default now()
);

-- ---------- Ajustes de la tienda (WhatsApp, ubicaciones, etc.) ----------
create table if not exists public.ajustes (
  clave text primary key,
  valor text not null default ''
);
insert into public.ajustes (clave, valor) values
  ('whatsapp',   ''),
  ('instagram',  'brellor_mx'),
  ('ubicaciones','Mérida, Yucatán · Tapachula, Chiapas'),
  ('aviso_pago', 'Al confirmar tu pedido te escribimos por WhatsApp para el pago y el envío.')
on conflict (clave) do nothing;

-- ---------- Seguridad (RLS) ----------
alter table public.admins     enable row level security;
alter table public.categorias enable row level security;
alter table public.productos  enable row level security;
alter table public.pedidos    enable row level security;
alter table public.ajustes    enable row level security;

drop policy if exists "admins lectura"        on public.admins;
drop policy if exists "categorias lectura"    on public.categorias;
drop policy if exists "categorias admin"      on public.categorias;
drop policy if exists "productos lectura"     on public.productos;
drop policy if exists "productos admin"       on public.productos;
drop policy if exists "pedidos admin"         on public.pedidos;
drop policy if exists "ajustes lectura"       on public.ajustes;
drop policy if exists "ajustes admin"         on public.ajustes;

create policy "admins lectura"     on public.admins     for select using (public.es_admin());
create policy "categorias lectura" on public.categorias for select using (true);
create policy "categorias admin"   on public.categorias for all using (public.es_admin()) with check (public.es_admin());
create policy "productos lectura"  on public.productos  for select using (publicado or public.es_admin());
create policy "productos admin"    on public.productos  for all using (public.es_admin()) with check (public.es_admin());
create policy "pedidos admin"      on public.pedidos    for all using (public.es_admin()) with check (public.es_admin());
create policy "ajustes lectura"    on public.ajustes    for select using (true);
create policy "ajustes admin"      on public.ajustes    for all using (public.es_admin()) with check (public.es_admin());

-- ---------- Crear pedido: revisa existencias y las descuenta sola ----------
create or replace function public.crear_pedido(
  p_nombre text, p_telefono text, p_ciudad text, p_notas text, p_articulos jsonb
) returns table (o_folio bigint, o_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  it      jsonb;
  prod    public.productos%rowtype;
  cant    int;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_folio bigint;
begin
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Escribe tu nombre y teléfono';
  end if;
  if p_articulos is null or jsonb_typeof(p_articulos) <> 'array' or jsonb_array_length(p_articulos) = 0 then
    raise exception 'Tu carrito está vacío';
  end if;
  if jsonb_array_length(p_articulos) > 30 then
    raise exception 'Demasiados artículos en un solo pedido';
  end if;

  for it in select * from jsonb_array_elements(p_articulos) loop
    cant := (it ->> 'cantidad')::int;
    if cant is null or cant < 1 or cant > 20 then
      raise exception 'Cantidad no válida';
    end if;
    select * into prod from public.productos
      where id = (it ->> 'id')::uuid and publicado
      for update;
    if not found then
      raise exception 'Una de las piezas ya no está disponible';
    end if;
    if prod.existencias < cant then
      raise exception 'De "%" solo quedan %', prod.nombre, prod.existencias;
    end if;
    update public.productos
      set existencias = existencias - cant, actualizado = now()
      where id = prod.id;
    v_total := v_total + prod.precio * cant;
    v_items := v_items || jsonb_build_object(
      'id', prod.id, 'nombre', prod.nombre, 'precio', prod.precio,
      'cantidad', cant, 'foto', coalesce(prod.fotos[1], ''));
  end loop;

  insert into public.pedidos (cliente_nombre, cliente_telefono, cliente_ciudad, notas, articulos, total)
  values (left(trim(p_nombre), 120), left(trim(p_telefono), 30),
          left(coalesce(p_ciudad, ''), 120), left(coalesce(p_notas, ''), 500),
          v_items, v_total)
  returning folio into v_folio;

  return query select v_folio, v_total;
end $$;
grant execute on function public.crear_pedido(text, text, text, text, jsonb) to anon, authenticated;

-- ---------- Cambiar estado de pedido (cancelar regresa las piezas) ----------
create or replace function public.cambiar_estado_pedido(p_id uuid, p_estado text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  ped public.pedidos%rowtype;
  it  jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select * into ped from public.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if ped.estado = p_estado then return; end if;
  if ped.estado = 'cancelado' then
    raise exception 'Un pedido cancelado ya no se puede reactivar';
  end if;
  if p_estado = 'cancelado' then
    for it in select * from jsonb_array_elements(ped.articulos) loop
      update public.productos
        set existencias = existencias + (it ->> 'cantidad')::int, actualizado = now()
        where id = (it ->> 'id')::uuid;
    end loop;
  end if;
  update public.pedidos set estado = p_estado where id = p_id;
end $$;
grant execute on function public.cambiar_estado_pedido(uuid, text) to authenticated;

-- ---------- Fotos: carpeta pública "productos" ----------
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

drop policy if exists "brellor fotos lectura" on storage.objects;
drop policy if exists "brellor fotos subir"   on storage.objects;
drop policy if exists "brellor fotos editar"  on storage.objects;
drop policy if exists "brellor fotos borrar"  on storage.objects;

create policy "brellor fotos lectura" on storage.objects for select
  using (bucket_id = 'productos');
create policy "brellor fotos subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.es_admin());
create policy "brellor fotos editar" on storage.objects for update to authenticated
  using (bucket_id = 'productos' and public.es_admin());
create policy "brellor fotos borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.es_admin());

-- =====================================================================
--  ÚLTIMO PASO: pon aquí el correo del dueño (el mismo con el que
--  crearás su usuario en Authentication > Users). Cámbialo y corre esto.
-- =====================================================================
insert into public.admins (email) values ('CORREO-DEL-DUENO@gmail.com')
on conflict (email) do nothing;

-- FLAMA · Salón — control de bebidas. Esquema propio dentro del proyecto Supabase "Marvel Compartido".
-- Solo CREA objetos nuevos: el esquema flama_salon (no expuesto por la API) y funciones
-- públicas con prefijo salon_. No modifica nada existente ni toca el esquema flama (cocina).

create schema if not exists flama_salon;
revoke all on schema flama_salon from public;

create table if not exists flama_salon.config (clave text primary key, valor text);

create table if not exists flama_salon.bebidas (
  id text primary key,
  nombre text not null,
  categoria text not null,
  familia text,                      -- agrupa presentaciones del mismo producto (alerta al cargar)
  unidad text not null,              -- unidad de conteo: botella, lata, ml
  capacidad_ml numeric,              -- solo destilados: ml por botella cerrada
  venta_directa boolean not null default true,
  eventual boolean not null default false,
  orden int not null default 1000,
  activo boolean not null default true
);

create table if not exists flama_salon.tragos (
  id text primary key,
  nombre text not null,
  orden int not null default 1000,
  activo boolean not null default true
);

create table if not exists flama_salon.recetas (
  trago_id text not null references flama_salon.tragos(id) on delete cascade,
  bebida_id text not null references flama_salon.bebidas(id),
  cantidad numeric not null check (cantidad > 0),   -- en la unidad de conteo de la bebida
  primary key (trago_id, bebida_id)
);

create table if not exists flama_salon.cierres (
  fecha date primary key,
  nota text,
  actualizado timestamptz not null default now()
);

create table if not exists flama_salon.cierre_bebidas (
  fecha date not null references flama_salon.cierres(fecha) on delete cascade,
  bebida_id text not null references flama_salon.bebidas(id),
  stock numeric check (stock is null or stock >= 0),          -- en unidad de conteo (destilados: ml)
  venta_directa numeric check (venta_directa is null or venta_directa >= 0),
  botellas_cerradas numeric check (botellas_cerradas is null or botellas_cerradas >= 0),
  ml_abierta numeric check (ml_abierta is null or ml_abierta >= 0),
  primary key (fecha, bebida_id)
);

create table if not exists flama_salon.cierre_tragos (
  fecha date not null references flama_salon.cierres(fecha) on delete cascade,
  trago_id text not null references flama_salon.tragos(id),
  cantidad numeric not null check (cantidad >= 0),
  primary key (fecha, trago_id)
);

create table if not exists flama_salon.ingresos (
  id bigint generated always as identity primary key,
  fecha date not null,
  bebida_id text not null references flama_salon.bebidas(id),
  cantidad numeric not null check (cantidad > 0),   -- en unidad de conteo (destilados: ml)
  observacion text,
  creado timestamptz not null default now()
);
create index if not exists salon_ingresos_bebida_fecha on flama_salon.ingresos (bebida_id, fecha);

create table if not exists flama_salon.ajustes (
  id bigint generated always as identity primary key,
  fecha date not null,
  bebida_id text not null references flama_salon.bebidas(id),
  cantidad numeric not null,          -- positivo suma, negativo resta (rotura, consumo interno)
  motivo text not null,
  creado timestamptz not null default now()
);

-- ---------- utilidades ----------
create or replace function flama_salon.hoy() returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

create or replace function flama_salon.slug(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function flama_salon.pin_ok(p_pin text) returns boolean
language plpgsql security definer set search_path = flama_salon, extensions as $$
declare h text;
begin
  select valor into h from flama_salon.config where clave = 'pin_hash';
  if h is null or p_pin is null or extensions.crypt(p_pin, h) <> h then
    perform pg_sleep(0.7);
    return false;
  end if;
  return true;
end $$;

-- stock en unidad de conteo a partir de lo cargado; destilados: botellas × capacidad + ml abierta
create or replace function flama_salon.stock_calc(p_bebida text, p_stock numeric, p_botellas numeric, p_ml numeric) returns numeric
language sql stable as $$
  select case
    when b.unidad = 'ml' and (p_botellas is not null or p_ml is not null)
      then coalesce(p_botellas, 0) * coalesce(b.capacidad_ml, 0) + coalesce(p_ml, 0)
    else p_stock end
  from flama_salon.bebidas b where b.id = p_bebida;
$$;

-- ---------- PIN ----------
create or replace function public.salon_pin_estado() returns json
language sql security definer set search_path = flama_salon as $$
  select json_build_object('definido', exists (select 1 from flama_salon.config where clave = 'pin_hash' and valor is not null));
$$;

create or replace function public.salon_pin_set(p_actual text, p_nuevo text) returns json
language plpgsql security definer set search_path = flama_salon, extensions as $$
declare existe boolean;
begin
  select exists (select 1 from flama_salon.config where clave = 'pin_hash' and valor is not null) into existe;
  if existe and not flama_salon.pin_ok(p_actual) then raise exception 'PIN_INCORRECTO'; end if;
  if p_nuevo is null or length(p_nuevo) < 4 or length(p_nuevo) > 32 then raise exception 'PIN_INVALIDO'; end if;
  insert into flama_salon.config (clave, valor) values ('pin_hash', extensions.crypt(p_nuevo, extensions.gen_salt('bf')))
  on conflict (clave) do update set valor = excluded.valor;
  return json_build_object('ok', true);
end $$;

-- ---------- catálogo ----------
create or replace function public.salon_catalogo() returns json
language sql security definer set search_path = flama_salon as $$
  select json_build_object(
    'hoy', flama_salon.hoy(),
    'bebidas', coalesce((select json_agg(json_build_object(
        'id', id, 'nombre', nombre, 'categoria', categoria, 'familia', familia, 'unidad', unidad,
        'capacidad_ml', capacidad_ml, 'venta_directa', venta_directa, 'eventual', eventual, 'orden', orden, 'activo', activo)
        order by orden, nombre) from flama_salon.bebidas), '[]'::json),
    'tragos', coalesce((select json_agg(json_build_object(
        'id', t.id, 'nombre', t.nombre, 'orden', t.orden, 'activo', t.activo,
        'receta', coalesce((select json_agg(json_build_object('bebida_id', r.bebida_id, 'cantidad', r.cantidad))
                            from flama_salon.recetas r where r.trago_id = t.id), '[]'::json))
        order by t.orden, t.nombre) from flama_salon.tragos t), '[]'::json)
  );
$$;

create or replace function public.salon_bebida_guardar(p_pin text, p_bebida json) returns json
language plpgsql security definer set search_path = flama_salon as $$
declare v_id text;
begin
  if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  v_id := coalesce(nullif(p_bebida->>'id', ''), flama_salon.slug(p_bebida->>'nombre'));
  if v_id = '' then raise exception 'NOMBRE_INVALIDO'; end if;
  if (p_bebida->>'unidad') not in ('botella', 'lata', 'ml', 'unidad') then raise exception 'UNIDAD_INVALIDA'; end if;
  insert into flama_salon.bebidas (id, nombre, categoria, familia, unidad, capacidad_ml, venta_directa, eventual, orden, activo)
  values (v_id, p_bebida->>'nombre', coalesce(p_bebida->>'categoria', 'Otros'), nullif(p_bebida->>'familia', ''), p_bebida->>'unidad',
          nullif(p_bebida->>'capacidad_ml', '')::numeric, coalesce((p_bebida->>'venta_directa')::boolean, true),
          coalesce((p_bebida->>'eventual')::boolean, false), coalesce((p_bebida->>'orden')::int, 1000), coalesce((p_bebida->>'activo')::boolean, true))
  on conflict (id) do update set nombre = excluded.nombre, categoria = excluded.categoria, familia = excluded.familia,
    unidad = excluded.unidad, capacidad_ml = excluded.capacidad_ml, venta_directa = excluded.venta_directa,
    eventual = excluded.eventual, orden = excluded.orden, activo = excluded.activo;
  return public.salon_catalogo();
end $$;

create or replace function public.salon_trago_guardar(p_pin text, p_trago json) returns json
language plpgsql security definer set search_path = flama_salon as $$
declare v_id text; it json;
begin
  if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  v_id := coalesce(nullif(p_trago->>'id', ''), flama_salon.slug(p_trago->>'nombre'));
  if v_id = '' then raise exception 'NOMBRE_INVALIDO'; end if;
  insert into flama_salon.tragos (id, nombre, orden, activo)
  values (v_id, p_trago->>'nombre', coalesce((p_trago->>'orden')::int, 1000), coalesce((p_trago->>'activo')::boolean, true))
  on conflict (id) do update set nombre = excluded.nombre, orden = excluded.orden, activo = excluded.activo;
  if p_trago->'receta' is not null then
    delete from flama_salon.recetas where trago_id = v_id;
    for it in select * from json_array_elements(p_trago->'receta') loop
      if (it->>'cantidad')::numeric > 0 then
        insert into flama_salon.recetas (trago_id, bebida_id, cantidad) values (v_id, it->>'bebida_id', (it->>'cantidad')::numeric);
      end if;
    end loop;
  end if;
  return public.salon_catalogo();
end $$;

-- ---------- cierre del día ----------
create or replace function public.salon_cierre_get(p_fecha date) returns json
language sql security definer set search_path = flama_salon as $$
  select json_build_object(
    'fecha', p_fecha,
    'existe', exists (select 1 from flama_salon.cierres where fecha = p_fecha),
    'nota', (select nota from flama_salon.cierres where fecha = p_fecha),
    'actualizado', (select actualizado from flama_salon.cierres where fecha = p_fecha),
    'bebidas', coalesce((select json_agg(json_build_object('bebida_id', bebida_id, 'stock', stock, 'venta_directa', venta_directa,
                 'botellas_cerradas', botellas_cerradas, 'ml_abierta', ml_abierta)) from flama_salon.cierre_bebidas where fecha = p_fecha), '[]'::json),
    'tragos', coalesce((select json_agg(json_build_object('trago_id', trago_id, 'cantidad', cantidad)) from flama_salon.cierre_tragos where fecha = p_fecha), '[]'::json),
    'requiere_pin', p_fecha < flama_salon.hoy() - 1
  );
$$;

-- Guarda el cierre de un día. Días anteriores a ayer requieren PIN.
create or replace function public.salon_cierre_guardar(p_fecha date, p_nota text, p_bebidas json, p_tragos json, p_pin text default null) returns json
language plpgsql security definer set search_path = flama_salon as $$
declare it json; v_stock numeric; v_vd numeric; v_bot numeric; v_ml numeric;
begin
  if p_fecha > flama_salon.hoy() then raise exception 'FECHA_FUTURA'; end if;
  if p_fecha < flama_salon.hoy() - 1 then
    if p_pin is null or p_pin = '' then raise exception 'PIN_REQUERIDO'; end if;
    if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  end if;
  insert into flama_salon.cierres (fecha, nota, actualizado) values (p_fecha, nullif(trim(coalesce(p_nota, '')), ''), now())
  on conflict (fecha) do update set nota = excluded.nota, actualizado = now();
  for it in select * from json_array_elements(coalesce(p_bebidas, '[]'::json)) loop
    v_bot := nullif(it->>'botellas_cerradas', '')::numeric;
    v_ml := nullif(it->>'ml_abierta', '')::numeric;
    v_stock := flama_salon.stock_calc(it->>'bebida_id', nullif(it->>'stock', '')::numeric, v_bot, v_ml);
    v_vd := nullif(it->>'venta_directa', '')::numeric;
    if v_stock is null and v_vd is null then
      delete from flama_salon.cierre_bebidas where fecha = p_fecha and bebida_id = it->>'bebida_id';
    else
      insert into flama_salon.cierre_bebidas (fecha, bebida_id, stock, venta_directa, botellas_cerradas, ml_abierta)
      values (p_fecha, it->>'bebida_id', v_stock, v_vd, v_bot, v_ml)
      on conflict (fecha, bebida_id) do update set stock = excluded.stock, venta_directa = excluded.venta_directa,
        botellas_cerradas = excluded.botellas_cerradas, ml_abierta = excluded.ml_abierta;
    end if;
  end loop;
  for it in select * from json_array_elements(coalesce(p_tragos, '[]'::json)) loop
    if nullif(it->>'cantidad', '') is null then
      delete from flama_salon.cierre_tragos where fecha = p_fecha and trago_id = it->>'trago_id';
    else
      insert into flama_salon.cierre_tragos (fecha, trago_id, cantidad) values (p_fecha, it->>'trago_id', (it->>'cantidad')::numeric)
      on conflict (fecha, trago_id) do update set cantidad = excluded.cantidad;
    end if;
  end loop;
  return public.salon_cierre_get(p_fecha);
end $$;

-- ---------- ingresos ----------
create or replace function public.salon_ingresos_list(p_desde date default null, p_hasta date default null) returns json
language sql security definer set search_path = flama_salon as $$
  select coalesce((select json_agg(json_build_object('id', i.id, 'fecha', i.fecha, 'bebida_id', i.bebida_id, 'bebida', b.nombre,
      'unidad', b.unidad, 'cantidad', i.cantidad, 'observacion', i.observacion, 'creado', i.creado) order by i.fecha desc, i.id desc)
    from flama_salon.ingresos i join flama_salon.bebidas b on b.id = i.bebida_id
    where (p_desde is null or i.fecha >= p_desde) and (p_hasta is null or i.fecha <= p_hasta)), '[]'::json);
$$;

create or replace function public.salon_ingreso_agregar(p_fecha date, p_bebida_id text, p_cantidad numeric, p_observacion text default null) returns json
language plpgsql security definer set search_path = flama_salon as $$
begin
  if p_fecha > flama_salon.hoy() then raise exception 'FECHA_FUTURA'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  if not exists (select 1 from flama_salon.bebidas where id = p_bebida_id and activo) then raise exception 'BEBIDA_INEXISTENTE'; end if;
  insert into flama_salon.ingresos (fecha, bebida_id, cantidad, observacion) values (p_fecha, p_bebida_id, p_cantidad, nullif(trim(coalesce(p_observacion, '')), ''));
  return public.salon_ingresos_list(flama_salon.hoy() - 60, null);
end $$;

-- Bebida eventual: no está en la lista (error de compra, falta de stock del proveedor). Se da de alta y se registra el ingreso.
create or replace function public.salon_ingreso_eventual(p_fecha date, p_nombre text, p_unidad text, p_cantidad numeric, p_observacion text default null) returns json
language plpgsql security definer set search_path = flama_salon as $$
declare v_id text;
begin
  if p_unidad not in ('botella', 'lata', 'unidad') then raise exception 'UNIDAD_INVALIDA'; end if;
  v_id := flama_salon.slug(p_nombre);
  if v_id = '' then raise exception 'NOMBRE_INVALIDO'; end if;
  if exists (select 1 from flama_salon.bebidas where id = v_id and not eventual) then raise exception 'YA_EXISTE_EN_LISTA'; end if;
  insert into flama_salon.bebidas (id, nombre, categoria, familia, unidad, venta_directa, eventual, orden, activo)
  values (v_id, trim(p_nombre), 'Eventuales', null, p_unidad, true, true, 9000, true)
  on conflict (id) do update set activo = true, unidad = excluded.unidad;
  return public.salon_ingreso_agregar(p_fecha, v_id, p_cantidad, coalesce(p_observacion, 'Eventual'));
end $$;

create or replace function public.salon_ingreso_borrar(p_pin text, p_id bigint) returns json
language plpgsql security definer set search_path = flama_salon as $$
begin
  if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  delete from flama_salon.ingresos where id = p_id;
  return public.salon_ingresos_list(flama_salon.hoy() - 60, null);
end $$;

-- ---------- ajustes (PIN) ----------
create or replace function public.salon_ajustes_list() returns json
language sql security definer set search_path = flama_salon as $$
  select coalesce((select json_agg(json_build_object('id', a.id, 'fecha', a.fecha, 'bebida_id', a.bebida_id, 'bebida', b.nombre, 'unidad', b.unidad,
      'cantidad', a.cantidad, 'motivo', a.motivo) order by a.fecha desc, a.id desc)
    from flama_salon.ajustes a join flama_salon.bebidas b on b.id = a.bebida_id), '[]'::json);
$$;

create or replace function public.salon_ajuste_agregar(p_pin text, p_fecha date, p_bebida_id text, p_cantidad numeric, p_motivo text) returns json
language plpgsql security definer set search_path = flama_salon as $$
begin
  if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  if p_cantidad is null or p_cantidad = 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;
  insert into flama_salon.ajustes (fecha, bebida_id, cantidad, motivo) values (p_fecha, p_bebida_id, p_cantidad, trim(p_motivo));
  return public.salon_ajustes_list();
end $$;

create or replace function public.salon_ajuste_borrar(p_pin text, p_id bigint) returns json
language plpgsql security definer set search_path = flama_salon as $$
begin
  if not flama_salon.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  delete from flama_salon.ajustes where id = p_id;
  return public.salon_ajustes_list();
end $$;

-- ---------- ver stock: últimos N cierres ----------
create or replace function public.salon_stock_ver(p_n int default 7) returns json
language sql security definer set search_path = flama_salon as $$
  with fechas as (
    select f from (select distinct fecha f from flama_salon.cierre_bebidas where stock is not null order by f desc limit greatest(1, least(coalesce(p_n, 7), 31))) x
  )
  select json_build_object(
    'fechas', coalesce((select json_agg(f order by f desc) from fechas), '[]'::json),
    'bebidas', coalesce((select json_agg(json_build_object(
        'id', b.id, 'nombre', b.nombre, 'categoria', b.categoria, 'unidad', b.unidad, 'capacidad_ml', b.capacidad_ml, 'eventual', b.eventual,
        'stocks', coalesce((select json_object_agg(c.fecha, c.stock) from flama_salon.cierre_bebidas c
                            where c.bebida_id = b.id and c.stock is not null and c.fecha in (select f from fechas)), '{}'::json)
      ) order by b.orden, b.nombre) from flama_salon.bebidas b where b.activo), '[]'::json)
  );
$$;

-- ---------- control: teórico vs real, día por día y resumen del período ----------
-- Para cada cierre con stock: teórico = stock del cierre anterior + ingresos + ajustes − ventas directas − consumo por tragos,
-- sumando los movimientos entre el cierre anterior (exclusive) y este (inclusive). Descuadre = real − teórico.
create or replace function public.salon_control(p_desde date, p_hasta date) returns json
language sql security definer set search_path = flama_salon as $$
  with consumo as (
    select ct.fecha, r.bebida_id, sum(ct.cantidad * r.cantidad) as cantidad
    from flama_salon.cierre_tragos ct join flama_salon.recetas r on r.trago_id = ct.trago_id
    group by 1, 2
  ),
  mov as (
    select fecha, bebida_id, sum(ing) ing, sum(aj) aj, sum(ven) ven, sum(con) con from (
      select fecha, bebida_id, cantidad ing, 0 aj, 0 ven, 0 con from flama_salon.ingresos
      union all select fecha, bebida_id, 0, cantidad, 0, 0 from flama_salon.ajustes
      union all select fecha, bebida_id, 0, 0, coalesce(venta_directa, 0), 0 from flama_salon.cierre_bebidas
      union all select fecha, bebida_id, 0, 0, 0, cantidad from consumo
    ) x group by 1, 2
  ),
  reales as (
    select bebida_id, fecha, stock,
      lag(fecha) over (partition by bebida_id order by fecha) prev_fecha,
      lag(stock) over (partition by bebida_id order by fecha) prev_stock
    from flama_salon.cierre_bebidas where stock is not null
  ),
  dias as (
    select r.bebida_id, r.fecha, r.stock real, r.prev_fecha, r.prev_stock,
      coalesce((select sum(ing) from mov m where m.bebida_id = r.bebida_id and m.fecha > r.prev_fecha and m.fecha <= r.fecha), 0) ing,
      coalesce((select sum(aj)  from mov m where m.bebida_id = r.bebida_id and m.fecha > r.prev_fecha and m.fecha <= r.fecha), 0) aj,
      coalesce((select sum(ven) from mov m where m.bebida_id = r.bebida_id and m.fecha > r.prev_fecha and m.fecha <= r.fecha), 0) ven,
      coalesce((select sum(con) from mov m where m.bebida_id = r.bebida_id and m.fecha > r.prev_fecha and m.fecha <= r.fecha), 0) con
    from reales r
    where r.prev_fecha is not null and r.fecha between p_desde and p_hasta
  ),
  por_bebida as (
    select b.id, b.nombre, b.categoria, b.unidad, b.capacidad_ml, b.orden, b.eventual,
      (select json_agg(json_build_object('fecha', d.fecha, 'desde', d.prev_fecha, 'inicial', d.prev_stock, 'ingresos', d.ing, 'ajustes', d.aj,
          'ventas', d.ven, 'consumo', d.con, 'teorico', d.prev_stock + d.ing + d.aj - d.ven - d.con, 'real', d.real,
          'descuadre', d.real - (d.prev_stock + d.ing + d.aj - d.ven - d.con)) order by d.fecha)
       from dias d where d.bebida_id = b.id) as dias_json,
      (select json_build_object(
          'desde', min(d.prev_fecha), 'hasta', max(d.fecha),
          'inicial', (array_agg(d.prev_stock order by d.fecha))[1],
          'ingresos', sum(d.ing), 'ajustes', sum(d.aj), 'ventas', sum(d.ven), 'consumo', sum(d.con),
          'teorico', (array_agg(d.prev_stock order by d.fecha))[1] + sum(d.ing) + sum(d.aj) - sum(d.ven) - sum(d.con),
          'real', (array_agg(d.real order by d.fecha desc))[1],
          'descuadre', (array_agg(d.real order by d.fecha desc))[1] - ((array_agg(d.prev_stock order by d.fecha))[1] + sum(d.ing) + sum(d.aj) - sum(d.ven) - sum(d.con)),
          'dias', count(*))
       from dias d where d.bebida_id = b.id) as resumen
    from flama_salon.bebidas b where b.activo
  )
  select json_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'hoy', flama_salon.hoy(),
    'bebidas', coalesce((select json_agg(json_build_object('id', id, 'nombre', nombre, 'categoria', categoria, 'unidad', unidad,
        'capacidad_ml', capacidad_ml, 'eventual', eventual, 'resumen', resumen, 'dias', coalesce(dias_json, '[]'::json)) order by orden, nombre)
      from por_bebida), '[]'::json)
  );
$$;

-- ---------- permisos ----------
revoke all on function flama_salon.pin_ok(text) from public, anon, authenticated;
grant execute on function
  public.salon_pin_estado(), public.salon_pin_set(text, text),
  public.salon_catalogo(), public.salon_bebida_guardar(text, json), public.salon_trago_guardar(text, json),
  public.salon_cierre_get(date), public.salon_cierre_guardar(date, text, json, json, text),
  public.salon_ingresos_list(date, date), public.salon_ingreso_agregar(date, text, numeric, text),
  public.salon_ingreso_eventual(date, text, text, numeric, text), public.salon_ingreso_borrar(text, bigint),
  public.salon_ajustes_list(), public.salon_ajuste_agregar(text, date, text, numeric, text), public.salon_ajuste_borrar(text, bigint),
  public.salon_stock_ver(int), public.salon_control(date, date)
to anon, authenticated;

-- ---------- utensilios (conteo aparte, jueves / sábado / lunes) ----------
-- Tablas utensilios, ut_conteos, ut_novedades y funciones salon_ut_*: ver migración flama_salon_utensilios.
-- Resumen por utensilio: diferencia = último conteo − stock inicial; justificado = incorporaciones − bajas desde la fecha inicial;
-- sin justificar = diferencia − justificado. El primer conteo de un utensilio sin inicial lo define. salon_ut_nuevo_periodo
-- (PIN) pasa el inicial al último conteo sin borrar el historial.

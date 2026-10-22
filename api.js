/* FLAMA · Salón — acceso a Supabase sin librerías: llamadas RPC a las funciones salon_*.
 * Ninguna tabla se lee ni escribe directo; todo pasa por las funciones de la base. */
(function () {
  'use strict';
  const cfg = window.FLAMA_CONFIG || {};

  async function rpc(fn, params) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': cfg.supabaseAnonKey,
        'Authorization': `Bearer ${cfg.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(params || {})
    });
    let body = null;
    try { body = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) {
      const msg = (body && (body.message || body.error || body.hint)) || `HTTP ${r.status}`;
      const err = new Error(msg);
      const m = /^([A-Z_]+)$/.exec(String(msg).trim());
      err.code = m ? m[1] : 'ERROR';
      throw err;
    }
    return body;
  }

  // PIN de administración: se guarda solo en esta pestaña; la base lo verifica en cada uso.
  const pin = {
    get: () => { try { return sessionStorage.getItem('salon_pin') || ''; } catch (_) { return ''; } },
    set: (v) => { try { sessionStorage.setItem('salon_pin', v); } catch (_) { /* sin storage */ } },
    clear: () => { try { sessionStorage.removeItem('salon_pin'); } catch (_) { /* sin storage */ } }
  };

  window.SALON_API = {
    pin,
    pinEstado: () => rpc('salon_pin_estado'),
    pinSet: (actual, nuevo) => rpc('salon_pin_set', { p_actual: actual || null, p_nuevo: nuevo }),
    catalogo: () => rpc('salon_catalogo'),
    bebidaGuardar: (p, bebida) => rpc('salon_bebida_guardar', { p_pin: p, p_bebida: bebida }),
    tragoGuardar: (p, trago) => rpc('salon_trago_guardar', { p_pin: p, p_trago: trago }),
    cierreGet: (fecha) => rpc('salon_cierre_get', { p_fecha: fecha }),
    cierreGuardar: (fecha, nota, bebidas, tragos, p) => rpc('salon_cierre_guardar', { p_fecha: fecha, p_nota: nota, p_bebidas: bebidas, p_tragos: tragos, p_pin: p || null }),
    ingresosList: (desde, hasta) => rpc('salon_ingresos_list', { p_desde: desde || null, p_hasta: hasta || null }),
    ingresoAgregar: (fecha, bebidaId, cantidad, obs) => rpc('salon_ingreso_agregar', { p_fecha: fecha, p_bebida_id: bebidaId, p_cantidad: cantidad, p_observacion: obs || null }),
    ingresoEventual: (fecha, nombre, unidad, cantidad, obs) => rpc('salon_ingreso_eventual', { p_fecha: fecha, p_nombre: nombre, p_unidad: unidad, p_cantidad: cantidad, p_observacion: obs || null }),
    ingresoBorrar: (p, id) => rpc('salon_ingreso_borrar', { p_pin: p, p_id: id }),
    ajustesList: () => rpc('salon_ajustes_list'),
    ajusteAgregar: (p, fecha, bebidaId, cantidad, motivo) => rpc('salon_ajuste_agregar', { p_pin: p, p_fecha: fecha, p_bebida_id: bebidaId, p_cantidad: cantidad, p_motivo: motivo }),
    ajusteBorrar: (p, id) => rpc('salon_ajuste_borrar', { p_pin: p, p_id: id }),
    stockVer: (n) => rpc('salon_stock_ver', { p_n: n || 7 }),
    utGet: (n) => rpc('salon_ut_get', { p_n: n || 8 }),
    utConteoGet: (fecha) => rpc('salon_ut_conteo_get', { p_fecha: fecha }),
    utConteoGuardar: (fecha, items, p) => rpc('salon_ut_conteo_guardar', { p_fecha: fecha, p_items: items, p_pin: p || null }),
    utNovedadAgregar: (fecha, utId, tipo, cantidad, motivo) => rpc('salon_ut_novedad_agregar', { p_fecha: fecha, p_utensilio_id: utId, p_tipo: tipo, p_cantidad: cantidad, p_motivo: motivo }),
    utNovedadBorrar: (p, id) => rpc('salon_ut_novedad_borrar', { p_pin: p, p_id: id }),
    utGuardar: (p, ut) => rpc('salon_ut_guardar', { p_pin: p, p_ut: ut }),
    utNuevoPeriodo: (p) => rpc('salon_ut_nuevo_periodo', { p_pin: p }),
    control: (desde, hasta) => rpc('salon_control', { p_desde: desde, p_hasta: hasta }),
    ventasSubir: (fecha, resumen, items, archivo) => rpc('ventas_subir', { p_fecha: fecha, p_resumen: resumen, p_items: items, p_archivo: archivo || null }),
    ventasDiaGet: (fecha) => rpc('ventas_dia_get', { p_fecha: fecha }),
    ventasRango: (desde, hasta) => rpc('ventas_rango', { p_desde: desde, p_hasta: hasta }),
    ventasMapGet: () => rpc('ventas_map_get'),
    ventasMapSet: (p, producto, tipo, destino, nota) => rpc('ventas_map_set', { p_pin: p, p_producto: producto, p_tipo: tipo, p_destino: destino || null, p_nota: nota || null }),
    ventasFaltantes: (dias) => rpc('ventas_faltantes', { p_dias: dias || 7 })
  };
})();

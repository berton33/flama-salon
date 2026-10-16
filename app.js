/* FLAMA · Salón — control de bebidas.
 * Catálogo, cierres, ingresos y control viven en Supabase (api.js). Este archivo solo muestra y carga.
 */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const topbarSub = document.getElementById('topbar-sub');
  const API = window.SALON_API;
  let CAT = null; // catálogo: bebidas y tragos

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => { const r = Math.round(Number(n) * 10) / 10; return r.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }); };
  const num = (v) => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return isFinite(n) ? n : null; };
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const fechaLarga = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }); };
  const fechaCorta = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }); };

  const errorMsg = (e) => {
    const c = e && e.code;
    if (c === 'PIN_INCORRECTO') return 'PIN incorrecto.';
    if (c === 'PIN_REQUERIDO') return 'Para cargar un día anterior a ayer hace falta el PIN.';
    if (c === 'PIN_INVALIDO') return 'El PIN tiene que tener entre 4 y 32 caracteres.';
    if (c === 'FECHA_FUTURA') return 'No se puede cargar una fecha futura.';
    if (c === 'CANTIDAD_INVALIDA') return 'Cantidad inválida.';
    if (c === 'YA_EXISTE_EN_LISTA') return 'Esa bebida ya está en la lista: cargala como ingreso normal.';
    if (c === 'NOMBRE_INVALIDO') return 'Falta el nombre.';
    if (c === 'MOTIVO_REQUERIDO') return 'Falta el motivo.';
    return `No se pudo conectar con la base (${esc(e && e.message)}).`;
  };

  // Fracciones de botella abierta para destilados (valor × capacidad = ml).
  const FRACS = [{ v: 0, t: 'vacía' }, { v: 0.25, t: '¼' }, { v: 1 / 3, t: '⅓' }, { v: 0.5, t: '½' }, { v: 2 / 3, t: '⅔' }, { v: 0.75, t: '¾' }, { v: 1, t: 'llena' }];

  const bebida = (id) => (CAT.bebidas || []).find((b) => b.id === id);
  const trago = (id) => (CAT.tragos || []).find((t) => t.id === id);
  const bebidasActivas = () => (CAT.bebidas || []).filter((b) => b.activo);
  const tragosActivos = () => (CAT.tragos || []).filter((t) => t.activo);
  const esDestilado = (b) => b.unidad === 'ml';
  const groupBy = (list, key) => { const out = []; for (const i of list) { let g = out.find((x) => x.key === i[key]); if (!g) { g = { key: i[key], items: [] }; out.push(g); } g.items.push(i); } return out; };
  const unidadLabel = (b) => esDestilado(b) ? `ml · botella de ${fmt(b.capacidad_ml)} ml` : b.unidad;
  const stockLabel = (b, v) => v == null ? '—' : esDestilado(b) && b.capacidad_ml ? `${fmt(v)} ml <span class="u">≈ ${fmt(v / b.capacidad_ml)} bot</span>` : fmt(v);

  // Presentaciones hermanas (misma familia): aviso para no confundir botella con lata.
  const hermanas = (b) => b.familia ? bebidasActivas().filter((x) => x.familia === b.familia && x.id !== b.id) : [];

  // ---------- rutas ----------
  function parseHash() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [section, id] = h.split('/');
    return { section: section || '', id: id || null };
  }

  function route() {
    if (!CAT) return;
    const { section, id } = parseHash();
    window.scrollTo(0, 0);
    switch (section) {
      case '': topbarSub.textContent = 'Salón'; return renderInicio();
      case 'cierre': topbarSub.textContent = 'Cierre del día'; return renderCierre(id);
      case 'ingresos': topbarSub.textContent = 'Ingresos'; return renderIngresos();
      case 'stock': topbarSub.textContent = 'Ver stock'; return renderStock();
      case 'control': topbarSub.textContent = 'Control'; return renderControl();
      case 'utensilios': topbarSub.textContent = 'Utensilios'; return renderUtensilios(id || 'conteo');
      case 'caja': topbarSub.textContent = 'Caja'; return renderCaja();
      case 'ajustes': topbarSub.textContent = 'Ajustes'; return renderAjustes();
      default: location.hash = '#/';
    }
  }

  // ---------- inicio ----------
  function renderInicio() {
    app.innerHTML = `<div class="home">
      <a href="#/cierre">Cierre del día</a>
      <a href="#/ingresos">Ingresos</a>
      <a href="#/stock">Ver stock</a>
      <a href="#/control">Control</a>
      <a href="#/utensilios">Utensilios</a>
      <a href="#/caja">Caja</a>
      <a href="#/ajustes">Ajustes</a>
    </div>`;
  }

  // ---------- selector de bebida (lista grande, con búsqueda) ----------
  function pickerHtml(uid, soloActivas = true) {
    const list = soloActivas ? bebidasActivas() : CAT.bebidas;
    return `<div class="picker" id="${uid}">
      <input type="text" class="picker-q" placeholder="Buscar bebida…" autocomplete="off">
      <div class="picker-list">` + list.map((b) => `<button type="button" class="picker-item" data-id="${esc(b.id)}">${esc(b.nombre)}<span>${esc(b.unidad)}</span></button>`).join('') + `</div>
      <div class="picker-sel" hidden></div>
    </div>`;
  }
  function wirePicker(uid, onSelect) {
    const root = document.getElementById(uid);
    const q = root.querySelector('.picker-q'), list = root.querySelector('.picker-list'), sel = root.querySelector('.picker-sel');
    let current = null;
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase();
      root.querySelectorAll('.picker-item').forEach((el) => { el.hidden = t !== '' && !el.textContent.toLowerCase().includes(t); });
      list.hidden = false;
    });
    root.querySelectorAll('.picker-item').forEach((el) => el.addEventListener('click', () => {
      current = bebida(el.dataset.id);
      sel.hidden = false; list.hidden = true; q.hidden = true;
      sel.innerHTML = `<div class="picker-chosen"><b>${esc(current.nombre)}</b><span>${esc(unidadLabel(current))}</span><button type="button" class="link-btn">Cambiar</button></div>`;
      sel.querySelector('.link-btn').addEventListener('click', () => { current = null; sel.hidden = true; list.hidden = false; q.hidden = false; q.value = ''; q.dispatchEvent(new Event('input')); onSelect(null); });
      onSelect(current);
    }));
    return { get: () => current };
  }

  // ---------- cierre del día ----------
  async function renderCierre(fechaParam) {
    const fecha0 = fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : hoyISO();
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Cierre del día</h1>
      <div class="card">
        <label class="field"><span>Fecha</span><input id="fecha" type="date" value="${fecha0}" max="${hoyISO()}"></label>
        <div id="cierre-info" class="lede" style="margin:0"></div>
        <div id="pin-wrap" hidden><label class="field"><span>PIN (día anterior a ayer)</span><input id="pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label></div>
      </div>
      <p class="lede">Contar siempre al cierre. STOCK es lo que quedó; VENTA es lo vendido solo, sin trago. Lo que quede vacío no se guarda.</p>`;
    for (const g of groupBy(bebidasActivas(), 'categoria')) {
      html += `<h2>${esc(g.key)}</h2><div class="card">` + g.items.map((b) => esDestilado(b) ? `
        <div class="crow" data-id="${esc(b.id)}" data-tipo="ml">
          <div class="name">${esc(b.nombre)}<span class="sub">se cuenta en ml · botella de ${fmt(b.capacidad_ml)} ml</span></div>
          <div class="inputs">
            <label><span>Bot. cerradas</span><input type="text" inputmode="decimal" autocomplete="off" data-f="botellas"></label>
            <div><span class="flabel">Botella abierta</span><div class="fracs" data-fracs>${FRACS.map((f) => `<button type="button" data-frac="${f.v}">${f.t}</button>`).join('')}</div><input type="hidden" data-f="ml"></div>
          </div>
          <div class="calc" data-calc></div>
        </div>` : `
        <div class="crow" data-id="${esc(b.id)}" data-tipo="u">
          <div class="name">${esc(b.nombre)}<span class="sub">${esc(b.unidad)}${b.eventual ? ' · eventual' : ''}</span></div>
          <div class="inputs">
            <label><span>Stock</span><input type="text" inputmode="decimal" autocomplete="off" data-f="stock"></label>
            ${b.venta_directa ? `<label><span>Venta</span><input type="text" inputmode="decimal" autocomplete="off" data-f="venta"></label>` : `<div></div>`}
          </div>
        </div>`).join('') + `</div>`;
    }
    html += `<h2>Tragos vendidos</h2><p class="lede">Cantidad de cada trago según el sistema. Descuenta solo el destilado y el mixer.</p><div class="card">` +
      tragosActivos().map((t) => `
        <div class="crow" data-trago="${esc(t.id)}">
          <div class="name">${esc(t.nombre)}<span class="sub">${t.receta.map((r) => { const b = bebida(r.bebida_id); return b ? `${fmt(r.cantidad)} ${esDestilado(b) ? 'ml' : b.unidad} ${b.nombre}` : ''; }).filter(Boolean).join(' + ')}</span></div>
          <div class="inputs one"><label><span>Vendidos</span><input type="text" inputmode="numeric" autocomplete="off" data-f="trago"></label></div>
        </div>`).join('') + `</div>`;
    html += `<div class="card">
      <label class="field"><span>Nota del día</span><textarea id="nota" placeholder="Opcional: roturas, invitaciones, lo que haya que aclarar"></textarea></label>
      <div id="cierre-status"></div>
      <button class="btn" id="guardar">Guardar cierre</button>
    </div>`;
    app.innerHTML = html;

    const fechaEl = document.getElementById('fecha');
    const status = document.getElementById('cierre-status');
    const pinWrap = document.getElementById('pin-wrap');
    const rows = Array.from(app.querySelectorAll('.crow[data-id]'));
    const trows = Array.from(app.querySelectorAll('.crow[data-trago]'));

    rows.filter((r) => r.dataset.tipo === 'ml').forEach((r) => {
      const b = bebida(r.dataset.id);
      const mlEl = r.querySelector('[data-f=ml]');
      const recalc = () => {
        const bot = num(r.querySelector('[data-f=botellas]').value), ml = num(mlEl.value);
        r.querySelector('[data-calc]').textContent = (bot == null && ml == null) ? '' : `Total: ${fmt((bot || 0) * b.capacidad_ml + (ml || 0))} ml`;
      };
      // Fracción de la botella abierta: se guarda en ml (fracción × capacidad). Tocar la misma fracción la deselecciona.
      const setFrac = (v) => {
        r.querySelectorAll('[data-frac]').forEach((btn) => btn.classList.toggle('on', v != null && Math.abs(Number(btn.dataset.frac) - v) < 1e-6));
        mlEl.value = v == null ? '' : String(Math.round(v * b.capacidad_ml * 10) / 10);
        recalc();
      };
      r.querySelectorAll('[data-frac]').forEach((btn) => btn.addEventListener('click', () => {
        const v = Number(btn.dataset.frac);
        setFrac(btn.classList.contains('on') ? null : v);
      }));
      r._setMl = (ml) => setFrac(ml == null ? null : ml / b.capacidad_ml);
      r.querySelector('[data-f=botellas]').addEventListener('input', recalc);
    });

    async function cargarFecha() {
      const f = fechaEl.value;
      if (!f) return;
      status.innerHTML = '';
      try {
        const c = await API.cierreGet(f);
        pinWrap.hidden = !c.requiere_pin;
        rows.forEach((r) => {
          const it = (c.bebidas || []).find((x) => x.bebida_id === r.dataset.id);
          if (r.dataset.tipo === 'ml') {
            r.querySelector('[data-f=botellas]').value = it && it.botellas_cerradas != null ? String(it.botellas_cerradas).replace('.', ',') : '';
            r._setMl(it && it.ml_abierta != null ? Number(it.ml_abierta) : null);
          } else {
            r.querySelector('[data-f=stock]').value = it && it.stock != null ? String(it.stock).replace('.', ',') : '';
            const v = r.querySelector('[data-f=venta]'); if (v) v.value = it && it.venta_directa != null ? String(it.venta_directa).replace('.', ',') : '';
          }
        });
        trows.forEach((r) => { const it = (c.tragos || []).find((x) => x.trago_id === r.dataset.trago); r.querySelector('input').value = it ? String(it.cantidad) : ''; });
        document.getElementById('nota').value = c.nota || '';
        document.getElementById('cierre-info').textContent = c.existe ? `Cierre de ${fechaLarga(f)} ya cargado. Podés corregirlo y volver a guardar.` : `${fechaLarga(f)}: sin cierre cargado.`;
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    }
    fechaEl.addEventListener('change', cargarFecha);
    await cargarFecha();

    document.getElementById('guardar').addEventListener('click', async () => {
      const f = fechaEl.value;
      if (!f) { status.innerHTML = `<div class="status err">Elegí la fecha.</div>`; return; }
      const bebidas = [], tragos = [];
      for (const r of rows) {
        const b = bebida(r.dataset.id);
        if (r.dataset.tipo === 'ml') {
          const bot = r.querySelector('[data-f=botellas]').value.trim(), ml = r.querySelector('[data-f=ml]').value.trim();
          if ((bot && num(bot) == null) || (ml && num(ml) == null)) { status.innerHTML = `<div class="status err">Valor inválido en ${esc(b.nombre)}.</div>`; return; }
          bebidas.push({ bebida_id: b.id, botellas_cerradas: bot ? num(bot) : null, ml_abierta: ml ? num(ml) : null, stock: null, venta_directa: null });
        } else {
          const s = r.querySelector('[data-f=stock]').value.trim(); const vEl = r.querySelector('[data-f=venta]'); const v = vEl ? vEl.value.trim() : '';
          if ((s && num(s) == null) || (v && num(v) == null)) { status.innerHTML = `<div class="status err">Valor inválido en ${esc(b.nombre)}.</div>`; return; }
          bebidas.push({ bebida_id: b.id, stock: s ? num(s) : null, venta_directa: v ? num(v) : null, botellas_cerradas: null, ml_abierta: null });
        }
      }
      for (const r of trows) {
        const v = r.querySelector('input').value.trim();
        if (v && (num(v) == null || num(v) < 0)) { status.innerHTML = `<div class="status err">Cantidad inválida en ${esc(trago(r.dataset.trago).nombre)}.</div>`; return; }
        tragos.push({ trago_id: r.dataset.trago, cantidad: v ? num(v) : null });
      }
      const p = pinWrap.hidden ? null : document.getElementById('pin').value.trim();
      const btn = document.getElementById('guardar'); btn.disabled = true; status.innerHTML = '';
      try {
        await API.cierreGuardar(f, document.getElementById('nota').value, bebidas, tragos, p);
        if (p) API.pin.set(p);
        status.innerHTML = `<div class="status ok">Cierre de ${esc(fechaLarga(f))} guardado.</div>`;
        document.getElementById('cierre-info').textContent = `Cierre de ${fechaLarga(f)} ya cargado. Podés corregirlo y volver a guardar.`;
      } catch (e) {
        if (e.code === 'PIN_REQUERIDO') pinWrap.hidden = false;
        if (e.code === 'PIN_INCORRECTO') API.pin.clear();
        status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  // ---------- ingresos ----------
  async function renderIngresos() {
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Ingresos</h1>
      <p class="lede">Cada entrada de mercadería se carga acá, en la misma unidad que el stock.</p>
      <div class="card">
        <div class="btnrow"><button type="button" class="btn secondary small on" id="modo-lista">De la lista</button><button type="button" class="btn secondary small" id="modo-eventual">Eventual</button></div>
        <label class="field"><span>Fecha</span><input id="ing-fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
        <div id="modo-lista-box">
          <div class="field"><span>Bebida</span>${pickerHtml('ing-picker')}</div>
          <div id="ing-alerta"></div>
          <label class="field" id="ing-cant-wrap"><span id="ing-cant-label">Cantidad</span><input id="ing-cant" type="text" inputmode="decimal" autocomplete="off"></label>
          <div id="ing-calc" class="lede"></div>
        </div>
        <div id="modo-eventual-box" hidden>
          <div class="warn"><span class="k">Bebida eventual</span>Solo para una bebida que no está en la lista: error de compra o reemplazo del proveedor. Queda dada de alta como eventual y aparece en el cierre hasta que se desactive en Ajustes.</div>
          <label class="field"><span>Nombre</span><input id="ev-nombre" type="text" autocomplete="off" placeholder="Ej.: Coca Cola Original lata 210"></label>
          <div class="field"><span>Unidad</span><div class="btnrow three" id="ev-unidad"><button type="button" class="btn secondary small on" data-u="botella">Botella</button><button type="button" class="btn secondary small" data-u="lata">Lata</button><button type="button" class="btn secondary small" data-u="unidad">Unidad</button></div></div>
          <label class="field"><span>Cantidad</span><input id="ev-cant" type="text" inputmode="decimal" autocomplete="off"></label>
        </div>
        <label class="field"><span>Observación</span><input id="ing-obs" type="text" autocomplete="off" placeholder="Opcional"></label>
        <div id="ing-status"></div>
        <button class="btn" id="ing-guardar">Agregar ingreso</button>
      </div>
      <h2>Últimos ingresos</h2><div id="ing-list" class="card"><p class="msg">Cargando…</p></div>`;
    app.innerHTML = html;

    let modo = 'lista', evUnidad = 'botella', sel = null;
    const status = document.getElementById('ing-status');
    const cantEl = document.getElementById('ing-cant');
    const calc = document.getElementById('ing-calc');
    document.getElementById('modo-lista').addEventListener('click', () => { modo = 'lista'; document.getElementById('modo-lista-box').hidden = false; document.getElementById('modo-eventual-box').hidden = true; document.getElementById('modo-lista').classList.add('on'); document.getElementById('modo-eventual').classList.remove('on'); });
    document.getElementById('modo-eventual').addEventListener('click', () => { modo = 'eventual'; document.getElementById('modo-lista-box').hidden = true; document.getElementById('modo-eventual-box').hidden = false; document.getElementById('modo-eventual').classList.add('on'); document.getElementById('modo-lista').classList.remove('on'); });
    document.querySelectorAll('#ev-unidad button').forEach((b) => b.addEventListener('click', () => { evUnidad = b.dataset.u; document.querySelectorAll('#ev-unidad button').forEach((x) => x.classList.toggle('on', x === b)); }));

    const picker = wirePicker('ing-picker', (b) => {
      sel = b; calc.textContent = ''; document.getElementById('ing-alerta').innerHTML = '';
      if (!b) return;
      document.getElementById('ing-cant-label').textContent = esDestilado(b) ? `Botellas (de ${fmt(b.capacidad_ml)} ml)` : `Cantidad (${b.unidad})`;
      const h = hermanas(b);
      if (h.length) document.getElementById('ing-alerta').innerHTML = `<div class="warn"><span class="k">Atención: hay ${h.length + 1} presentaciones de ${esc(b.familia)}</span>Elegiste <b>${esc(b.nombre)}</b>. Las otras son: ${h.map((x) => esc(x.nombre)).join(', ')}. Confirmá que es la correcta antes de guardar.</div>`;
      cantEl.focus();
    });
    cantEl.addEventListener('input', () => { if (sel && esDestilado(sel)) { const n = num(cantEl.value); calc.textContent = n != null ? `Se registran ${fmt(n * sel.capacidad_ml)} ml` : ''; } });

    const paintList = (items) => {
      const box = document.getElementById('ing-list');
      if (!items.length) { box.innerHTML = `<p class="msg" style="padding:12px 0">Sin ingresos en los últimos 60 días.</p>`; return; }
      box.innerHTML = `<table><tbody>` + items.map((i) => { const b = bebida(i.bebida_id); return `
        <tr data-id="${i.id}"><td><b>${esc(i.bebida)}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${esc(fechaCorta(i.fecha))}${i.observacion ? ` · ${esc(i.observacion)}` : ''}</span></td>
        <td class="q">${b ? stockLabel(b, i.cantidad) : fmt(i.cantidad)}<span class="u"> ${esc(i.unidad)}</span></td>
        <td style="width:40px;text-align:right"><button type="button" class="link-btn del" data-id="${i.id}" aria-label="Borrar">✕</button></td></tr>`; }).join('') + `</tbody></table><div id="del-box"></div>`;
      box.querySelectorAll('.del').forEach((btn) => btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        document.getElementById('del-box').innerHTML = `<div class="warn"><span class="k">Borrar ingreso (requiere PIN)</span>
          <label class="field"><span>PIN</span><input id="del-pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label>
          <div class="btnrow"><button type="button" class="btn small" id="del-ok">Borrar</button><button type="button" class="btn secondary small" id="del-no">Cancelar</button></div><div id="del-status"></div></div>`;
        document.getElementById('del-no').addEventListener('click', () => { document.getElementById('del-box').innerHTML = ''; });
        document.getElementById('del-ok').addEventListener('click', async () => {
          const p = document.getElementById('del-pin').value.trim();
          try { const list = await API.ingresoBorrar(p, id); API.pin.set(p); paintList(list); }
          catch (e) { if (e.code === 'PIN_INCORRECTO') API.pin.clear(); document.getElementById('del-status').innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
        });
      }));
    };
    try { paintList(await API.ingresosList(addDias(hoyISO(), -60), null)); } catch (e) { document.getElementById('ing-list').innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }

    document.getElementById('ing-guardar').addEventListener('click', async () => {
      const f = document.getElementById('ing-fecha').value, obs = document.getElementById('ing-obs').value;
      const btn = document.getElementById('ing-guardar'); status.innerHTML = '';
      try {
        let list;
        if (modo === 'lista') {
          const b = picker.get(); const n = num(cantEl.value);
          if (!b) { status.innerHTML = `<div class="status err">Elegí la bebida.</div>`; return; }
          if (n == null || n <= 0) { status.innerHTML = `<div class="status err">Ingresá la cantidad.</div>`; return; }
          btn.disabled = true;
          list = await API.ingresoAgregar(f, b.id, esDestilado(b) ? n * b.capacidad_ml : n, obs);
          status.innerHTML = `<div class="status ok">Ingreso guardado: ${esc(b.nombre)}, ${esDestilado(b) ? `${fmt(n)} botellas (${fmt(n * b.capacidad_ml)} ml)` : `${fmt(n)} ${esc(b.unidad)}`}.</div>`;
          cantEl.value = ''; calc.textContent = '';
        } else {
          const nombre = document.getElementById('ev-nombre').value.trim(); const n = num(document.getElementById('ev-cant').value);
          if (!nombre) { status.innerHTML = `<div class="status err">Ingresá el nombre.</div>`; return; }
          if (n == null || n <= 0) { status.innerHTML = `<div class="status err">Ingresá la cantidad.</div>`; return; }
          btn.disabled = true;
          list = await API.ingresoEventual(f, nombre, evUnidad, n, obs);
          CAT = await API.catalogo();
          status.innerHTML = `<div class="status ok">Bebida eventual "${esc(nombre)}" dada de alta con ${fmt(n)} ${esc(evUnidad)}. Ya aparece en el cierre.</div>`;
          document.getElementById('ev-nombre').value = ''; document.getElementById('ev-cant').value = '';
        }
        document.getElementById('ing-obs').value = '';
        paintList(list);
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
      finally { btn.disabled = false; }
    });
  }

  // ---------- ver stock ----------
  async function renderStock() {
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Ver stock</h1><p class="msg">Cargando…</p>`;
    let s;
    try { s = await API.stockVer(7); } catch (e) { app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Ver stock</h1><div class="status err">${errorMsg(e)}</div>`; return; }
    const fechas = s.fechas || [];
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Ver stock</h1>`;
    if (!fechas.length) { app.innerHTML = html + `<div class="card"><p class="msg" style="padding:12px 0">Todavía no hay cierres cargados.</p></div>`; return; }
    html += `<p class="lede">Último cierre: <b>${esc(fechaLarga(fechas[0]))}</b>. Columnas: últimos ${fechas.length} cierres, del más reciente al más viejo. Destilados en ml.</p>`;
    for (const g of groupBy(s.bebidas, 'categoria')) {
      html += `<h2>${esc(g.key)}</h2><div class="card"><div class="scrollx"><table class="hist"><thead><tr><th>Bebida</th>` +
        fechas.map((f) => `<th class="q">${esc(fechaCorta(f))}</th>`).join('') + `</tr></thead><tbody>` +
        g.items.map((b) => `<tr><td><b>${esc(b.nombre)}</b><br><span class="sub">${esc(b.unidad)}</span></td>` +
          fechas.map((f, idx) => `<td class="q ${idx === 0 ? 'ult' : ''}">${b.stocks[f] != null ? (esDestilado(b) && b.capacidad_ml ? `${fmt(b.stocks[f])}<br><span class="sub">≈ ${fmt(b.stocks[f] / b.capacidad_ml)} bot</span>` : fmt(b.stocks[f])) : '<span class="dash">—</span>'}</td>`).join('') + `</tr>`).join('') +
        `</tbody></table></div></div>`;
    }
    app.innerHTML = html;
  }

  // ---------- control ----------
  async function renderControl() {
    const hasta0 = hoyISO(), desde0 = addDias(hasta0, -30);
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Control</h1>
      <p class="lede">Compara el stock que debería haber contra el que se contó. Para cada cierre: stock del cierre anterior + ingresos + ajustes − ventas directas − consumo por tragos. Descuadre negativo: falta mercadería.</p>
      <div class="card"><div class="btnrow">
        <label class="field" style="margin:0"><span>Desde</span><input id="c-desde" type="date" value="${desde0}"></label>
        <label class="field" style="margin:0"><span>Hasta</span><input id="c-hasta" type="date" value="${hasta0}" max="${hasta0}"></label>
      </div></div>
      <div id="c-body"><p class="msg">Cargando…</p></div>`;
    const body = document.getElementById('c-body');
    async function load() {
      const desde = document.getElementById('c-desde').value, hasta = document.getElementById('c-hasta').value;
      if (!desde || !hasta) return;
      body.innerHTML = `<p class="msg">Calculando…</p>`;
      let c;
      try { c = await API.control(desde, hasta); } catch (e) { body.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; return; }
      const con = c.bebidas.filter((b) => b.resumen && b.resumen.dias > 0);
      if (!con.length) { body.innerHTML = `<div class="card"><p class="msg" style="padding:12px 0">No hay cierres con stock en ese período.</p></div>`; return; }
      const faltan = con.filter((b) => Number(b.resumen.descuadre) < 0).length;
      let html = `<p class="lede"><b>${con.length}</b> bebidas con cierres en el período · <b>${faltan}</b> con faltante. Tocá una fila para ver el detalle día por día.</p>`;
      for (const g of groupBy(con, 'categoria')) {
        html += `<h2>${esc(g.key)}</h2><div class="card"><div class="scrollx"><table class="ctl"><thead><tr><th>Bebida</th><th class="q">Inicial</th><th class="q">Ingr.</th><th class="q">Venta</th><th class="q">Tragos</th><th class="q">Teórico</th><th class="q">Real</th><th class="q">Desc.</th></tr></thead><tbody>` +
          g.items.map((b) => { const r = b.resumen; const d = Number(r.descuadre); const cls = d < 0 ? 'neg' : d > 0 ? 'pos' : 'ok';
            return `<tr class="sum ${cls}" data-id="${esc(b.id)}"><td><b>${esc(b.nombre)}</b><br><span class="sub">${esc(b.unidad)} · ${esc(fechaCorta(r.desde))} → ${esc(fechaCorta(r.hasta))}</span></td>
              <td class="q">${fmt(r.inicial)}</td><td class="q">${fmt(r.ingresos)}${Number(r.ajustes) ? `<br><span class="sub">aj. ${fmt(r.ajustes)}</span>` : ''}</td><td class="q">${fmt(r.ventas)}</td><td class="q">${fmt(r.consumo)}</td><td class="q">${fmt(r.teorico)}</td><td class="q">${fmt(r.real)}</td><td class="q desc">${d > 0 ? '+' : ''}${fmt(d)}</td></tr>
              <tr class="det" data-for="${esc(b.id)}" hidden><td colspan="8"><table class="ctl inner"><thead><tr><th>Cierre</th><th class="q">Inicial</th><th class="q">Ingr.</th><th class="q">Venta</th><th class="q">Tragos</th><th class="q">Teórico</th><th class="q">Real</th><th class="q">Desc.</th></tr></thead><tbody>` +
              b.dias.map((x) => { const dd = Number(x.descuadre); return `<tr class="${dd < 0 ? 'neg' : dd > 0 ? 'pos' : 'ok'}"><td>${esc(fechaCorta(x.fecha))}<br><span class="sub">desde ${esc(fechaCorta(x.desde))}</span></td><td class="q">${fmt(x.inicial)}</td><td class="q">${fmt(x.ingresos)}${Number(x.ajustes) ? `<br><span class="sub">aj. ${fmt(x.ajustes)}</span>` : ''}</td><td class="q">${fmt(x.ventas)}</td><td class="q">${fmt(x.consumo)}</td><td class="q">${fmt(x.teorico)}</td><td class="q">${fmt(x.real)}</td><td class="q desc">${dd > 0 ? '+' : ''}${fmt(dd)}</td></tr>`; }).join('') +
              `</tbody></table></td></tr>`; }).join('') + `</tbody></table></div></div>`;
      }
      body.innerHTML = html;
      body.querySelectorAll('tr.sum').forEach((tr) => tr.addEventListener('click', () => { const d = body.querySelector(`tr.det[data-for="${tr.dataset.id}"]`); d.hidden = !d.hidden; }));
    }
    document.getElementById('c-desde').addEventListener('change', load);
    document.getElementById('c-hasta').addEventListener('change', load);
    await load();
  }


  // ---------- utensilios: conteo / novedades / resumen ----------
  function utNav(sub) {
    return `<a class="back" href="#/">‹ Inicio</a><h1>Utensilios</h1>
      <div class="subnav"><a href="#/utensilios/conteo" class="${sub === 'conteo' ? 'on' : ''}">Conteo</a><a href="#/utensilios/novedades" class="${sub === 'novedades' ? 'on' : ''}">Novedades</a><a href="#/utensilios/resumen" class="${sub === 'resumen' ? 'on' : ''}">Resumen</a></div>`;
  }

  async function renderUtensilios(sub) {
    if (sub === 'novedades') return renderUtNovedades();
    if (sub === 'resumen') return renderUtResumen();
    return renderUtConteo();
  }

  async function renderUtConteo() {
    app.innerHTML = utNav('conteo') + `<p class="msg">Cargando…</p>`;
    let st;
    try { st = await API.utGet(8); } catch (e) { app.innerHTML = utNav('conteo') + `<div class="status err">${errorMsg(e)}</div>`; return; }
    const uts = st.utensilios;
    const sinInicial = uts.filter((u) => u.inicial == null).length;
    let html = utNav('conteo') + `
      <div class="card">
        <label class="field"><span>Fecha del conteo</span><input id="ut-fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
        <div id="ut-info" class="lede" style="margin:0"></div>
        <div id="ut-pin-wrap" hidden><label class="field"><span>PIN (día anterior a ayer)</span><input id="ut-pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label></div>
      </div>
      <p class="lede">Contar siempre lo mismo: lo que está en uso más lo guardado. Si una cantidad es menor que el conteo anterior se marca en bordó; si es mayor, en naranja. Toda diferencia se explica en Novedades.</p>
      ${sinInicial ? `<div class="warn"><span class="k">Stock inicial</span>${sinInicial === uts.length ? 'Todavía no hay stock inicial: este primer conteo queda como punto de partida para el control.' : `${sinInicial} utensilios sin stock inicial: su primer conteo queda como punto de partida.`}</div>` : ''}
      <div class="card">` + uts.map((u) => `
        <div class="urow" data-id="${esc(u.id)}">
          <div><div class="name">${esc(u.nombre)}</div><div class="sub" data-sub></div><div class="dif" data-dif></div></div>
          <input type="text" inputmode="numeric" autocomplete="off" placeholder="—">
        </div>`).join('') + `</div>
      <div class="card"><div id="ut-status"></div><button class="btn" id="ut-guardar">Guardar conteo</button></div>`;
    app.innerHTML = html;

    const fechaEl = document.getElementById('ut-fecha'), status = document.getElementById('ut-status'), pinWrap = document.getElementById('ut-pin-wrap');
    const rows = Array.from(app.querySelectorAll('.urow'));
    let anterior = {};
    const paintDif = (r) => {
      const prev = anterior[r.dataset.id]; const v = num(r.querySelector('input').value);
      r.classList.remove('menos', 'mas');
      const dif = r.querySelector('[data-dif]');
      if (!prev || v == null) { dif.textContent = ''; return; }
      const d = v - Number(prev.cantidad);
      if (d < 0) { r.classList.add('menos'); dif.textContent = `${fmt(d)} respecto del ${fechaCorta(prev.fecha)}: cargar la novedad`; }
      else if (d > 0) { r.classList.add('mas'); dif.textContent = `+${fmt(d)} respecto del ${fechaCorta(prev.fecha)}`; }
      else dif.textContent = 'Igual que el conteo anterior';
    };
    rows.forEach((r) => r.querySelector('input').addEventListener('input', () => paintDif(r)));

    async function cargarFecha() {
      const f = fechaEl.value; if (!f) return; status.innerHTML = '';
      try {
        const c = await API.utConteoGet(f);
        anterior = c.anterior || {}; pinWrap.hidden = !c.requiere_pin;
        rows.forEach((r) => {
          const it = (c.items || []).find((x) => x.utensilio_id === r.dataset.id); const prev = anterior[r.dataset.id];
          r.querySelector('input').value = it ? String(it.cantidad) : '';
          r.querySelector('[data-sub]').textContent = prev ? `Anterior ${fechaCorta(prev.fecha)}: ${fmt(prev.cantidad)}` : 'Sin conteo anterior';
          paintDif(r);
        });
        document.getElementById('ut-info').textContent = (c.items || []).length ? `Conteo de ${fechaLarga(f)} ya cargado. Podés corregirlo.` : `${fechaLarga(f)}: sin conteo cargado.`;
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    }
    fechaEl.addEventListener('change', cargarFecha);
    await cargarFecha();

    document.getElementById('ut-guardar').addEventListener('click', async () => {
      const f = fechaEl.value; if (!f) { status.innerHTML = `<div class="status err">Elegí la fecha.</div>`; return; }
      const items = [];
      for (const r of rows) {
        const raw = r.querySelector('input').value.trim();
        if (raw && (num(raw) == null || num(raw) < 0)) { status.innerHTML = `<div class="status err">Cantidad inválida en ${esc(r.querySelector('.name').textContent)}.</div>`; return; }
        items.push({ utensilio_id: r.dataset.id, cantidad: raw === '' ? null : num(raw) });
      }
      if (!items.some((i) => i.cantidad != null)) { status.innerHTML = `<div class="status err">No hay cantidades cargadas.</div>`; return; }
      const p = pinWrap.hidden ? null : document.getElementById('ut-pin').value.trim();
      const btn = document.getElementById('ut-guardar'); btn.disabled = true; status.innerHTML = '';
      try {
        await API.utConteoGuardar(f, items, p);
        if (p) API.pin.set(p);
        const menos = rows.filter((r) => r.classList.contains('menos')).length;
        status.innerHTML = `<div class="status ok">Conteo de ${esc(fechaLarga(f))} guardado.${menos ? ` Hay ${menos} utensilios con menos que el conteo anterior: <a class="link" href="#/utensilios/novedades">cargá las novedades</a>.` : ''}</div>`;
        const w = document.querySelector('.warn'); if (w && sinInicial) w.remove();
      } catch (e) {
        if (e.code === 'PIN_REQUERIDO') pinWrap.hidden = false;
        if (e.code === 'PIN_INCORRECTO') API.pin.clear();
        status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  async function renderUtNovedades() {
    app.innerHTML = utNav('novedades') + `<p class="msg">Cargando…</p>`;
    let st;
    try { st = await API.utGet(8); } catch (e) { app.innerHTML = utNav('novedades') + `<div class="status err">${errorMsg(e)}</div>`; return; }
    let tipo = 'BAJA', sel = null;
    app.innerHTML = utNav('novedades') + `
      <p class="lede">Toda diferencia tiene que quedar explicada acá. BAJA es lo que se rompió o perdió; INCORPORACIÓN lo que se sumó por compra o reposición. La cantidad va siempre en positivo.</p>
      <div class="card">
        <label class="field"><span>Fecha</span><input id="nv-fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
        <div class="field"><span>Utensilio</span><div class="btnrow" id="nv-ut" style="grid-template-columns:1fr 1fr">${st.utensilios.map((u) => `<button type="button" class="btn secondary small" data-id="${esc(u.id)}" style="margin:0">${esc(u.nombre)}</button>`).join('')}</div></div>
        <div class="field"><span>Tipo</span><div class="btnrow tipo-tgl" id="nv-tipo"><button type="button" class="btn secondary small baja on" data-t="BAJA" style="margin:0">Baja (rotura, extravío)</button><button type="button" class="btn secondary small inc" data-t="INCORPORACION" style="margin:0">Incorporación (compra)</button></div></div>
        <label class="field"><span>Cantidad</span><input id="nv-cant" type="text" inputmode="numeric" autocomplete="off"></label>
        <label class="field"><span>Motivo</span><input id="nv-motivo" type="text" autocomplete="off" placeholder="Ej.: se rompieron en el lavado"></label>
        <div id="nv-status"></div><button class="btn" id="nv-ok">Guardar novedad</button>
      </div>
      <h2>Novedades cargadas</h2><div class="card" id="nv-list"></div>`;
    const status = document.getElementById('nv-status');
    document.querySelectorAll('#nv-ut button').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.id; document.querySelectorAll('#nv-ut button').forEach((x) => x.classList.toggle('on', x === b)); }));
    document.querySelectorAll('#nv-tipo button').forEach((b) => b.addEventListener('click', () => { tipo = b.dataset.t; document.querySelectorAll('#nv-tipo button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const paintList = (list) => {
      const box = document.getElementById('nv-list');
      if (!list.length) { box.innerHTML = `<p class="msg" style="padding:12px 0">Sin novedades cargadas.</p>`; return; }
      box.innerHTML = `<table><tbody>` + list.map((n) => `<tr><td><b>${esc(n.utensilio)}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${esc(fechaCorta(n.fecha))} · ${esc(n.motivo)}</span></td><td class="q" style="color:${n.tipo === 'BAJA' ? 'var(--brand)' : '#b36b00'}">${n.tipo === 'BAJA' ? '−' : '+'}${fmt(n.cantidad)}</td><td style="width:40px;text-align:right"><button type="button" class="link-btn nv-del" data-id="${n.id}" aria-label="Borrar">✕</button></td></tr>`).join('') + `</tbody></table><div id="nv-del-box"></div>`;
      box.querySelectorAll('.nv-del').forEach((btn) => btn.addEventListener('click', () => {
        document.getElementById('nv-del-box').innerHTML = `<div class="warn"><span class="k">Borrar novedad (requiere PIN)</span><label class="field"><span>PIN</span><input id="nv-del-pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label><div class="btnrow"><button type="button" class="btn small" id="nv-del-ok">Borrar</button><button type="button" class="btn secondary small" id="nv-del-no">Cancelar</button></div><div id="nv-del-status"></div></div>`;
        document.getElementById('nv-del-no').addEventListener('click', () => { document.getElementById('nv-del-box').innerHTML = ''; });
        document.getElementById('nv-del-ok').addEventListener('click', async () => {
          const p = document.getElementById('nv-del-pin').value.trim();
          try { const r = await API.utNovedadBorrar(p, Number(btn.dataset.id)); API.pin.set(p); paintList(r.novedades); }
          catch (e) { if (e.code === 'PIN_INCORRECTO') API.pin.clear(); document.getElementById('nv-del-status').innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
        });
      }));
    };
    paintList(st.novedades || []);
    document.getElementById('nv-ok').addEventListener('click', async () => {
      status.innerHTML = '';
      const n = num(document.getElementById('nv-cant').value);
      if (!sel) { status.innerHTML = `<div class="status err">Elegí el utensilio.</div>`; return; }
      if (n == null || n <= 0) { status.innerHTML = `<div class="status err">Ingresá la cantidad en positivo.</div>`; return; }
      if (!document.getElementById('nv-motivo').value.trim()) { status.innerHTML = `<div class="status err">Ingresá el motivo.</div>`; return; }
      const btn = document.getElementById('nv-ok'); btn.disabled = true;
      try {
        const r = await API.utNovedadAgregar(document.getElementById('nv-fecha').value, sel, tipo, n, document.getElementById('nv-motivo').value);
        status.innerHTML = `<div class="status ok">Novedad guardada.</div>`;
        document.getElementById('nv-cant').value = ''; document.getElementById('nv-motivo').value = '';
        paintList(r.novedades);
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
      finally { btn.disabled = false; }
    });
  }

  async function renderUtResumen() {
    app.innerHTML = utNav('resumen') + `<p class="msg">Cargando…</p>`;
    let st;
    try { st = await API.utGet(8); } catch (e) { app.innerHTML = utNav('resumen') + `<div class="status err">${errorMsg(e)}</div>`; return; }
    const uts = st.utensilios, fechas = st.fechas || [];
    const sinJ = uts.filter((u) => u.diferencia != null && Number(u.diferencia) - Number(u.justificado) !== 0).length;
    let html = utNav('resumen') + `<p class="lede">Compara el último conteo contra el stock inicial y descuenta lo justificado en Novedades. La columna <b>sin justificar</b> es la que importa: lo que falta y nadie reportó.${uts.some((u) => u.inicial != null) ? ` Ahora mismo: <b>${sinJ}</b> utensilios con diferencia sin justificar.` : ''}</p>`;
    html += `<div class="card"><div class="scrollx"><table class="ctl"><thead><tr><th>Utensilio</th><th class="q">Inicial</th><th class="q">Último</th><th class="q">Dif.</th><th class="q">Justif.</th><th class="q">Sin justificar</th></tr></thead><tbody>` +
      uts.map((u) => { const d = u.diferencia == null ? null : Number(u.diferencia); const sj = d == null ? null : d - Number(u.justificado); const cls = sj == null ? '' : sj < 0 ? 'neg' : sj > 0 ? 'pos' : 'ok';
        return `<tr class="${cls}"><td><b>${esc(u.nombre)}</b>${u.inicial_fecha ? `<br><span class="sub">inicial ${esc(fechaCorta(u.inicial_fecha))}${u.ultimo_fecha ? ` · último ${esc(fechaCorta(u.ultimo_fecha))}` : ''}</span>` : '<br><span class="sub">sin stock inicial</span>'}</td>
          <td class="q">${u.inicial != null ? fmt(u.inicial) : '—'}</td><td class="q">${u.ultimo != null ? fmt(u.ultimo) : '—'}</td><td class="q">${d == null ? '—' : (d > 0 ? '+' : '') + fmt(d)}</td><td class="q">${Number(u.justificado) ? (Number(u.justificado) > 0 ? '+' : '') + fmt(u.justificado) : '0'}</td><td class="q desc">${sj == null ? '—' : (sj > 0 ? '+' : '') + fmt(sj)}</td></tr>`; }).join('') + `</tbody></table></div></div>`;
    if (fechas.length) {
      html += `<h2>Historial de conteos</h2><p class="lede">Últimos ${fechas.length} conteos. En bordó, menos que el conteo anterior; en naranja, más.</p><div class="card"><div class="scrollx"><table class="hist"><thead><tr><th>Utensilio</th>` + fechas.map((f) => `<th class="q">${esc(fechaCorta(f))}</th>`).join('') + `</tr></thead><tbody>` +
        uts.map((u) => { const asc = [...fechas].reverse(); const cells = {};
          asc.forEach((f, i) => { const v = u.conteos[f]; let prev = null; for (let j = i - 1; j >= 0; j--) { if (u.conteos[asc[j]] != null) { prev = u.conteos[asc[j]]; break; } } cells[f] = v == null ? '' : prev == null ? '' : Number(v) < Number(prev) ? 'menos' : Number(v) > Number(prev) ? 'mas' : ''; });
          return `<tr><td><b>${esc(u.nombre)}</b></td>` + fechas.map((f, idx) => `<td class="q ${idx === 0 ? 'ult' : ''} ${cells[f]}">${u.conteos[f] != null ? fmt(u.conteos[f]) : '<span class="dash">—</span>'}</td>`).join('') + `</tr>`; }).join('') + `</tbody></table></div></div>`;
    }
    app.innerHTML = html;
  }


  // ---------- caja: contador de billetes y gastos (sin fecha, sin base; solo ayuda a cerrar) ----------
  const pesos = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');

  function renderCaja() {
    const billetes = (window.FLAMA_CONFIG && window.FLAMA_CONFIG.billetes) || [];
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('salon_caja') || 'null'); } catch (_) { saved = null; }
    const gastos0 = (saved && saved.gastos && saved.gastos.length) ? saved.gastos : [{ concepto: '', monto: '' }];

    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Caja</h1>
      <p class="lede">Para cerrar la caja. Cargá cuántos billetes hay de cada uno, los pagos que salieron del efectivo y lo que dice el sistema. No se guarda nada.</p>
      <h2>Contador de billetes</h2>
      <div class="card">` + billetes.map((b) => `
        <div class="brow" data-b="${b}">
          <div class="den">${pesos(b)}</div>
          <input type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${saved && saved.billetes && saved.billetes[b] ? esc(saved.billetes[b]) : ''}">
          <div class="sub" data-sub>${pesos(0)}</div>
        </div>`).join('') + `
        <div class="brow total"><div class="den">Efectivo contado</div><div></div><div class="sub" id="cj-contado">${pesos(0)}</div></div>
      </div>
      <h2>Pagos de caja</h2>
      <div class="card">
        <div id="cj-gastos"></div>
        <button type="button" class="btn secondary small" id="cj-add">+ Agregar pago</button>
        <div class="brow total"><div class="den">Total pagos</div><div></div><div class="sub" id="cj-gastos-total">${pesos(0)}</div></div>
      </div>
      <h2>Sistema</h2>
      <div class="card">
        <label class="field"><span>Efectivo según el sistema</span><input id="cj-sistema" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${saved && saved.sistema ? esc(saved.sistema) : ''}"></label>
        <div class="brow total"><div class="den">Tiene que haber (sistema − pagos)</div><div></div><div class="sub" id="cj-esperado">${pesos(0)}</div></div>
      </div>
      <div id="cj-result" class="cajares"></div>
      <button type="button" class="btn secondary small" id="cj-clear">Limpiar todo</button>`;

    const gastosBox = document.getElementById('cj-gastos');
    const addGasto = (g) => {
      const row = document.createElement('div');
      row.className = 'grow';
      row.innerHTML = `<input type="text" class="g-con" autocomplete="off" placeholder="Concepto" value="${esc(g.concepto || '')}"><input type="text" class="g-monto" inputmode="numeric" autocomplete="off" placeholder="$ 0" value="${esc(g.monto || '')}"><button type="button" class="link-btn g-del" aria-label="Quitar">✕</button>`;
      row.querySelector('.g-del').addEventListener('click', () => { row.remove(); if (!gastosBox.children.length) addGasto({}); calc(); });
      row.querySelectorAll('input').forEach((i) => i.addEventListener('input', calc));
      gastosBox.appendChild(row);
    };
    gastos0.forEach(addGasto);
    document.getElementById('cj-add').addEventListener('click', () => { addGasto({}); gastosBox.lastElementChild.querySelector('.g-con').focus(); });

    function calc() {
      let contado = 0; const bil = {};
      app.querySelectorAll('.brow[data-b]').forEach((r) => {
        const n = num(r.querySelector('input').value) || 0; const b = Number(r.dataset.b);
        bil[b] = r.querySelector('input').value; contado += n * b;
        r.querySelector('[data-sub]').textContent = pesos(n * b);
      });
      let gastos = 0; const gl = [];
      gastosBox.querySelectorAll('.grow').forEach((r) => { const m = num(r.querySelector('.g-monto').value) || 0; gastos += m; gl.push({ concepto: r.querySelector('.g-con').value, monto: r.querySelector('.g-monto').value }); });
      const sistemaRaw = document.getElementById('cj-sistema').value; const sistema = num(sistemaRaw);
      document.getElementById('cj-contado').textContent = pesos(contado);
      document.getElementById('cj-gastos-total').textContent = pesos(gastos);
      const esperado = (sistema || 0) - gastos;
      document.getElementById('cj-esperado').textContent = pesos(esperado);
      const res = document.getElementById('cj-result');
      if (sistema == null) { res.className = 'cajares'; res.innerHTML = `<span class="k">Resultado</span>Cargá el efectivo según el sistema.`; }
      else {
        const dif = contado - esperado;
        if (Math.abs(dif) < 0.5) { res.className = 'cajares ok'; res.innerHTML = `<span class="k">Caja OK</span>Contado ${pesos(contado)} = sistema ${pesos(sistema)}${gastos ? ` − pagos ${pesos(gastos)}` : ''}.`; }
        else if (dif < 0) { res.className = 'cajares falta'; res.innerHTML = `<span class="k">Faltan ${pesos(-dif)}</span>Contado ${pesos(contado)}, tendría que haber ${pesos(esperado)}.`; }
        else { res.className = 'cajares sobra'; res.innerHTML = `<span class="k">Sobran ${pesos(dif)}</span>Contado ${pesos(contado)}, tendría que haber ${pesos(esperado)}.`; }
      }
      try { sessionStorage.setItem('salon_caja', JSON.stringify({ billetes: bil, gastos: gl, sistema: sistemaRaw })); } catch (_) { /* sin storage */ }
    }
    app.querySelectorAll('.brow[data-b] input').forEach((i) => i.addEventListener('input', calc));
    document.getElementById('cj-sistema').addEventListener('input', calc);
    document.getElementById('cj-clear').addEventListener('click', () => { try { sessionStorage.removeItem('salon_caja'); } catch (_) { /* */ } renderCaja(); });
    calc();
  }

  // ---------- ajustes (PIN) ----------
  function renderDefinirPin(volver, cambio) {
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>${cambio ? 'Cambiar PIN' : 'Definir PIN'}</h1>
      <p class="lede">${cambio ? 'Ingresá el PIN actual y el nuevo.' : 'Todavía no hay PIN de administración. Definilo ahora: protege ajustes, altas de bebidas, recetas, borrado de ingresos y la corrección de días pasados. Para el cierre diario y los ingresos no hace falta.'}</p>
      <div class="card">
        ${cambio ? `<label class="field"><span>PIN actual</span><input id="pin-actual" type="password" inputmode="numeric" autocomplete="off"></label>` : ''}
        <label class="field"><span>PIN nuevo</span><input id="pin-nuevo" type="password" inputmode="numeric" autocomplete="off"></label>
        <label class="field"><span>Repetir PIN nuevo</span><input id="pin-rep" type="password" inputmode="numeric" autocomplete="off"></label>
        <div id="pin-status"></div>
        <button class="btn" id="pin-ok">Guardar PIN</button>
        ${cambio ? `<button class="btn secondary small" id="pin-cancel">Cancelar</button>` : ''}
      </div>`;
    const status = document.getElementById('pin-status');
    document.getElementById('pin-ok').addEventListener('click', async () => {
      const nuevo = document.getElementById('pin-nuevo').value, rep = document.getElementById('pin-rep').value;
      const actual = cambio ? document.getElementById('pin-actual').value : null;
      if (nuevo.length < 4) { status.innerHTML = `<div class="status err">El PIN tiene que tener al menos 4 caracteres.</div>`; return; }
      if (nuevo !== rep) { status.innerHTML = `<div class="status err">Los PIN no coinciden.</div>`; return; }
      try { await API.pinSet(actual, nuevo); API.pin.set(nuevo); volver(); }
      catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    });
    const c = document.getElementById('pin-cancel'); if (c) c.addEventListener('click', volver);
  }

  async function renderAjustes() {
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Ajustes</h1><p class="msg">Cargando…</p>`;
    let estado, ajustes;
    try { [estado, ajustes, CAT] = await Promise.all([API.pinEstado(), API.ajustesList(), API.catalogo()]); }
    catch (e) { app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Ajustes</h1><div class="status err">${errorMsg(e)}</div>`; return; }
    if (!estado.definido) return renderDefinirPin(() => renderAjustes());

    const categorias = [...new Set(CAT.bebidas.map((b) => b.categoria))];
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Ajustes</h1>
      <div class="card"><label class="field"><span>PIN de administración</span><input id="adm-pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label>
      <p class="lede" style="margin:0;text-align:center"><a class="link" href="#" id="cambiar-pin">Cambiar PIN</a></p></div>

      <h2>Ajuste de stock</h2>
      <div class="card">
        <p class="lede">Rotura, consumo interno, corrección de inventario. Positivo suma, negativo resta. Entra en el control como movimiento del día.</p>
        <label class="field"><span>Fecha</span><input id="aj-fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
        <div class="field"><span>Bebida</span>${pickerHtml('aj-picker')}</div>
        <label class="field"><span id="aj-cant-label">Cantidad (+ suma, − resta)</span><input id="aj-cant" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej.: -2"></label>
        <label class="field"><span>Motivo</span><input id="aj-motivo" type="text" autocomplete="off" placeholder="Ej.: rotura, invitación, corrección"></label>
        <div id="aj-status"></div><button class="btn small" id="aj-ok">Guardar ajuste</button>
        <div id="aj-list"></div>
      </div>

      <h2>Bebidas</h2>
      <div class="card" id="beb-list"></div>
      <div class="card">
        <strong>Nueva bebida</strong>
        <label class="field"><span>Nombre</span><input id="nb-nombre" type="text" autocomplete="off" placeholder="Ej.: Sprite lata 350"></label>
        <label class="field"><span>Categoría</span><input id="nb-cat" type="text" list="cats" autocomplete="off" placeholder="Ej.: Sin alcohol"><datalist id="cats">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Familia (para la alerta de presentaciones, opcional)</span><input id="nb-fam" type="text" autocomplete="off" placeholder="Ej.: Sprite"></label>
        <div class="field"><span>Unidad de conteo</span><div class="btnrow three" id="nb-unidad"><button type="button" class="btn secondary small on" data-u="botella">Botella</button><button type="button" class="btn secondary small" data-u="lata">Lata</button><button type="button" class="btn secondary small" data-u="ml">ml (destilado)</button></div></div>
        <label class="field" id="nb-cap-wrap" hidden><span>Capacidad de la botella (ml)</span><input id="nb-cap" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej.: 750"></label>
        <div id="nb-status"></div><button class="btn small" id="nb-ok">Dar de alta</button>
      </div>

      <h2>Tragos y recetas</h2>
      <p class="lede">Cuánto consume cada trago de cada bebida: mixers en unidades, destilados en ml.</p>
      <div id="tragos-box"></div>
      <h2>Utensilios</h2>
      <div class="card" id="ut-adm"><p class="msg">Cargando…</p></div>
      <div class="card">
        <strong>Nuevo utensilio</strong>
        <label class="field"><span>Nombre</span><input id="nu-nombre" type="text" autocomplete="off" placeholder="Ej.: Bandejas"></label>
        <label class="field"><span>Stock inicial (opcional; si queda vacío lo define el primer conteo)</span><input id="nu-inicial" type="text" inputmode="numeric" autocomplete="off"></label>
        <div id="nu-status"></div><button class="btn small" id="nu-ok">Dar de alta</button>
      </div>
      <div class="card">
        <strong>Nuevo período de utensilios</strong>
        <p class="lede">El stock inicial de cada utensilio pasa a ser su último conteo. Las novedades anteriores dejan de contar para el resumen; el historial se conserva.</p>
        <div id="np-status"></div><button class="btn secondary small" id="np-ok">Cerrar período y arrancar de nuevo</button>
      </div>
      <div class="card"><strong>Nuevo trago</strong><label class="field"><span>Nombre</span><input id="nt-nombre" type="text" autocomplete="off" placeholder="Ej.: Gin Tonic"></label><div id="nt-status"></div><button class="btn small" id="nt-ok">Crear trago (después cargá su receta)</button></div>`;
    app.innerHTML = html;

    const pinVal = () => document.getElementById('adm-pin').value.trim();
    const onPinErr = (e, box) => { if (e.code === 'PIN_INCORRECTO') API.pin.clear(); box.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; };
    document.getElementById('cambiar-pin').addEventListener('click', (ev) => { ev.preventDefault(); renderDefinirPin(() => renderAjustes(), true); });

    // ajustes de stock
    let ajSel = null;
    wirePicker('aj-picker', (b) => { ajSel = b; document.getElementById('aj-cant-label').textContent = b && esDestilado(b) ? 'Cantidad en ml (+ suma, − resta)' : 'Cantidad (+ suma, − resta)'; });
    const paintAj = (list) => {
      document.getElementById('aj-list').innerHTML = list.length ? `<table style="margin-top:12px"><tbody>` + list.map((a) => `<tr><td><b>${esc(a.bebida)}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${esc(fechaCorta(a.fecha))} · ${esc(a.motivo)}</span></td><td class="q">${Number(a.cantidad) > 0 ? '+' : ''}${fmt(a.cantidad)}<span class="u"> ${esc(a.unidad)}</span></td><td style="width:40px;text-align:right"><button type="button" class="link-btn aj-del" data-id="${a.id}" aria-label="Borrar">✕</button></td></tr>`).join('') + `</tbody></table>` : '';
      document.querySelectorAll('.aj-del').forEach((b) => b.addEventListener('click', async () => {
        try { paintAj(await API.ajusteBorrar(pinVal(), Number(b.dataset.id))); API.pin.set(pinVal()); } catch (e) { onPinErr(e, document.getElementById('aj-status')); }
      }));
    };
    paintAj(ajustes);
    document.getElementById('aj-ok').addEventListener('click', async () => {
      const st = document.getElementById('aj-status'); st.innerHTML = '';
      const n = num(document.getElementById('aj-cant').value);
      if (!ajSel) { st.innerHTML = `<div class="status err">Elegí la bebida.</div>`; return; }
      if (n == null || n === 0) { st.innerHTML = `<div class="status err">Ingresá una cantidad distinta de cero.</div>`; return; }
      try {
        paintAj(await API.ajusteAgregar(pinVal(), document.getElementById('aj-fecha').value, ajSel.id, n, document.getElementById('aj-motivo').value));
        API.pin.set(pinVal()); st.innerHTML = `<div class="status ok">Ajuste guardado.</div>`;
        document.getElementById('aj-cant').value = ''; document.getElementById('aj-motivo').value = '';
      } catch (e) { onPinErr(e, st); }
    });

    // bebidas: activar / desactivar
    const paintBeb = () => {
      const box = document.getElementById('beb-list');
      box.innerHTML = `<table><tbody>` + CAT.bebidas.map((b) => `<tr class="${b.activo ? '' : 'off'}"><td><b>${esc(b.nombre)}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${esc(b.categoria)} · ${esc(unidadLabel(b))}${b.eventual ? ' · eventual' : ''}${b.familia ? ` · familia ${esc(b.familia)}` : ''}</span></td>
        <td style="width:110px;text-align:right"><button type="button" class="btn secondary small beb-tgl" data-id="${esc(b.id)}" style="margin:0">${b.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') + `</tbody></table><div id="beb-status"></div>`;
      box.querySelectorAll('.beb-tgl').forEach((btn) => btn.addEventListener('click', async () => {
        const b = bebida(btn.dataset.id);
        try { CAT = await API.bebidaGuardar(pinVal(), { ...b, activo: !b.activo }); API.pin.set(pinVal()); paintBeb(); paintTragos(); }
        catch (e) { onPinErr(e, document.getElementById('beb-status')); }
      }));
    };
    paintBeb();
    let nbUnidad = 'botella';
    document.querySelectorAll('#nb-unidad button').forEach((b) => b.addEventListener('click', () => { nbUnidad = b.dataset.u; document.querySelectorAll('#nb-unidad button').forEach((x) => x.classList.toggle('on', x === b)); document.getElementById('nb-cap-wrap').hidden = nbUnidad !== 'ml'; }));
    document.getElementById('nb-ok').addEventListener('click', async () => {
      const st = document.getElementById('nb-status'); st.innerHTML = '';
      const nombre = document.getElementById('nb-nombre').value.trim(), cat = document.getElementById('nb-cat').value.trim();
      const cap = num(document.getElementById('nb-cap').value);
      if (!nombre || !cat) { st.innerHTML = `<div class="status err">Nombre y categoría son obligatorios.</div>`; return; }
      if (nbUnidad === 'ml' && (cap == null || cap <= 0)) { st.innerHTML = `<div class="status err">Para destilados hace falta la capacidad de la botella en ml.</div>`; return; }
      try {
        CAT = await API.bebidaGuardar(pinVal(), { nombre, categoria: cat, familia: document.getElementById('nb-fam').value.trim() || null, unidad: nbUnidad, capacidad_ml: nbUnidad === 'ml' ? cap : null, venta_directa: nbUnidad !== 'ml', orden: 500 + CAT.bebidas.length * 10 });
        API.pin.set(pinVal()); st.innerHTML = `<div class="status ok">${esc(nombre)} dada de alta.</div>`;
        document.getElementById('nb-nombre').value = ''; document.getElementById('nb-fam').value = ''; document.getElementById('nb-cap').value = '';
        paintBeb(); paintTragos();
      } catch (e) { onPinErr(e, st); }
    });

    // tragos y recetas
    const paintTragos = () => {
      const box = document.getElementById('tragos-box');
      box.innerHTML = CAT.tragos.map((t) => `<div class="card ${t.activo ? '' : 'off'}" data-trago="${esc(t.id)}">
        <div class="btnrow" style="align-items:center"><strong style="font-size:20px">${esc(t.nombre)}</strong><button type="button" class="btn secondary small t-tgl" style="margin:0">${t.activo ? 'Desactivar' : 'Activar'}</button></div>
        <table style="margin-top:8px"><tbody>` + t.receta.map((r) => { const b = bebida(r.bebida_id); return `<tr data-b="${esc(r.bebida_id)}"><td>${esc(b ? b.nombre : r.bebida_id)}<br><span class="sub" style="color:var(--gray);font-size:13px">${b ? (esDestilado(b) ? 'ml' : b.unidad) : ''}</span></td><td class="q" style="width:120px"><input class="r-cant" type="text" inputmode="decimal" autocomplete="off" value="${esc(String(r.cantidad).replace('.', ','))}" style="width:100px;font:inherit;font-size:20px;font-weight:800;text-align:right;padding:6px 8px;border:2px solid var(--black);border-radius:8px"></td></tr>`; }).join('') + `</tbody></table>
        <div class="field" style="margin-top:10px"><span>Agregar bebida a la receta</span>${pickerHtml(`tp-${t.id}`)}</div>
        <label class="field"><span>Cantidad para la bebida agregada</span><input class="t-newcant" type="text" inputmode="decimal" autocomplete="off" placeholder="Unidades, o ml si es destilado"></label>
        <div class="t-status"></div><button type="button" class="btn small t-save">Guardar receta</button>
      </div>`).join('');
      box.querySelectorAll('[data-trago]').forEach((card) => {
        const t = trago(card.dataset.trago);
        const pk = wirePicker(`tp-${t.id}`, () => {});
        card.querySelector('.t-tgl').addEventListener('click', async () => {
          try { CAT = await API.tragoGuardar(pinVal(), { id: t.id, nombre: t.nombre, orden: t.orden, activo: !t.activo }); API.pin.set(pinVal()); paintTragos(); }
          catch (e) { onPinErr(e, card.querySelector('.t-status')); }
        });
        card.querySelector('.t-save').addEventListener('click', async () => {
          const st = card.querySelector('.t-status'); st.innerHTML = '';
          const receta = [];
          for (const tr of card.querySelectorAll('tr[data-b]')) { const n = num(tr.querySelector('.r-cant').value); if (n != null && n > 0) receta.push({ bebida_id: tr.dataset.b, cantidad: n }); }
          const nb = pk.get(); const nc = num(card.querySelector('.t-newcant').value);
          if (nb) { if (nc == null || nc <= 0) { st.innerHTML = `<div class="status err">Ingresá la cantidad de ${esc(nb.nombre)}.</div>`; return; } receta.push({ bebida_id: nb.id, cantidad: nc }); }
          try { CAT = await API.tragoGuardar(pinVal(), { id: t.id, nombre: t.nombre, orden: t.orden, activo: t.activo, receta }); API.pin.set(pinVal()); paintTragos(); }
          catch (e) { onPinErr(e, st); }
        });
      });
    };
    paintTragos();

    // utensilios: activar/desactivar y corregir stock inicial
    const paintUt = (st) => {
      const box = document.getElementById('ut-adm');
      box.innerHTML = `<table><tbody>` + st.utensilios.map((u) => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.nombre)}</b><br><span class="sub" style="color:var(--gray);font-size:13px">inicial ${u.inicial != null ? fmt(u.inicial) + (u.inicial_fecha ? ` (${fechaCorta(u.inicial_fecha)})` : '') : 'sin definir'}</span></td>
        <td class="q" style="width:100px"><input class="u-ini" type="text" inputmode="numeric" autocomplete="off" placeholder="inicial" value="${u.inicial != null ? esc(String(u.inicial)) : ''}" style="width:90px;font:inherit;font-size:18px;font-weight:800;text-align:right;padding:6px 8px;border:2px solid var(--black);border-radius:8px"></td>
        <td style="width:120px;text-align:right"><button type="button" class="btn secondary small u-save" style="margin:0 0 4px">Guardar</button><button type="button" class="btn secondary small u-tgl" style="margin:0">${u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') + `</tbody></table><div id="ut-adm-status"></div>`;
      box.querySelectorAll('tr[data-id]').forEach((tr) => {
        const u = st.utensilios.find((x) => x.id === tr.dataset.id);
        tr.querySelector('.u-save').addEventListener('click', async () => {
          const ini = tr.querySelector('.u-ini').value.trim();
          try { paintUt(await API.utGuardar(pinVal(), { ...u, inicial: ini === '' ? null : num(ini), inicial_fecha: ini === '' ? null : (u.inicial_fecha || hoyISO()) })); API.pin.set(pinVal()); }
          catch (e) { onPinErr(e, document.getElementById('ut-adm-status')); }
        });
        tr.querySelector('.u-tgl').addEventListener('click', async () => {
          try { paintUt(await API.utGuardar(pinVal(), { ...u, activo: !u.activo })); API.pin.set(pinVal()); }
          catch (e) { onPinErr(e, document.getElementById('ut-adm-status')); }
        });
      });
    };
    try { paintUt(await API.utGet(1)); } catch (e) { document.getElementById('ut-adm').innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    document.getElementById('nu-ok').addEventListener('click', async () => {
      const st = document.getElementById('nu-status'); st.innerHTML = '';
      const nombre = document.getElementById('nu-nombre').value.trim(); const ini = document.getElementById('nu-inicial').value.trim();
      if (!nombre) { st.innerHTML = `<div class="status err">Ingresá el nombre.</div>`; return; }
      try { paintUt(await API.utGuardar(pinVal(), { nombre, orden: 500, inicial: ini === '' ? null : num(ini), inicial_fecha: ini === '' ? null : hoyISO() })); API.pin.set(pinVal()); st.innerHTML = `<div class="status ok">${esc(nombre)} dado de alta.</div>`; document.getElementById('nu-nombre').value = ''; document.getElementById('nu-inicial').value = ''; }
      catch (e) { onPinErr(e, st); }
    });
    document.getElementById('np-ok').addEventListener('click', async () => {
      const st = document.getElementById('np-status'); st.innerHTML = '';
      try { paintUt(await API.utNuevoPeriodo(pinVal())); API.pin.set(pinVal()); st.innerHTML = `<div class="status ok">Período cerrado: el stock inicial ahora es el último conteo.</div>`; }
      catch (e) { onPinErr(e, st); }
    });

    document.getElementById('nt-ok').addEventListener('click', async () => {
      const st = document.getElementById('nt-status'); const nombre = document.getElementById('nt-nombre').value.trim();
      if (!nombre) { st.innerHTML = `<div class="status err">Ingresá el nombre.</div>`; return; }
      try { CAT = await API.tragoGuardar(pinVal(), { nombre, orden: 100 + CAT.tragos.length * 10, receta: [] }); API.pin.set(pinVal()); document.getElementById('nt-nombre').value = ''; st.innerHTML = `<div class="status ok">Trago creado. Cargale la receta arriba.</div>`; paintTragos(); }
      catch (e) { onPinErr(e, st); }
    });
  }

  // ---------- arranque ----------
  API.catalogo()
    .then((c) => { CAT = c; route(); })
    .catch((e) => { app.innerHTML = `<p class="msg error">No se pudo cargar el catálogo de bebidas.</p><p class="msg">${errorMsg(e)}</p>`; });
  window.addEventListener('hashchange', route);
})();

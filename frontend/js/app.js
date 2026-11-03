import { api } from './api/index.js';

// ---------- Utilidades ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// El backend guarda fechas UTC sin zona ("2026-10-29 12:00:00"); el demo usa ISO
const aFecha = (s) => new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
const fecha = (s) => aFecha(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const pesos = (n) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

const CATEGORIAS = {
  demora: 'Demora', conduccion: 'Conducción', limpieza: 'Limpieza', estado_unidad: 'Estado de la unidad',
  trato: 'Trato del personal', app: 'Problema con la app', otro: 'Otro',
};
const ESTADOS = { pendiente: 'Pendiente', en_revision: 'En revisión', resuelto: 'Resuelto', rechazado: 'Rechazado' };

function toast(mensaje, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = mensaje;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'alerta-desvio' ? 8000 : 4000);
}

// Ejecuta una acción mostrando el error si falla
async function intentar(fn, boton) {
  if (boton) boton.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Ocurrió un error', 'error');
    console.error(err);
  } finally {
    if (boton) boton.disabled = false;
  }
}

// ---------- Estado ----------
const estado = {
  lineas: [],
  lineaActual: null, // detalle con paradas
  suscripciones: new Set(),
  desvios: [],
  paradaSeleccionada: null,
};

const usuario = () => api.usuario();

// ---------- Navegación ----------
const VISTAS = {
  mapa: () => {
    mapa.invalidateSize();
    renderPanel();
  },
  reclamos: renderReclamos,
  sube: renderSube,
  admin: renderAdmin,
  cuenta: renderCuenta,
};

function navegar() {
  let vista = location.hash.slice(1) || 'mapa';
  if (!VISTAS[vista] || (vista === 'admin' && usuario()?.rol !== 'admin')) vista = 'mapa';
  for (const s of $$('.vista')) s.hidden = s.id !== `vista-${vista}`;
  for (const a of $$('.menu a')) a.classList.toggle('activo', a.dataset.vista === vista);
  VISTAS[vista]();
}

function actualizarSesion() {
  const u = usuario();
  $('.solo-admin').hidden = u?.rol !== 'admin';
  $('#enlace-cuenta').textContent = u ? `👤 ${u.nombre.split(' ')[0]}` : 'Ingresar';
  for (const el of $$('.requiere-sesion')) {
    el.innerHTML = u ? '' : `<div class="tarjeta">Para usar esta sección <a href="#cuenta">iniciá sesión o creá una cuenta</a>.</div>`;
  }
  for (const el of $$('.con-sesion')) el.hidden = !u;
}

async function cargarSuscripciones() {
  estado.suscripciones = new Set(usuario() ? (await api.suscripciones()).map((l) => l.id) : []);
  seguirLineas();
}

// Eventos en tiempo real: la línea en pantalla + las suscriptas
function seguirLineas() {
  const ids = new Set(estado.suscripciones);
  if (estado.lineaActual) ids.add(estado.lineaActual.id);
  api.seguirLineas([...ids]);
}

// ---------- Mapa ----------
const mapa = L.map('mapa', { zoomControl: true }).setView([-34.462, -58.91], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);

const capaRecorrido = L.layerGroup().addTo(mapa);
const capaColectivos = L.layerGroup().addTo(mapa);
const marcadores = new Map(); // colectivoId -> marcador

function renderChips() {
  $('#chips-lineas').innerHTML = estado.lineas
    .map(
      (l) => `<button class="chip ${estado.lineaActual?.id === l.id ? 'activo' : ''}" style="--color:${esc(l.color)}" data-linea="${l.id}">
        <strong>${esc(l.codigo)}</strong> ${esc(l.nombre)}${l.desvios_activos ? `<span class="insignia" title="Desvíos activos">${l.desvios_activos}</span>` : ''}
      </button>`
    )
    .join('');
}

async function refrescarLineas() {
  estado.lineas = await api.lineas();
  renderChips();
}

$('#chips-lineas').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-linea]');
  if (chip) intentar(() => seleccionarLinea(Number(chip.dataset.linea)));
});

function iconoColectivo(c) {
  const desviado = estado.desvios.some((d) => d.colectivo_id === c.id);
  return L.divIcon({
    className: '',
    html: `<div class="icono-colectivo ${desviado ? 'desviado' : ''}" style="--color:${esc(estado.lineaActual.color)};width:34px;height:22px">${esc(c.interno)}</div>`,
    iconSize: [34, 22],
    iconAnchor: [17, 11],
  });
}

function actualizarMarcador(c) {
  if (!c.posicion || c.linea_id !== estado.lineaActual?.id) return;
  const pos = [c.posicion.lat, c.posicion.lng];
  const popup = `<strong>Interno ${esc(c.interno)}</strong><br>${c.posicion.velocidad ? `${Math.round(c.posicion.velocidad)} km/h` : ''}`;
  let m = marcadores.get(c.id);
  if (m) {
    m.setLatLng(pos).setIcon(iconoColectivo(c)).setPopupContent(popup);
  } else {
    m = L.marker(pos, { icon: iconoColectivo(c), zIndexOffset: 1000 }).bindPopup(popup).addTo(capaColectivos);
    marcadores.set(c.id, m);
  }
}

async function seleccionarLinea(id) {
  const linea = await api.linea(id);
  estado.lineaActual = linea;
  estado.paradaSeleccionada = null;
  localStorage.setItem('pilarbus-linea', id);
  seguirLineas();
  renderChips();

  capaRecorrido.clearLayers();
  capaColectivos.clearLayers();
  marcadores.clear();

  const puntos = linea.paradas.map((p) => [p.lat, p.lng]);
  L.polyline(puntos, { color: linea.color, weight: 5, opacity: 0.8 }).addTo(capaRecorrido);
  for (const p of linea.paradas) {
    L.circleMarker([p.lat, p.lng], { radius: 7, color: linea.color, fillColor: '#fff', fillOpacity: 1, weight: 3 })
      .bindTooltip(p.nombre)
      .on('click', () => intentar(() => seleccionarParada(p)))
      .addTo(capaRecorrido);
  }
  mapa.fitBounds(puntos, { padding: [30, 30] });

  estado.desvios = await api.desvios(id);
  (await api.colectivos(id)).forEach(actualizarMarcador);
  renderPanel();
}

async function seleccionarParada(parada) {
  estado.paradaSeleccionada = parada;
  await renderArribos();
  if (matchMedia('(max-width: 760px)').matches) $('#arribos').scrollIntoView({ behavior: 'smooth' });
}

function renderPanel() {
  const l = estado.lineaActual;
  if (!l) return;
  const u = usuario();
  const suscripto = estado.suscripciones.has(l.id);
  $('#info-linea').innerHTML = `
    <h2 style="color:${esc(l.color)}">Línea ${esc(l.codigo)}</h2>
    <p class="suave">${esc(l.nombre)} · ${l.paradas.length} paradas</p>
    ${u
      ? `<button class="boton ${suscripto ? 'secundario' : ''} chico" id="btn-suscribir">${suscripto ? '🔕 Dejar de recibir alertas' : '🔔 Recibir alertas de esta línea'}</button>`
      : `<p class="suave"><a href="#cuenta">Ingresá</a> para recibir alertas de desvíos.</p>`}`;

  $('#lista-desvios').innerHTML = estado.desvios.length
    ? `<h3>⚠️ Desvíos activos</h3>${estado.desvios
        .map((d) => `<div class="alerta"><strong>${esc(d.titulo)}</strong>${d.descripcion ? `<span class="suave">${esc(d.descripcion)}</span><br>` : ''}<span class="suave">Desde ${fecha(d.creado_en)}</span></div>`)
        .join('')}`
    : '<p class="suave">✅ Sin desvíos informados en esta línea.</p>';

  renderArribos();
  $('#btn-simular-desvio').hidden = api.modo !== 'demo';
}

async function renderArribos() {
  const p = estado.paradaSeleccionada;
  if (!p) {
    $('#arribos').innerHTML = '<p class="suave">Tocá una parada en el mapa para ver los próximos colectivos.</p>';
    return;
  }
  const { arribos } = await api.arribos(estado.lineaActual.id, p.id);
  $('#arribos').innerHTML = `
    <h3>🚏 ${esc(p.nombre)}</h3>
    ${arribos.length
      ? `<ul class="lista">${arribos
          .map((a) => `<li><span>Interno <strong>${esc(a.colectivo.interno)}</strong><br><span class="suave">a ${(a.distancia_metros / 1000).toFixed(1)} km</span></span><strong>${a.minutos_estimados} min</strong></li>`)
          .join('')}</ul>`
      : '<p class="suave">No hay colectivos en servicio en este momento.</p>'}`;
}

$('#info-linea').addEventListener('click', (e) => {
  if (e.target.id !== 'btn-suscribir') return;
  const id = estado.lineaActual.id;
  intentar(async () => {
    if (estado.suscripciones.has(id)) {
      await api.desuscribir(id);
      toast('Ya no vas a recibir alertas de esta línea');
    } else {
      await api.suscribir(id);
      toast('Te vamos a avisar si hay desvíos en esta línea');
    }
    await cargarSuscripciones();
    renderPanel();
  }, e.target);
});

$('#btn-simular-desvio').addEventListener('click', () => {
  const interno = api.simularDesvio(estado.lineaActual.id);
  toast(`El interno ${interno} se saldrá del recorrido: en unos segundos se detectará el desvío`);
});

// Actualización periódica de arribos
setInterval(() => {
  if (!$('#vista-mapa').hidden && estado.paradaSeleccionada) renderArribos().catch(() => {});
}, 5000);

// ---------- Tiempo real ----------
api.on('colectivo:posicion', actualizarMarcador);

async function alCambiarDesvio(desvio, nuevo) {
  const linea = estado.lineas.find((l) => l.id === desvio.linea_id);
  toast(`${nuevo ? '⚠️ Desvío' : '✅ Fin de desvío'} en línea ${linea?.codigo ?? desvio.linea_codigo}: ${desvio.titulo}`, nuevo ? 'alerta-desvio' : '');
  await refrescarLineas();
  if (desvio.linea_id === estado.lineaActual?.id) {
    estado.desvios = await api.desvios(desvio.linea_id);
    renderPanel();
  }
  if (!$('#vista-admin').hidden) renderAdmin();
}
api.on('desvio:nuevo', (d) => alCambiarDesvio(d, true));
api.on('desvio:finalizado', (d) => alCambiarDesvio(d, false));

// ---------- Reclamos ----------
function opcionesLineas(conVacio = true) {
  return (conVacio ? '<option value="">—</option>' : '') +
    estado.lineas.map((l) => `<option value="${l.id}">${esc(l.codigo)} – ${esc(l.nombre)}</option>`).join('');
}

async function tarjetaReclamo(r, admin) {
  const linea = estado.lineas.find((l) => l.id === r.linea_id);
  const div = document.createElement('article');
  div.className = 'reclamo';
  div.innerHTML = `
    <header>
      <strong>#${r.id} · ${esc(CATEGORIAS[r.categoria] ?? r.categoria)}</strong>
      <span class="estado estado-${esc(r.estado)}">${esc(ESTADOS[r.estado] ?? r.estado)}</span>
    </header>
    <div class="suave">${fecha(r.creado_en)}${linea ? ` · Línea ${esc(linea.codigo)}` : ''}</div>
    <p>${esc(r.descripcion)}</p>
    ${r.respuesta ? `<div class="respuesta"><strong>Respuesta:</strong> ${esc(r.respuesta)}</div>` : ''}
    ${admin ? `
      <form class="gestion" data-id="${r.id}">
        <select name="estado">${Object.entries(ESTADOS).map(([v, t]) => `<option value="${v}" ${v === r.estado ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input name="respuesta" placeholder="Respuesta al pasajero" value="${esc(r.respuesta ?? '')}">
        <button class="boton chico" type="submit">Guardar</button>
      </form>` : ''}`;
  if (r.tiene_foto) {
    api.fotoReclamo(r).then((src) => {
      if (!src) return;
      const img = document.createElement('img');
      img.src = src;
      img.alt = `Foto del reclamo #${r.id}`;
      div.querySelector('p').after(img);
    });
  }
  return div;
}

async function pintarReclamos(contenedor, reclamos, admin) {
  contenedor.replaceChildren();
  if (!reclamos.length) {
    contenedor.innerHTML = '<p class="suave">No hay reclamos.</p>';
    return;
  }
  for (const r of reclamos) contenedor.append(await tarjetaReclamo(r, admin));
}

async function renderReclamos() {
  if (!usuario()) return;
  const selLinea = $('#reclamo-linea');
  const elegida = selLinea.value;
  selLinea.innerHTML = opcionesLineas();
  selLinea.value = elegida;
  await intentar(async () => pintarReclamos($('#lista-reclamos'), await api.reclamos(), false));
}

$('#reclamo-linea').addEventListener('change', (e) => {
  const id = e.target.value;
  const sel = $('#reclamo-colectivo');
  sel.innerHTML = '<option value="">—</option>';
  if (id) {
    intentar(async () => {
      sel.innerHTML += (await api.colectivos(id)).map((c) => `<option value="${c.id}">Interno ${esc(c.interno)}</option>`).join('');
    });
  }
});

$('#form-reclamo').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const datos = Object.fromEntries(new FormData(form));
  intentar(async () => {
    await api.crearReclamo({ ...datos, foto: form.foto.files[0] || null });
    form.reset();
    $('#reclamo-colectivo').innerHTML = '<option value="">—</option>';
    toast('Reclamo enviado. ¡Gracias por ayudarnos a mejorar!');
    renderReclamos();
  }, form.querySelector('button'));
});

// ---------- SUBE ----------
async function renderSube() {
  const u = usuario();
  if (!u) return;
  const cont = $('#contenido-sube');
  if (!u.tarjeta_sube) {
    cont.innerHTML = `
      <form class="tarjeta" id="form-sube" style="max-width:420px">
        <h2>Vincular tarjeta</h2>
        <label>Número de tarjeta (16 dígitos)
          <input name="numero" inputmode="numeric" autocomplete="off" placeholder="6061 2680 1234 5678" required>
        </label>
        <button class="boton" type="submit">Vincular</button>
        ${api.modo === 'demo' ? '<p class="suave">En modo demo el saldo y los viajes son simulados.</p>' : ''}
      </form>`;
    $('#form-sube').addEventListener('submit', (e) => {
      e.preventDefault();
      intentar(async () => {
        await api.vincularSube(e.target.numero.value);
        toast('Tarjeta vinculada');
        renderSube();
      }, e.target.querySelector('button'));
    });
    return;
  }
  cont.innerHTML = '<p class="suave">Consultando SUBE…</p>';
  await intentar(async () => {
    const [saldo, { viajes }] = await Promise.all([api.saldo(), api.viajes(10)]);
    cont.innerHTML = `
      <div class="columnas">
        <div class="tarjeta">
          <div class="suave">Tarjeta ${esc(saldo.tarjeta)}</div>
          <div class="saldo ${saldo.saldo < 0 ? 'negativo' : ''}">${pesos(saldo.saldo)}</div>
          <div class="suave">Actualizado ${fecha(saldo.actualizado_en)}</div>
          <p><button class="boton secundario chico" id="btn-desvincular">Desvincular tarjeta</button></p>
        </div>
        <div class="tarjeta">
          <h2>Últimos viajes</h2>
          <ul class="lista">${viajes.map((v) => `<li><span>Línea <strong>${esc(v.linea)}</strong><br><span class="suave">${fecha(v.fecha)}</span></span><span>${pesos(v.monto)}</span></li>`).join('')}</ul>
        </div>
      </div>`;
    $('#btn-desvincular').addEventListener('click', (e) =>
      intentar(async () => {
        await api.desvincularSube();
        renderSube();
      }, e.target)
    );
  });
}

// ---------- Admin ----------
async function renderAdmin() {
  if (usuario()?.rol !== 'admin') return;
  const sel = $('#desvio-linea');
  const elegida = sel.value;
  sel.innerHTML = opcionesLineas(false);
  if (elegida) sel.value = elegida;

  await intentar(async () => {
    const desvios = await api.desvios();
    $('#admin-desvios').innerHTML = desvios.length
      ? `<ul class="lista">${desvios
          .map((d) => `<li><span><strong>${esc(d.linea_codigo)}</strong> · ${esc(d.titulo)}<br><span class="suave">${d.origen === 'automatico' ? 'Automático' : 'Manual'} · ${fecha(d.creado_en)}</span></span>
            <button type="button" class="boton peligro chico" data-finalizar="${d.id}">Finalizar</button></li>`)
          .join('')}</ul>`
      : '<p class="suave">No hay desvíos activos.</p>';

    const filtro = $('#filtro-estado').value;
    const reclamos = (await api.reclamos()).filter((r) => !filtro || r.estado === filtro);
    await pintarReclamos($('#admin-reclamos'), reclamos, true);
  });
}

$('#form-desvio').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  intentar(async () => {
    await api.crearDesvio(Object.fromEntries(new FormData(form)));
    form.titulo.value = '';
    form.descripcion.value = '';
    toast('Desvío publicado');
    await refrescarLineas();
    renderAdmin();
  }, form.querySelector('button[type=submit]'));
});

$('#admin-desvios').addEventListener('click', (e) => {
  const id = e.target.dataset.finalizar;
  if (!id) return;
  intentar(async () => {
    await api.finalizarDesvio(id);
    await refrescarLineas();
    renderAdmin();
  }, e.target);
});

$('#filtro-estado').addEventListener('change', renderAdmin);

$('#admin-reclamos').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  intentar(async () => {
    await api.actualizarReclamo(form.dataset.id, { estado: form.estado.value, respuesta: form.respuesta.value.trim() || undefined });
    toast(`Reclamo #${form.dataset.id} actualizado`);
    renderAdmin();
  }, form.querySelector('button'));
});

// ---------- Cuenta ----------
function renderCuenta(pestana = 'login') {
  const u = usuario();
  const cont = $('#contenido-cuenta');
  if (u) {
    cont.innerHTML = `
      <div class="tarjeta cuenta">
        <h1>${esc(u.nombre)}</h1>
        <p class="suave">${esc(u.email)} · rol: ${esc(u.rol)}</p>
        <p class="suave">Líneas con alertas: ${[...estado.suscripciones].map((id) => esc(estado.lineas.find((l) => l.id === id)?.codigo)).join(', ') || 'ninguna'}</p>
        <button class="boton secundario ancho" id="btn-salir">Cerrar sesión</button>
      </div>`;
    $('#btn-salir').addEventListener('click', async () => {
      api.salir();
      await cargarSuscripciones();
      actualizarSesion();
      location.hash = '#mapa';
    });
    return;
  }
  const esLogin = pestana === 'login';
  cont.innerHTML = `
    <div class="tarjeta cuenta">
      <div class="pestanas">
        <button data-pestana="login" class="${esLogin ? 'activo' : ''}">Ingresar</button>
        <button data-pestana="registro" class="${esLogin ? '' : 'activo'}">Crear cuenta</button>
      </div>
      <form id="form-cuenta">
        ${esLogin ? '' : '<label>Nombre <input name="nombre" required minlength="2" autocomplete="name"></label>'}
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Contraseña <input name="password" type="password" required minlength="${esLogin ? 1 : 6}" autocomplete="${esLogin ? 'current-password' : 'new-password'}"></label>
        <button class="boton ancho" type="submit">${esLogin ? 'Ingresar' : 'Crear cuenta'}</button>
      </form>
      ${api.modo === 'demo' ? `
        <div class="credenciales">
          <strong>Cuentas de prueba</strong> (tocá para completar):<br>
          <code data-email="pasajero@pilarbus.local" data-pass="pasajero123">pasajero@pilarbus.local / pasajero123</code><br>
          <code data-email="admin@pilarbus.local" data-pass="admin123">admin@pilarbus.local / admin123</code>
        </div>` : ''}
    </div>`;

  $$('[data-pestana]', cont).forEach((b) => b.addEventListener('click', () => renderCuenta(b.dataset.pestana)));
  $$('[data-email]', cont).forEach((c) =>
    c.addEventListener('click', () => {
      if (!esLogin) return renderCuenta('login');
      $('#form-cuenta').email.value = c.dataset.email;
      $('#form-cuenta').password.value = c.dataset.pass;
    })
  );
  $('#form-cuenta').addEventListener('submit', (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target));
    intentar(async () => {
      const u = esLogin ? await api.login(datos) : await api.registro(datos);
      toast(`¡Hola, ${u.nombre.split(' ')[0]}!`);
      await cargarSuscripciones();
      actualizarSesion();
      location.hash = '#mapa';
      navegar();
    }, e.target.querySelector('button'));
  });
}

// ---------- Arranque ----------
async function iniciar() {
  $('#aviso-demo').hidden = api.modo !== 'demo';
  await api.iniciar();
  await refrescarLineas();
  await cargarSuscripciones().catch(() => {});
  actualizarSesion();
  const guardada = Number(localStorage.getItem('pilarbus-linea'));
  const inicial = estado.lineas.find((l) => l.id === guardada) ?? estado.lineas[0];
  if (inicial) await seleccionarLinea(inicial.id);
  window.addEventListener('hashchange', navegar);
  navegar();
}

iniciar().catch((err) => {
  console.error(err);
  toast(`No se pudo iniciar PilarBus: ${err.message}`, 'error');
});

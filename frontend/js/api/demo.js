// Implementación del backend dentro del navegador (modo demo para GitHub Pages).
// Expone la misma interfaz que remoto.js; los datos se guardan en localStorage
// y los colectivos se simulan recorriendo sus líneas.
import { LINEAS, USUARIOS } from './datos-demo.js';
import { distanciaMetros, distanciaARecorrido } from '../geo.js';

const CLAVE = 'pilarbus-demo-v1';
const UMBRAL_DESVIO_M = 300;
const REPORTES_DESVIO = 3;
const INTERVALO_MS = 2000;
const PASOS_POR_TRAMO = 15;
const VELOCIDAD_PROMEDIO_KMH = 20;

export class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// --- Datos fijos: líneas, paradas y colectivos ---
const lineas = [];
const paradas = new Map();
const colectivos = new Map();
{
  let idParada = 1;
  let idColectivo = 1;
  LINEAS.forEach((l, i) => {
    const id = i + 1;
    const ps = l.paradas.map(([nombre, lat, lng], j) => ({ id: idParada++, linea_id: id, nombre, lat, lng, orden: j + 1 }));
    ps.forEach((p) => paradas.set(p.id, p));
    lineas.push({ id, codigo: l.codigo, nombre: l.nombre, color: l.color, activa: true, paradas: ps });
    for (const [interno, patente] of l.colectivos) {
      colectivos.set(idColectivo, { id: idColectivo++, interno, patente, linea_id: id, activo: true, posicion: null });
    }
  });
}

// --- Estado persistente ---
let db;

function guardar() {
  localStorage.setItem(CLAVE, JSON.stringify(db));
}

async function hashPassword(password) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pilarbus:${password}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cargar() {
  try {
    db = JSON.parse(localStorage.getItem(CLAVE));
  } catch {
    db = null;
  }
  if (!db) {
    db = { usuarios: [], reclamos: [], desvios: [], suscripciones: [], sesion: null, sig: { usuario: 1, reclamo: 1, desvio: 1 } };
    for (const u of USUARIOS) {
      db.usuarios.push({ id: db.sig.usuario++, nombre: u.nombre, email: u.email, rol: u.rol, hash: await hashPassword(u.password), numero_sube: null });
    }
  }
  // La simulación arranca de cero: se cierran los desvíos automáticos que quedaron abiertos
  for (const d of db.desvios) {
    if (d.origen === 'automatico' && d.activo) Object.assign(d, { activo: false, finalizado_en: ahora() });
  }
  guardar();
}

const ahora = () => new Date().toISOString();

// --- Eventos en tiempo real ---
const eventos = new EventTarget();
let lineasSeguidas = new Set();

function emitir(lineaId, evento, datos) {
  if (lineasSeguidas.has(lineaId)) eventos.dispatchEvent(new CustomEvent(evento, { detail: datos }));
}

// --- Helpers ---
function usuarioActual() {
  return db.usuarios.find((u) => u.id === db.sesion) || null;
}

function requiereAuth() {
  const u = usuarioActual();
  if (!u) throw new ErrorApi(401, 'Tenés que iniciar sesión');
  return u;
}

function requiereAdmin() {
  const u = requiereAuth();
  if (u.rol !== 'admin') throw new ErrorApi(403, 'No tenés permisos para esta acción');
  return u;
}

const enmascarar = (n) => `${'*'.repeat(12)}${n.slice(-4)}`;

function publico(u) {
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, tarjeta_sube: u.numero_sube ? enmascarar(u.numero_sube) : null };
}

function obtenerLinea(id) {
  const l = lineas.find((x) => x.id === Number(id));
  if (!l) throw new ErrorApi(404, 'Línea no encontrada');
  return l;
}

function formatearColectivo(c) {
  const enServicio = Boolean(c.posicion && Date.now() - Date.parse(c.posicion.actualizado_en) < 5 * 60_000);
  return { id: c.id, interno: c.interno, patente: c.patente, linea_id: c.linea_id, activo: true, en_servicio: enServicio, posicion: c.posicion };
}

function formatearDesvio(d) {
  return {
    ...d,
    linea_codigo: obtenerLinea(d.linea_id).codigo,
    colectivo_interno: d.colectivo_id ? colectivos.get(d.colectivo_id).interno : null,
  };
}

function formatearReclamo(r) {
  const { foto, ...resto } = r;
  return { ...resto, tiene_foto: Boolean(foto), foto_url: foto ? `demo:${r.id}` : null };
}

// --- Desvíos ---
function crearDesvioInterno(datos) {
  const d = {
    id: db.sig.desvio++,
    linea_id: datos.linea_id,
    colectivo_id: datos.colectivo_id ?? null,
    titulo: datos.titulo,
    descripcion: datos.descripcion ?? null,
    origen: datos.origen,
    lat: datos.lat ?? null,
    lng: datos.lng ?? null,
    activo: true,
    creado_por: datos.creado_por ?? null,
    creado_en: ahora(),
    finalizado_en: null,
  };
  db.desvios.push(d);
  guardar();
  const f = formatearDesvio(d);
  emitir(d.linea_id, 'desvio:nuevo', f);
  return f;
}

function finalizarDesvioInterno(id) {
  const d = db.desvios.find((x) => x.id === Number(id));
  if (!d) throw new ErrorApi(404, 'Desvío no encontrado');
  if (!d.activo) throw new ErrorApi(409, 'El desvío ya estaba finalizado');
  Object.assign(d, { activo: false, finalizado_en: ahora() });
  guardar();
  const f = formatearDesvio(d);
  emitir(d.linea_id, 'desvio:finalizado', f);
  return f;
}

// --- Simulación de GPS ---
const simulacion = new Map(); // colectivoId -> { puntos, paso, fuera, forzarDesvio }

function trayecto(ps) {
  const ida = [...ps, ...ps.slice(0, -1).reverse()];
  const puntos = [];
  for (let i = 0; i < ida.length - 1; i++) {
    for (let p = 0; p < PASOS_POR_TRAMO; p++) {
      const t = p / PASOS_POR_TRAMO;
      puntos.push({ lat: ida[i].lat + (ida[i + 1].lat - ida[i].lat) * t, lng: ida[i].lng + (ida[i + 1].lng - ida[i].lng) * t });
    }
  }
  return puntos;
}

function rumbo(a, b) {
  const y = Math.sin((b.lng - a.lng) * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180));
  const x = Math.cos(a.lat * (Math.PI / 180)) * Math.sin(b.lat * (Math.PI / 180)) -
    Math.sin(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * Math.cos((b.lng - a.lng) * (Math.PI / 180));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

function iniciarSimulacion() {
  for (const l of lineas) {
    const puntos = trayecto(l.paradas);
    const propios = [...colectivos.values()].filter((c) => c.linea_id === l.id);
    propios.forEach((c, i) => {
      simulacion.set(c.id, { puntos, paso: Math.floor((i * puntos.length) / propios.length), fuera: 0, forzarDesvio: 0 });
    });
  }
  tick();
  setInterval(tick, INTERVALO_MS);
}

function tick() {
  for (const [id, s] of simulacion) {
    const c = colectivos.get(id);
    const punto = { ...s.puntos[s.paso % s.puntos.length] };
    const siguiente = s.puntos[(s.paso + 1) % s.puntos.length];
    if (s.forzarDesvio > 0) {
      punto.lat += 0.008; // ~900 m fuera del recorrido
      s.forzarDesvio--;
    }
    s.paso++;
    c.posicion = { lat: punto.lat, lng: punto.lng, velocidad: Math.round(20 + Math.random() * 25), rumbo: rumbo(punto, siguiente), actualizado_en: ahora() };
    emitir(c.linea_id, 'colectivo:posicion', formatearColectivo(c));
    evaluarDesvio(c, s, punto);
  }
}

function evaluarDesvio(c, s, punto) {
  const distancia = distanciaARecorrido(punto, obtenerLinea(c.linea_id).paradas);
  const activo = db.desvios.find((d) => d.colectivo_id === c.id && d.origen === 'automatico' && d.activo);
  if (distancia > UMBRAL_DESVIO_M) {
    s.fuera++;
    if (!activo && s.fuera >= REPORTES_DESVIO) {
      crearDesvioInterno({
        linea_id: c.linea_id,
        colectivo_id: c.id,
        titulo: `Interno ${c.interno} fuera de recorrido`,
        descripcion: `El colectivo se encuentra a ${Math.round(distancia)} m del recorrido habitual.`,
        origen: 'automatico',
        lat: punto.lat,
        lng: punto.lng,
      });
    }
  } else {
    s.fuera = 0;
    if (activo) finalizarDesvioInterno(activo.id);
  }
}

// --- SUBE simulada (mismo algoritmo que el adaptador mock del backend) ---
async function generador(semilla) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semilla));
  let estado = new DataView(bytes).getUint32(0, true);
  return () => {
    estado = (estado * 1664525 + 1013904223) % 2 ** 32;
    return estado / 2 ** 32;
  };
}

function tarjetaDe(u) {
  if (!u.numero_sube) throw new ErrorApi(404, 'No tenés una tarjeta SUBE vinculada');
  return u.numero_sube;
}

// Achica la foto para que entre en localStorage
function comprimirImagen(archivo, maximo = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maximo / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ErrorApi(400, 'No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

// --- Interfaz pública ---
export const api = {
  modo: 'demo',

  async iniciar() {
    await cargar();
    iniciarSimulacion();
  },

  usuario() {
    const u = usuarioActual();
    return u ? publico(u) : null;
  },

  async registro({ nombre, email, password }) {
    email = email.trim().toLowerCase();
    if (nombre.trim().length < 2) throw new ErrorApi(400, 'El nombre es muy corto');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ErrorApi(400, 'Email inválido');
    if (password.length < 6) throw new ErrorApi(400, 'La contraseña debe tener al menos 6 caracteres');
    if (db.usuarios.some((u) => u.email === email)) throw new ErrorApi(409, 'Ya existe una cuenta con ese email');
    const u = { id: db.sig.usuario++, nombre: nombre.trim(), email, rol: 'pasajero', hash: await hashPassword(password), numero_sube: null };
    db.usuarios.push(u);
    db.sesion = u.id;
    guardar();
    return publico(u);
  },

  async login({ email, password }) {
    const u = db.usuarios.find((x) => x.email === email.trim().toLowerCase());
    if (!u || u.hash !== (await hashPassword(password))) throw new ErrorApi(401, 'Email o contraseña incorrectos');
    db.sesion = u.id;
    guardar();
    return publico(u);
  },

  salir() {
    db.sesion = null;
    guardar();
  },

  async lineas() {
    return lineas.map(({ paradas: _, ...l }) => ({
      ...l,
      colectivos: [...colectivos.values()].filter((c) => c.linea_id === l.id).length,
      desvios_activos: db.desvios.filter((d) => d.linea_id === l.id && d.activo).length,
    }));
  },

  async linea(id) {
    return structuredClone(obtenerLinea(id));
  },

  async colectivos(lineaId) {
    obtenerLinea(lineaId);
    return [...colectivos.values()].filter((c) => c.linea_id === Number(lineaId)).map(formatearColectivo);
  },

  async arribos(lineaId, paradaId) {
    const parada = paradas.get(Number(paradaId));
    if (!parada || parada.linea_id !== Number(lineaId)) throw new ErrorApi(404, 'Parada no encontrada');
    const arribos = (await this.colectivos(lineaId))
      .filter((c) => c.en_servicio)
      .map((c) => {
        const distancia = distanciaMetros(c.posicion, parada);
        const velocidad = c.posicion.velocidad > 5 ? c.posicion.velocidad : VELOCIDAD_PROMEDIO_KMH;
        return { colectivo: c, distancia_metros: Math.round(distancia), minutos_estimados: Math.max(1, Math.round(distancia / ((velocidad * 1000) / 60))) };
      })
      .sort((a, b) => a.distancia_metros - b.distancia_metros);
    return { parada, arribos };
  },

  async desvios(lineaId) {
    return db.desvios
      .filter((d) => d.activo && (!lineaId || d.linea_id === Number(lineaId)))
      .sort((a, b) => b.id - a.id)
      .map(formatearDesvio);
  },

  async crearDesvio({ linea_id, titulo, descripcion }) {
    const admin = requiereAdmin();
    obtenerLinea(linea_id);
    if (!titulo || titulo.trim().length < 3) throw new ErrorApi(400, 'El título es muy corto');
    return crearDesvioInterno({ linea_id: Number(linea_id), titulo: titulo.trim(), descripcion: descripcion?.trim() || null, origen: 'manual', creado_por: admin.id });
  },

  async finalizarDesvio(id) {
    requiereAdmin();
    return finalizarDesvioInterno(id);
  },

  async suscripciones() {
    const u = requiereAuth();
    return db.suscripciones
      .filter((s) => s.usuario_id === u.id)
      .map((s) => {
        const { paradas: _, ...l } = obtenerLinea(s.linea_id);
        return { ...l, suscripto_en: s.creado_en };
      });
  },

  async suscribir(lineaId) {
    const u = requiereAuth();
    obtenerLinea(lineaId);
    if (!db.suscripciones.some((s) => s.usuario_id === u.id && s.linea_id === Number(lineaId))) {
      db.suscripciones.push({ usuario_id: u.id, linea_id: Number(lineaId), creado_en: ahora() });
      guardar();
    }
    return this.suscripciones();
  },

  async desuscribir(lineaId) {
    const u = requiereAuth();
    db.suscripciones = db.suscripciones.filter((s) => !(s.usuario_id === u.id && s.linea_id === Number(lineaId)));
    guardar();
  },

  async reclamos() {
    const u = requiereAuth();
    return db.reclamos
      .filter((r) => u.rol === 'admin' || r.usuario_id === u.id)
      .sort((a, b) => b.id - a.id)
      .map(formatearReclamo);
  },

  async crearReclamo({ categoria, descripcion, linea_id, colectivo_id, foto }) {
    const u = requiereAuth();
    if (!descripcion || descripcion.trim().length < 10) throw new ErrorApi(400, 'La descripción debe tener al menos 10 caracteres');
    let lineaId = linea_id ? obtenerLinea(linea_id).id : null;
    let colectivoId = null;
    if (colectivo_id) {
      const c = colectivos.get(Number(colectivo_id));
      if (!c) throw new ErrorApi(404, 'Colectivo no encontrado');
      colectivoId = c.id;
      lineaId ??= c.linea_id;
    }
    if (foto && !['image/jpeg', 'image/png', 'image/webp'].includes(foto.type)) {
      throw new ErrorApi(400, 'La foto debe ser JPG, PNG o WEBP');
    }
    const r = {
      id: db.sig.reclamo++,
      usuario_id: u.id,
      linea_id: lineaId,
      colectivo_id: colectivoId,
      categoria,
      descripcion: descripcion.trim(),
      foto: foto ? await comprimirImagen(foto) : null,
      estado: 'pendiente',
      respuesta: null,
      creado_en: ahora(),
      actualizado_en: ahora(),
    };
    db.reclamos.push(r);
    try {
      guardar();
    } catch {
      db.reclamos.pop();
      throw new ErrorApi(507, 'No hay espacio en el navegador para guardar la foto');
    }
    return formatearReclamo(r);
  },

  async actualizarReclamo(id, { estado, respuesta }) {
    requiereAdmin();
    const r = db.reclamos.find((x) => x.id === Number(id));
    if (!r) throw new ErrorApi(404, 'Reclamo no encontrado');
    if (estado) r.estado = estado;
    if (respuesta !== undefined) r.respuesta = respuesta;
    r.actualizado_en = ahora();
    guardar();
    return formatearReclamo(r);
  },

  async fotoReclamo(reclamo) {
    return db.reclamos.find((r) => r.id === reclamo.id)?.foto ?? null;
  },

  async vincularSube(numero) {
    const u = requiereAuth();
    const limpio = String(numero).replace(/\D/g, '');
    if (limpio.length !== 16) throw new ErrorApi(400, 'El número de tarjeta SUBE debe tener 16 dígitos');
    db.usuarios.find((x) => x.id === u.id).numero_sube = limpio;
    guardar();
    return { tarjeta: enmascarar(limpio) };
  },

  async desvincularSube() {
    requiereAuth().numero_sube = null;
    guardar();
  },

  async saldo() {
    const numero = tarjetaDe(requiereAuth());
    const rnd = await generador(numero);
    return { tarjeta: enmascarar(numero), saldo: Math.round((rnd() * 9000 - 500) * 100) / 100, moneda: 'ARS', actualizado_en: ahora() };
  },

  async viajes(limite = 10) {
    const numero = tarjetaDe(requiereAuth());
    const rnd = await generador(`${numero}:viajes`);
    const codigos = ['P1', 'P2', 'P3', '57', '276', '503'];
    const viajes = [];
    let fecha = Date.now();
    for (let i = 0; i < limite; i++) {
      fecha -= Math.floor(rnd() * 36 + 2) * 3_600_000;
      viajes.push({ fecha: new Date(fecha).toISOString(), linea: codigos[Math.floor(rnd() * codigos.length)], monto: Math.round((800 + rnd() * 600) * 100) / 100 });
    }
    return { tarjeta: enmascarar(numero), viajes };
  },

  // Tiempo real: recibir eventos solo de estas líneas
  seguirLineas(ids) {
    lineasSeguidas = new Set(ids.map(Number));
  },

  on(evento, cb) {
    eventos.addEventListener(evento, (e) => cb(e.detail));
  },

  // Solo demo: saca de recorrido al primer colectivo de la línea para mostrar la alerta automática
  simularDesvio(lineaId) {
    const c = [...colectivos.values()].find((x) => x.linea_id === Number(lineaId));
    simulacion.get(c.id).forzarDesvio = 8;
    return c.interno;
  },
};

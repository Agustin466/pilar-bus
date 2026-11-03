// Cliente del backend real (backend/). Misma interfaz que demo.js.
import { API_URL } from '../config.js';

const CLAVE_TOKEN = 'pilarbus-token';

export class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

let usuario = null;
let socket = null;
let lineasSeguidas = new Set();
const oyentes = [];

async function pedir(metodo, ruta, cuerpo) {
  const token = localStorage.getItem(CLAVE_TOKEN);
  const esForm = cuerpo instanceof FormData;
  let res;
  try {
    res = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo && !esForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: esForm ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor');
  }
  if (res.status === 204) return null;
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      localStorage.removeItem(CLAVE_TOKEN);
      usuario = null;
    }
    const detalle = datos.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(', ');
    throw new ErrorApi(res.status, [datos.error, detalle].filter(Boolean).join(' — ') || `Error ${res.status}`);
  }
  return datos;
}

function sesion({ token, usuario: u }) {
  localStorage.setItem(CLAVE_TOKEN, token);
  usuario = u;
  conectarSocket();
  return u;
}

// El cliente de Socket.IO lo sirve el propio backend
function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

async function conectarSocket() {
  if (!window.io) await cargarScript(`${API_URL}/socket.io/socket.io.js`);
  socket?.disconnect();
  socket = window.io(API_URL, { auth: { token: localStorage.getItem(CLAVE_TOKEN) } });
  socket.on('connect', () => lineasSeguidas.forEach((id) => socket.emit('linea:suscribir', id)));
  for (const [evento, cb] of oyentes) socket.on(evento, cb);
}

export const api = {
  modo: 'remoto',

  async iniciar() {
    if (localStorage.getItem(CLAVE_TOKEN)) {
      usuario = await pedir('GET', '/api/auth/yo').catch(() => null);
    }
    await conectarSocket().catch(() => console.warn('Sin conexión en tiempo real'));
  },

  usuario: () => usuario,
  registro: (datos) => pedir('POST', '/api/auth/registro', datos).then(sesion),
  login: (datos) => pedir('POST', '/api/auth/login', datos).then(sesion),
  salir() {
    localStorage.removeItem(CLAVE_TOKEN);
    usuario = null;
    conectarSocket().catch(() => {});
  },

  lineas: () => pedir('GET', '/api/lineas'),
  linea: (id) => pedir('GET', `/api/lineas/${id}`),
  colectivos: (lineaId) => pedir('GET', `/api/lineas/${lineaId}/colectivos`),
  arribos: (lineaId, paradaId) => pedir('GET', `/api/lineas/${lineaId}/paradas/${paradaId}/arribos`),

  desvios: (lineaId) => pedir('GET', `/api/desvios${lineaId ? `?linea=${lineaId}` : ''}`),
  crearDesvio: ({ linea_id, titulo, descripcion }) =>
    pedir('POST', '/api/desvios', { linea_id: Number(linea_id), titulo, descripcion: descripcion || null }),
  finalizarDesvio: (id) => pedir('PATCH', `/api/desvios/${id}/finalizar`),

  suscripciones: () => pedir('GET', '/api/suscripciones'),
  suscribir: (lineaId) => pedir('PUT', `/api/suscripciones/${lineaId}`),
  desuscribir: (lineaId) => pedir('DELETE', `/api/suscripciones/${lineaId}`),

  reclamos: () => pedir('GET', '/api/reclamos'),
  crearReclamo({ categoria, descripcion, linea_id, colectivo_id, foto }) {
    const form = new FormData();
    form.append('categoria', categoria);
    form.append('descripcion', descripcion);
    if (linea_id) form.append('linea_id', linea_id);
    if (colectivo_id) form.append('colectivo_id', colectivo_id);
    if (foto) form.append('foto', foto);
    return pedir('POST', '/api/reclamos', form);
  },
  actualizarReclamo: (id, datos) => pedir('PATCH', `/api/reclamos/${id}`, datos),
  async fotoReclamo(reclamo) {
    if (!reclamo.foto_url) return null;
    const res = await fetch(`${API_URL}${reclamo.foto_url}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(CLAVE_TOKEN)}` },
    });
    return res.ok ? URL.createObjectURL(await res.blob()) : null;
  },

  async vincularSube(numero) {
    const r = await pedir('PUT', '/api/sube/tarjeta', { numero });
    usuario = { ...usuario, tarjeta_sube: r.tarjeta };
    return r;
  },
  async desvincularSube() {
    await pedir('DELETE', '/api/sube/tarjeta');
    usuario = { ...usuario, tarjeta_sube: null };
  },
  saldo: () => pedir('GET', '/api/sube/saldo'),
  viajes: (limite = 10) => pedir('GET', `/api/sube/viajes?limite=${limite}`),

  seguirLineas(ids) {
    const nuevas = new Set(ids.map(Number));
    for (const id of lineasSeguidas) if (!nuevas.has(id)) socket?.emit('linea:desuscribir', id);
    for (const id of nuevas) if (!lineasSeguidas.has(id)) socket?.emit('linea:suscribir', id);
    lineasSeguidas = nuevas;
  },

  on(evento, cb) {
    oyentes.push([evento, cb]);
    socket?.on(evento, cb);
  },
};

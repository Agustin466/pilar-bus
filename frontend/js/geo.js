// Utilidades geográficas (mismo cálculo que backend/src/services/geo.js)
const RADIO_TIERRA_M = 6371000;
const rad = (g) => (g * Math.PI) / 180;

export function distanciaMetros(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

function distanciaASegmento(p, a, b) {
  const cosLat = Math.cos(rad(p.lat));
  const aX = (a.lng - p.lng) * cosLat;
  const aY = a.lat - p.lat;
  const dx = (b.lng - p.lng) * cosLat - aX;
  const dy = b.lat - p.lat - aY;
  const largo2 = dx * dx + dy * dy;
  const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, -(aX * dx + aY * dy) / largo2));
  return rad(Math.hypot(aX + t * dx, aY + t * dy)) * RADIO_TIERRA_M;
}

export function distanciaARecorrido(punto, recorrido) {
  if (recorrido.length === 0) return Infinity;
  if (recorrido.length === 1) return distanciaMetros(punto, recorrido[0]);
  let minimo = Infinity;
  for (let i = 0; i < recorrido.length - 1; i++) {
    minimo = Math.min(minimo, distanciaASegmento(punto, recorrido[i], recorrido[i + 1]));
  }
  return minimo;
}

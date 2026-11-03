// Datos de ejemplo del modo demo (los mismos que backend/src/db/seed.js)
export const USUARIOS = [
  { nombre: 'Administración PilarBus', email: 'admin@pilarbus.local', password: 'admin123', rol: 'admin' },
  { nombre: 'Chofer de prueba', email: 'chofer@pilarbus.local', password: 'chofer123', rol: 'chofer' },
  { nombre: 'Pasajero beta', email: 'pasajero@pilarbus.local', password: 'pasajero123', rol: 'pasajero' },
];

export const LINEAS = [
  {
    codigo: 'P1',
    nombre: 'Pilar Centro - Presidente Derqui',
    color: '#1565C0',
    paradas: [
      ['Estación Pilar', -34.4597, -58.913],
      ['Plaza 12 de Octubre', -34.4585, -58.9135],
      ['Hospital Sanguinetti', -34.465, -58.905],
      ['Universidad Nacional de Pilar', -34.472, -58.893],
      ['Ruta 234 y Champagnat', -34.48, -58.878],
      ['Estación Derqui', -34.4895, -58.859],
    ],
    colectivos: [['101', 'AB123CD'], ['102', 'AC456EF']],
  },
  {
    codigo: 'P2',
    nombre: 'Pilar Centro - Del Viso',
    color: '#2E7D32',
    paradas: [
      ['Plaza 12 de Octubre', -34.4585, -58.9135],
      ['Panamericana Km 50', -34.447, -58.888],
      ['Villa Rosa', -34.44, -58.865],
      ['Ruta 26', -34.445, -58.83],
      ['Estación Del Viso', -34.4489, -58.7953],
    ],
    colectivos: [['201', 'AD789GH'], ['202', 'AE012IJ']],
  },
  {
    codigo: 'P3',
    nombre: 'Pilar Centro - Manzanares',
    color: '#EF6C00',
    paradas: [
      ['Estación Pilar', -34.4597, -58.913],
      ['Ruta 8 y Ruta 25', -34.455, -58.94],
      ['Fátima', -34.452, -58.97],
      ['Manzanares Centro', -34.45, -59.0],
    ],
    colectivos: [['301', 'AF345KL']],
  },
];

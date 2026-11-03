# PilarBus – Ecosistema Móvil de Transporte Público

Aplicación web para que los vecinos de Pilar vean el recorrido de los colectivos en tiempo real,
reciban alertas de desvíos, consulten su tarjeta SUBE y envíen reclamos.

Proyecto de la Municipalidad de Pilar junto con la Universidad Nacional de Pilar, desarrollado con
el marco ágil Scrum (Fundamentos del Desarrollo de Software y Metodologías Ágiles – Comisión 3).

**Sitio:** https://unpilar.github.io/pilar-bus/

## Estructura

| Carpeta | Contenido |
|---|---|
| [`frontend/`](frontend) | Demo publicada en GitHub Pages (HTML, CSS y JavaScript). Simula los colectivos y los datos en el navegador, sin necesidad de servidor. |
| [`backend/`](backend) | API REST + tiempo real (Node.js, Express, SQLite, Socket.IO). No está desplegado: se puede correr en local. |

> **Prototipo de demostración:** los colectivos, los desvíos y los datos de SUBE son simulados.
| [`.github/workflows/`](.github/workflows) | Publicación automática en Pages e integración continua del backend. |

## Funcionalidades

| Funcionalidad | Story Points |
|---|---|
| Recorrido de colectivos en tiempo real | – |
| Sistema de reclamos (texto o foto) | 3 |
| Alertas de desvíos | 5 |
| Integración con SUBE (saldo e historial) | 13 |

## Equipo

| Rol | Integrante |
|---|---|
| Product Owner | Agustín Castillo |
| Scrum Master | Julieta Villegas |
| Diseño UI/UX / Desarrollo Mobile | Diego Breitt |
| Desarrollo Frontend y Backend | Matías Chávez |
| Tester (QA) | Thiago Candela |

Tablero Kanban: https://trello.com/b/WRI8CErk/my-trello-board


## 🚍👥 'PilarBus' ; Ecosistema Movil de Transporte Publico 
'PilarBus' es una aplicación móvil y plataforma web desarrollada por los estudiantes de la Universidad Nacional del Pilar en conjunto con la Municipalidad para que los ciudadanos visualicen sin ninguna interrupción el recorrido de los colectivos en tiempo real, a su vez que reciba alertas de desvíos, puedan consultar sobre el saldo de su tarjeta SUBE y realizar reclamos. 



## 🛠️ Tecnologías Utilizadas

Plataforma Web (Panel Municipal y Portal de Noticias): Next.js (React Framework)

Aplicación Móvil: React Native / Flutter

Backend & API Gateway: Node.js (Express)

Base de Datos & GIS: PostgreSQL + PostGIS (y Redis para caché GPS en tiempo real)

Infraestructura & CI/CD: GitHub Actions + Docker + Vercel (para el despliegue del frontend web)


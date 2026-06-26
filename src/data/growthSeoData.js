export const popularCities = [
  { slug: 'madrid', name: 'Madrid', region: 'Comunidad de Madrid', nearby: ['barcelona', 'valencia', 'zaragoza', 'sevilla'] },
  { slug: 'barcelona', name: 'Barcelona', region: 'Catalunya', nearby: ['girona', 'tarragona', 'zaragoza', 'valencia'] },
  { slug: 'valencia', name: 'Valencia', region: 'Comunitat Valenciana', nearby: ['alicante', 'madrid', 'barcelona', 'murcia'] },
  { slug: 'sevilla', name: 'Sevilla', region: 'Andalucía', nearby: ['malaga', 'cordoba', 'granada', 'madrid'] },
  { slug: 'malaga', name: 'Málaga', region: 'Andalucía', nearby: ['sevilla', 'granada', 'cordoba', 'alicante'] },
  { slug: 'zaragoza', name: 'Zaragoza', region: 'Aragón', nearby: ['madrid', 'barcelona', 'valencia', 'bilbao'] },
  { slug: 'bilbao', name: 'Bilbao', region: 'País Vasco', nearby: ['san-sebastian', 'vitoria', 'zaragoza', 'madrid'] },
  { slug: 'alicante', name: 'Alicante', region: 'Comunitat Valenciana', nearby: ['valencia', 'murcia', 'malaga', 'barcelona'] },
  { slug: 'girona', name: 'Girona', region: 'Catalunya', nearby: ['barcelona', 'tarragona', 'lleida', 'zaragoza'] },
  { slug: 'tarragona', name: 'Tarragona', region: 'Catalunya', nearby: ['barcelona', 'girona', 'valencia', 'zaragoza'] },
  { slug: 'murcia', name: 'Murcia', region: 'Región de Murcia', nearby: ['alicante', 'valencia', 'almeria', 'malaga'] },
  { slug: 'cordoba', name: 'Córdoba', region: 'Andalucía', nearby: ['sevilla', 'malaga', 'granada', 'madrid'] },
  { slug: 'granada', name: 'Granada', region: 'Andalucía', nearby: ['malaga', 'sevilla', 'cordoba', 'almeria'] },
  { slug: 'vitoria', name: 'Vitoria-Gasteiz', region: 'País Vasco', nearby: ['bilbao', 'san-sebastian', 'zaragoza', 'madrid'] },
  { slug: 'san-sebastian', name: 'San Sebastián', region: 'País Vasco', nearby: ['bilbao', 'vitoria', 'zaragoza', 'madrid'] },
  { slug: 'lleida', name: 'Lleida', region: 'Catalunya', nearby: ['barcelona', 'tarragona', 'girona', 'zaragoza'] },
  { slug: 'almeria', name: 'Almería', region: 'Andalucía', nearby: ['granada', 'murcia', 'malaga', 'alicante'] }
];

export const popularRoutes = [
  { origin: 'barcelona', destination: 'madrid', distanceKm: 620, angle: 'larga distancia', demand: 'alta' },
  { origin: 'madrid', destination: 'valencia', distanceKm: 355, angle: 'fin de semana y trabajo', demand: 'alta' },
  { origin: 'sevilla', destination: 'malaga', distanceKm: 205, angle: 'Andalucía occidental', demand: 'media-alta' },
  { origin: 'zaragoza', destination: 'barcelona', distanceKm: 315, angle: 'corredor noreste', demand: 'media-alta' },
  { origin: 'girona', destination: 'barcelona', distanceKm: 100, angle: 'trayecto diario y aeropuerto', demand: 'alta' },
  { origin: 'tarragona', destination: 'barcelona', distanceKm: 100, angle: 'trabajo y estudios', demand: 'alta' },
  { origin: 'bilbao', destination: 'san-sebastian', distanceKm: 100, angle: 'País Vasco', demand: 'media' },
  { origin: 'valencia', destination: 'alicante', distanceKm: 170, angle: 'costa mediterránea', demand: 'media-alta' },
  { origin: 'madrid', destination: 'zaragoza', distanceKm: 320, angle: 'corredor centro-noreste', demand: 'media' },
  { origin: 'malaga', destination: 'granada', distanceKm: 125, angle: 'Andalucía oriental', demand: 'media' },
  { origin: 'murcia', destination: 'alicante', distanceKm: 80, angle: 'trayecto regional', demand: 'media' },
  { origin: 'barcelona', destination: 'valencia', distanceKm: 350, angle: 'corredor mediterráneo', demand: 'alta' }
];

export const airportPages = [
  { slug: 'aeropuerto-barcelona-el-prat', name: 'Aeropuerto Barcelona-El Prat', city: 'barcelona' },
  { slug: 'aeropuerto-madrid-barajas', name: 'Aeropuerto Madrid-Barajas', city: 'madrid' },
  { slug: 'aeropuerto-girona-costa-brava', name: 'Aeropuerto Girona-Costa Brava', city: 'girona' },
  { slug: 'aeropuerto-malaga-costa-del-sol', name: 'Aeropuerto Málaga-Costa del Sol', city: 'malaga' },
  { slug: 'aeropuerto-alicante-elche', name: 'Aeropuerto Alicante-Elche', city: 'alicante' },
  { slug: 'aeropuerto-valencia', name: 'Aeropuerto de Valencia', city: 'valencia' }
];

export const findCity = (slug) => popularCities.find((city) => city.slug === slug);
export const findRoute = (origin, destination) => popularRoutes.find((route) => route.origin === origin && route.destination === destination);

export const routeToPath = ({ origin, destination }) => `/rutas/${origin}/${destination}/`;
export const cityToPath = ({ slug }) => `/ciudades/${slug}/`;
export const airportToPath = ({ slug }) => `/aeropuertos/${slug}/`;

export const seoFaqs = [
  ['¿Es legal compartir coche en España?', 'Compartir gastos de trayecto entre particulares es una práctica habitual siempre que no se convierta en una actividad profesional de transporte. ShareWay está orientado a coordinar trayectos compatibles y repartir costes.'],
  ['¿Cómo se calcula el ahorro?', 'El ahorro depende de la distancia, número de pasajeros, combustible, peajes y gastos acordados entre usuarios. En rutas frecuentes puede reducir una parte importante del coste individual.'],
  ['¿ShareWay sirve para ir al trabajo?', 'Sí. Las rutas recurrentes al trabajo, polígonos, hospitales, universidades y estaciones son uno de los casos de uso principales.'],
  ['¿Puedo compartir trayectos al aeropuerto?', 'Sí. ShareWay permite coordinar horarios compatibles para aeropuertos y dividir el coste del desplazamiento.']
];

export const popularCities = [
  { slug: 'madrid', name: 'Madrid', region: 'Comunidad de Madrid', nearby: ['barcelona', 'valencia', 'zaragoza', 'sevilla'] },
  { slug: 'barcelona', name: 'Barcelona', region: 'Catalunya', nearby: ['girona', 'tarragona', 'mataro', 'badalona', 'sabadell', 'terrassa'] },
  { slug: 'girona', name: 'Girona', region: 'Catalunya', nearby: ['barcelona', 'tarragona', 'lleida', 'figueres', 'lloret-de-mar'] },
  { slug: 'tarragona', name: 'Tarragona', region: 'Catalunya', nearby: ['barcelona', 'girona', 'lleida', 'reus', 'salou'] },
  { slug: 'lleida', name: 'Lleida', region: 'Catalunya', nearby: ['barcelona', 'tarragona', 'girona', 'zaragoza'] },
  { slug: 'mataro', name: 'Mataró', region: 'Maresme, Catalunya', nearby: ['barcelona', 'badalona', 'premia-de-mar', 'vilassar-de-mar', 'arenys-de-mar'] },
  { slug: 'badalona', name: 'Badalona', region: 'Barcelona, Catalunya', nearby: ['barcelona', 'mataro', 'santa-coloma-de-gramenet', 'montgat'] },
  { slug: 'sabadell', name: 'Sabadell', region: 'Vallès Occidental, Catalunya', nearby: ['barcelona', 'terrassa', 'granollers', 'mataro'] },
  { slug: 'terrassa', name: 'Terrassa', region: 'Vallès Occidental, Catalunya', nearby: ['barcelona', 'sabadell', 'manresa', 'granollers'] },
  { slug: 'granollers', name: 'Granollers', region: 'Vallès Oriental, Catalunya', nearby: ['barcelona', 'mataro', 'sabadell', 'vic'] },
  { slug: 'vic', name: 'Vic', region: 'Osona, Catalunya', nearby: ['barcelona', 'granollers', 'girona', 'manresa'] },
  { slug: 'manresa', name: 'Manresa', region: 'Bages, Catalunya', nearby: ['barcelona', 'terrassa', 'vic', 'lleida'] },
  { slug: 'pineda-de-mar', name: 'Pineda de Mar', region: 'Maresme, Catalunya', nearby: ['calella', 'santa-susanna', 'malgrat-de-mar', 'mataro', 'barcelona'] },
  { slug: 'malgrat-de-mar', name: 'Malgrat de Mar', region: 'Maresme, Catalunya', nearby: ['pineda-de-mar', 'santa-susanna', 'blanes', 'lloret-de-mar', 'barcelona'] },
  { slug: 'calella', name: 'Calella', region: 'Maresme, Catalunya', nearby: ['pineda-de-mar', 'santa-susanna', 'mataro', 'barcelona'] },
  { slug: 'santa-susanna', name: 'Santa Susanna', region: 'Maresme, Catalunya', nearby: ['pineda-de-mar', 'malgrat-de-mar', 'calella', 'blanes'] },
  { slug: 'blanes', name: 'Blanes', region: 'Selva, Catalunya', nearby: ['malgrat-de-mar', 'lloret-de-mar', 'girona', 'barcelona'] },
  { slug: 'lloret-de-mar', name: 'Lloret de Mar', region: 'Costa Brava, Catalunya', nearby: ['blanes', 'girona', 'barcelona', 'tossa-de-mar'] },
  { slug: 'figueres', name: 'Figueres', region: 'Alt Empordà, Catalunya', nearby: ['girona', 'barcelona', 'roses'] },
  { slug: 'reus', name: 'Reus', region: 'Tarragona, Catalunya', nearby: ['tarragona', 'salou', 'barcelona', 'lleida'] },
  { slug: 'salou', name: 'Salou', region: 'Costa Daurada, Catalunya', nearby: ['tarragona', 'reus', 'barcelona'] },
  { slug: 'valencia', name: 'Valencia', region: 'Comunitat Valenciana', nearby: ['alicante', 'madrid', 'barcelona', 'murcia'] },
  { slug: 'sevilla', name: 'Sevilla', region: 'Andalucía', nearby: ['malaga', 'cordoba', 'granada', 'madrid'] },
  { slug: 'malaga', name: 'Málaga', region: 'Andalucía', nearby: ['sevilla', 'granada', 'cordoba', 'alicante'] },
  { slug: 'zaragoza', name: 'Zaragoza', region: 'Aragón', nearby: ['madrid', 'barcelona', 'valencia', 'bilbao'] },
  { slug: 'bilbao', name: 'Bilbao', region: 'País Vasco', nearby: ['san-sebastian', 'vitoria', 'zaragoza', 'madrid'] },
  { slug: 'alicante', name: 'Alicante', region: 'Comunitat Valenciana', nearby: ['valencia', 'murcia', 'malaga', 'barcelona'] },
  { slug: 'murcia', name: 'Murcia', region: 'Región de Murcia', nearby: ['alicante', 'valencia', 'almeria', 'malaga'] },
  { slug: 'cordoba', name: 'Córdoba', region: 'Andalucía', nearby: ['sevilla', 'malaga', 'granada', 'madrid'] },
  { slug: 'granada', name: 'Granada', region: 'Andalucía', nearby: ['malaga', 'sevilla', 'cordoba', 'almeria'] },
  { slug: 'vitoria', name: 'Vitoria-Gasteiz', region: 'País Vasco', nearby: ['bilbao', 'san-sebastian', 'zaragoza', 'madrid'] },
  { slug: 'san-sebastian', name: 'San Sebastián', region: 'País Vasco', nearby: ['bilbao', 'vitoria', 'zaragoza', 'madrid'] },
  { slug: 'almeria', name: 'Almería', region: 'Andalucía', nearby: ['granada', 'murcia', 'malaga', 'alicante'] }
];

export const popularRoutes = [
  { origin: 'barcelona', destination: 'madrid', distanceKm: 620, angle: 'larga distancia', demand: 'alta' },
  { origin: 'barcelona', destination: 'girona', distanceKm: 100, angle: 'trabajo, universidad y aeropuerto', demand: 'alta' },
  { origin: 'girona', destination: 'barcelona', distanceKm: 100, angle: 'trayecto diario y aeropuerto', demand: 'alta' },
  { origin: 'barcelona', destination: 'tarragona', distanceKm: 100, angle: 'trabajo y estudios', demand: 'alta' },
  { origin: 'tarragona', destination: 'barcelona', distanceKm: 100, angle: 'trabajo y estudios', demand: 'alta' },
  { origin: 'barcelona', destination: 'mataro', distanceKm: 32, angle: 'Maresme y área metropolitana', demand: 'alta' },
  { origin: 'mataro', destination: 'barcelona', distanceKm: 32, angle: 'trabajo diario', demand: 'alta' },
  { origin: 'pineda-de-mar', destination: 'barcelona', distanceKm: 58, angle: 'Maresme - Barcelona', demand: 'alta' },
  { origin: 'barcelona', destination: 'pineda-de-mar', distanceKm: 58, angle: 'Maresme - Barcelona', demand: 'media-alta' },
  { origin: 'malgrat-de-mar', destination: 'barcelona', distanceKm: 68, angle: 'Maresme norte', demand: 'media-alta' },
  { origin: 'barcelona', destination: 'malgrat-de-mar', distanceKm: 68, angle: 'Maresme norte', demand: 'media-alta' },
  { origin: 'calella', destination: 'barcelona', distanceKm: 55, angle: 'Maresme - trabajo y estudios', demand: 'media-alta' },
  { origin: 'santa-susanna', destination: 'barcelona', distanceKm: 62, angle: 'Maresme turístico y trabajo', demand: 'media' },
  { origin: 'blanes', destination: 'barcelona', distanceKm: 72, angle: 'Costa Brava sur', demand: 'media-alta' },
  { origin: 'lloret-de-mar', destination: 'barcelona', distanceKm: 75, angle: 'Costa Brava y turismo', demand: 'media-alta' },
  { origin: 'girona', destination: 'lloret-de-mar', distanceKm: 40, angle: 'Costa Brava', demand: 'media' },
  { origin: 'girona', destination: 'figueres', distanceKm: 43, angle: 'Alt Empordà', demand: 'media' },
  { origin: 'barcelona', destination: 'sabadell', distanceKm: 28, angle: 'Vallès Occidental', demand: 'alta' },
  { origin: 'barcelona', destination: 'terrassa', distanceKm: 33, angle: 'Vallès Occidental', demand: 'alta' },
  { origin: 'barcelona', destination: 'granollers', distanceKm: 30, angle: 'Vallès Oriental', demand: 'media-alta' },
  { origin: 'barcelona', destination: 'vic', distanceKm: 70, angle: 'Osona', demand: 'media' },
  { origin: 'barcelona', destination: 'manresa', distanceKm: 65, angle: 'Bages', demand: 'media' },
  { origin: 'barcelona', destination: 'aeropuerto-barcelona-el-prat', distanceKm: 15, angle: 'aeropuerto', demand: 'alta' },
  { origin: 'girona', destination: 'aeropuerto-girona-costa-brava', distanceKm: 13, angle: 'aeropuerto', demand: 'media-alta' },
  { origin: 'madrid', destination: 'valencia', distanceKm: 355, angle: 'fin de semana y trabajo', demand: 'alta' },
  { origin: 'sevilla', destination: 'malaga', distanceKm: 205, angle: 'Andalucía occidental', demand: 'media-alta' },
  { origin: 'zaragoza', destination: 'barcelona', distanceKm: 315, angle: 'corredor noreste', demand: 'media-alta' },
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
  { slug: 'aeropuerto-valencia', name: 'Aeropuerto de Valencia', city: 'valencia' },
  { slug: 'aeropuerto-reus', name: 'Aeropuerto de Reus', city: 'reus' }
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

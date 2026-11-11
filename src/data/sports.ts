// Datos de ejemplo. Nada de esto sale de un modelo real: sustituye este módulo
// por las respuestas del backend de visión por computadora cuando exista.

export type SportId = 'basket' | 'futbol'
export type EvCode = 'T' | 'P' | 'S' | 'G'
export type Severity = 'Crítico' | 'Alerta' | 'Correcto'
export type Trend = 1 | 0 | -1

export interface GameEvent {
  /** Posición en la línea de tiempo, 0–100 % */
  pct: number
  code: EvCode
  type: string
  desc: string
}

export interface Kpi {
  label: string
  value: string
  delta: string
  trend: Trend
}

export interface Diagnosis {
  id: string
  sev: Severity
  /** Índice del evento al que salta el visor */
  ev: number
  who: string
  title: string
  meas: string
  ideal: string
  detail: string
  drills: [name: string, dose: string][]
}

export interface BioRow {
  label: string
  value: string
  ideal: string
  /** Banda ideal y marca del valor medido, en % del ancho de la escala */
  bandL: number
  bandW: number
  mark: number
  inRange: boolean
  status: string
}

export interface Phase {
  name: string
  dur: string
  metric: string
  state: Trend
  note: string
}

export interface CompareRow {
  label: string
  a: string
  aPct: number
  b: string
  bPct: number
}

export interface SportData {
  id: SportId
  label: string
  accent: string
  match: string
  /** Duración del video de ejemplo, en segundos */
  secs: number
  events: GameEvent[]
  legend: [EvCode, string][]
  kpis: Kpi[]
  perfMetric: string
  perf: [player: string, pct: number][]
  heatMetric: string
  /** Cuadrícula 8 × 5 de intensidades 0–100 */
  heat: number[]
  heatSeed: number
  /** Cúmulos del mapa por jugador: x, y, dispersión x, dispersión y, muestras */
  heatClusters: [number, number, number, number, number][]
  pitch: string
  compare: { a: string; b: string; radarA: number[]; radarB: number[]; rows: CompareRow[] }
  bioPlayer: string
  bio: BioRow[]
  /** Dorsales de los seis jugadores del fotograma */
  nums: string[]
  /** Posición cenital de cada jugador (%, %) y si es del equipo analizado */
  pins: [x: number, y: number, own: boolean][]
  diags: Diagnosis[]
  slowTitle: string
  phases: Phase[]
  summary: string
  plays: [time: string, title: string, why: string][]
  drills: [name: string, goal: string, dose: string][]
  demos: [name: string, meta: string][]
}

export const RADAR_AXES = ['Explosividad', 'Técnica', 'Equilibrio', 'Visión', 'Resistencia', 'Defensa']

export const EVENT_COLOR: Record<EvCode, string> = {
  T: '#30C0F8',
  P: '#FF5065',
  S: '#FFC237',
  G: '#CBF62E',
}

export const SEV_COLOR: Record<Severity, string> = {
  Crítico: '#FF5065',
  Alerta: '#FFC237',
  Correcto: '#36DA90',
}

export const trendColor = (t: Trend) => (t > 0 ? '#36DA90' : t < 0 ? '#FF5065' : '#FFC237')

const basket: SportData = {
  id: 'basket',
  label: 'Baloncesto',
  accent: '#FE7902',
  match: 'Partido de ejemplo · Jornada 12',
  secs: 2890,
  events: [
    { pct: 8, code: 'T', type: 'Tiro', desc: '#23 — media distancia' },
    { pct: 18, code: 'P', type: 'Pérdida', desc: '#7 — pase interceptado' },
    { pct: 26, code: 'T', type: 'Tiro libre', desc: '#23 — codo a 82°' },
    { pct: 39, code: 'S', type: 'Sprint', desc: '#11 — desmarque a 8,4 m/s' },
    { pct: 47, code: 'G', type: 'Canasta', desc: '#23 — anota 2 puntos' },
    { pct: 61, code: 'P', type: 'Pérdida', desc: '#11 — falta en ataque' },
    { pct: 72, code: 'T', type: 'Tiro', desc: '#23 — tiro tras bote' },
    { pct: 88, code: 'G', type: 'Canasta', desc: '#7 — anota 3 puntos' },
  ],
  legend: [
    ['T', 'Tiro'],
    ['P', 'Pérdida'],
    ['S', 'Sprint'],
    ['G', 'Canasta'],
  ],
  kpis: [
    { label: 'eFG%', value: '54,2 %', delta: '+3,1 pts vs. media', trend: 1 },
    { label: 'Pérdidas', value: '11', delta: '+2 vs. media', trend: -1 },
    { label: 'Vel. máxima', value: '8,4 m/s', delta: '+6 % vs. media', trend: 1 },
    { label: 'Carga', value: '412 AU', delta: '+11 % vs. media', trend: -1 },
    { label: 'Distancia equipo', value: '38,4 km', delta: 'En la media', trend: 0 },
    { label: 'Sprints', value: '46', delta: '+8 vs. media', trend: 1 },
  ],
  perfMetric: 'Eficiencia de tiro (eFG%)',
  perf: [
    ['#23', 68],
    ['#7', 59],
    ['#11', 52],
    ['#4', 47],
    ['#15', 38],
  ],
  heatMetric: 'Tiros intentados por zona',
  heat: [
    20, 10, 25, 85, 90, 30, 10, 15, 15, 12, 30, 70, 75, 35, 10, 20, 35, 20, 15, 40, 45, 15, 25, 40, 55, 45, 30, 20,
    25, 35, 50, 60, 10, 30, 45, 55, 50, 40, 25, 10,
  ],
  heatSeed: 23,
  heatClusters: [
    [36, 50, 15, 20, 70],
    [60, 44, 13, 18, 50],
    [14, 50, 6, 20, 20],
  ],
  pitch: '#331F10',
  compare: {
    a: '#23',
    b: '#7',
    radarA: [82, 58, 70, 76, 64, 55],
    radarB: [66, 84, 72, 60, 78, 62],
    rows: [
      { label: 'Codo en liberación', a: '82°', aPct: 68, b: '91°', bPct: 76 },
      { label: 'Ángulo de salida', a: '47°', aPct: 78, b: '43°', bPct: 72 },
      { label: 'Tiempo de liberación', a: '0,62 s', aPct: 62, b: '0,48 s', bPct: 48 },
      { label: 'Altura de salto', a: '41 cm', aPct: 68, b: '37 cm', bPct: 62 },
    ],
  },
  bioPlayer: '#23 M. Ortega',
  bio: [
    { label: 'Codo en liberación', value: '82°', ideal: '85–95°', bandL: 41.7, bandW: 16.7, mark: 36.7, inRange: false, status: 'Bajo' },
    { label: 'Rodilla en la carga', value: '132°', ideal: '110–125°', bandL: 33.3, bandW: 25, mark: 70, inRange: false, status: 'Alto' },
    { label: 'Ángulo de salida del balón', value: '47°', ideal: '45–52°', bandL: 50, bandW: 23.3, mark: 56.7, inRange: true, status: 'En rango' },
    { label: 'Alineación hombro-cadera', value: '4°', ideal: '0–6°', bandL: 0, bandW: 30, mark: 20, inRange: true, status: 'En rango' },
  ],
  nums: ['#23', '#7', '#11', '#4', '#15', '#9'],
  pins: [
    [70, 62, true],
    [52, 40, true],
    [84, 28, true],
    [74, 58, false],
    [86, 48, false],
    [60, 26, false],
  ],
  diags: [
    {
      id: 'b-codo',
      sev: 'Crítico',
      ev: 2,
      who: '#23 M. Ortega',
      title: 'Ángulo de codo en tiro libre inferior a 85°',
      meas: '82°',
      ideal: '85–95°',
      detail:
        'El codo se abre hacia fuera en la fase de carga y resta arco al tiro. Ocurre en 7 de los 9 tiros libres del video.',
      drills: [
        ['Tiro a una mano frente a la pared', '3 × 15'],
        ['Form shooting a 1 m del aro', '5 × 10'],
      ],
    },
    {
      id: 'b-rodilla',
      sev: 'Alerta',
      ev: 6,
      who: '#23 M. Ortega',
      title: 'Flexión de rodilla insuficiente en la carga',
      meas: '132°',
      ideal: '110–125°',
      detail: 'La potencia sale del brazo y no de las piernas; el tiro pierde alcance en los últimos minutos.',
      drills: [
        ['Sentadilla con salto y recepción', '3 × 8'],
        ['Tiro tras bote con pausa en la carga', '4 × 10'],
      ],
    },
    {
      id: 'b-salida',
      sev: 'Correcto',
      ev: 0,
      who: '#7 D. Rivera',
      title: 'Ángulo de salida estable',
      meas: '47°',
      ideal: '45–52°',
      detail: 'Dentro del rango ideal en 9 de 11 tiros. No requiere corrección.',
      drills: [
        ['Mantener la rutina actual de tiro', '—'],
        ['Tiros con fatiga al final de la sesión', '2 × 10'],
      ],
    },
  ],
  slowTitle: 'tiro libre del #23',
  phases: [
    { name: 'Carga', dur: '0,42 s', metric: 'Rodilla 132°', state: 0, note: 'La rodilla flexiona poco: 132° frente a un ideal de 110–125°.' },
    { name: 'Elevación', dur: '0,31 s', metric: 'Cadera 168°', state: 1, note: 'Extensión de cadera completa y vertical.' },
    { name: 'Liberación', dur: '0,08 s', metric: 'Codo 82°', state: -1, note: 'El codo se abre hacia fuera justo antes de soltar el balón.' },
    { name: 'Acompañamiento', dur: '0,35 s', metric: 'Muñeca 61°', state: 1, note: 'La muñeca termina el gesto apuntando al aro.' },
  ],
  summary:
    'El equipo anotó con eficiencia cerca del aro, pero perdió balones en la salida de presión y bajó el acierto en tiros libres en el último cuarto.',
  plays: [
    ['00:08:40', 'Pérdida ante presión a toda cancha', 'El base recibe de espaldas y sin línea de pase; el rival anota en transición.'],
    ['00:18:47', 'Desmarque y canasta tras bloqueo indirecto', 'El bloqueo libera al tirador en la esquina; es la jugada más rentable del partido.'],
    ['00:29:23', 'Falta en ataque en el poste bajo', 'El pívot carga con el hombro al girar; anula una posesión con ventaja.'],
    ['00:42:23', 'Triple en transición', 'Ocupación correcta de carriles y pase extra al jugador abierto.'],
  ],
  drills: [
    ['Salida de presión 3 contra 2', 'Recibir perfilado y encontrar la línea de pase antes de botar.', '4 × 4 min'],
    ['Bloqueo indirecto con lectura', 'Repetir la jugada más rentable con dos opciones de salida.', '3 × 10'],
    ['Tiros libres con fatiga', 'Sostener la mecánica al final del partido.', '5 × 6'],
  ],
  demos: [
    ['Partido · tercer cuarto', '02:00 · 1080p'],
    ['Tiros libres · entrenamiento', '01:10 · 1080p'],
  ],
}

const futbol: SportData = {
  id: 'futbol',
  label: 'Fútbol',
  accent: '#36DA90',
  match: 'Partido de ejemplo · Jornada 9',
  secs: 5660,
  events: [
    { pct: 7, code: 'S', type: 'Sprint', desc: '#9 — desmarque a 7,8 m/s' },
    { pct: 16, code: 'T', type: 'Tiro', desc: '#9 — desde 21 m' },
    { pct: 27, code: 'P', type: 'Pérdida', desc: '#10 — recepción de espaldas' },
    { pct: 34, code: 'G', type: 'Gol', desc: '#9 — remate al primer toque' },
    { pct: 52, code: 'T', type: 'Tiro', desc: '#10 — golpeo elevado' },
    { pct: 63, code: 'S', type: 'Sprint', desc: '#8 — retorno defensivo' },
    { pct: 74, code: 'P', type: 'Pérdida', desc: '#5 — pase interceptado' },
    { pct: 90, code: 'G', type: 'Gol', desc: '#10 — tiro cruzado' },
  ],
  legend: [
    ['T', 'Tiro'],
    ['P', 'Pérdida'],
    ['S', 'Sprint'],
    ['G', 'Gol'],
  ],
  kpis: [
    { label: 'Posesión', value: '58 %', delta: '+4 pts vs. media', trend: 1 },
    { label: 'Pases completados', value: '87 %', delta: 'En la media', trend: 0 },
    { label: 'Vel. máxima', value: '31,2 km/h', delta: '+3 % vs. media', trend: 1 },
    { label: 'Carga', value: '684 AU', delta: '+9 % vs. media', trend: -1 },
    { label: 'Distancia equipo', value: '108,6 km', delta: '+2,3 km vs. media', trend: 1 },
    { label: 'Pérdidas en salida', value: '14', delta: '+5 vs. media', trend: -1 },
  ],
  perfMetric: 'Pases completados (%)',
  perf: [
    ['#8', 93],
    ['#10', 88],
    ['#5', 84],
    ['#9', 76],
    ['#3', 71],
  ],
  heatMetric: 'Presencia con balón',
  heat: [
    5, 10, 15, 20, 35, 45, 30, 15, 10, 20, 30, 45, 60, 75, 55, 20, 10, 25, 40, 55, 80, 90, 70, 35, 10, 20, 35, 40, 65,
    70, 50, 25, 5, 10, 20, 25, 40, 45, 30, 10,
  ],
  heatSeed: 10,
  heatClusters: [
    [58, 48, 16, 22, 80],
    [34, 54, 12, 20, 40],
    [82, 46, 7, 16, 20],
  ],
  pitch: '#163420',
  compare: {
    a: '#10',
    b: '#8',
    radarA: [86, 72, 58, 48, 66, 40],
    radarB: [64, 78, 74, 88, 82, 70],
    rows: [
      { label: 'Perfilación en recepción', a: '38°', aPct: 32, b: '71°', bPct: 59 },
      { label: 'Escaneos antes de recibir', a: '0,3 /s', aPct: 30, b: '0,6 /s', bPct: 60 },
      { label: 'Velocidad máxima', a: '31,2 km/h', aPct: 87, b: '29,4 km/h', bPct: 82 },
      { label: 'Pases progresivos', a: '9', aPct: 45, b: '14', bPct: 70 },
    ],
  },
  bioPlayer: '#10 L. Vidal',
  bio: [
    { label: 'Perfilación en recepción', value: '38°', ideal: '60–90°', bandL: 50, bandW: 25, mark: 31.7, inRange: false, status: 'Bajo' },
    { label: 'Distancia pie de apoyo–balón', value: '31 cm', ideal: '15–25 cm', bandL: 30, bandW: 20, mark: 62, inRange: false, status: 'Alto' },
    { label: 'Inclinación de tronco en golpeo', value: '12°', ideal: '8–15°', bandL: 26.7, bandW: 23.3, mark: 40, inRange: true, status: 'En rango' },
    { label: 'Flexión de rodilla de apoyo', value: '148°', ideal: '140–155°', bandL: 33.3, bandW: 25, mark: 46.7, inRange: true, status: 'En rango' },
  ],
  nums: ['#10', '#8', '#9', '#5', '#3', '#1'],
  pins: [
    [62, 60, true],
    [38, 42, true],
    [80, 36, true],
    [70, 56, false],
    [86, 66, false],
    [95, 50, false],
  ],
  diags: [
    {
      id: 'f-perfil',
      sev: 'Crítico',
      ev: 2,
      who: '#10 L. Vidal',
      title: 'Perfilación corporal deficiente en recepción',
      meas: '38°',
      ideal: '60–90°',
      detail:
        'Recibe de espaldas a la portería y pierde la opción de giro. Ocurre en 11 de 18 recepciones entre líneas.',
      drills: [
        ['Rondo 4 v 2 con recepción orientada', '4 × 3 min'],
        ['Control orientado con escaneo previo', '3 × 12'],
      ],
    },
    {
      id: 'f-apoyo',
      sev: 'Alerta',
      ev: 4,
      who: '#10 L. Vidal',
      title: 'Pie de apoyo retrasado en el golpeo',
      meas: '31 cm',
      ideal: '15–25 cm',
      detail: 'El pie de apoyo queda lejos del balón; el tiro sale elevado y sin potencia.',
      drills: [
        ['Golpeo estático con marca de apoyo', '3 × 10'],
        ['Tiro tras conducción a un toque', '4 × 6'],
      ],
    },
    {
      id: 'f-sprint',
      sev: 'Correcto',
      ev: 0,
      who: '#9 A. Soto',
      title: 'Aceleración en sprint eficiente',
      meas: '7,8 m/s',
      ideal: '≥ 7 m/s',
      detail: 'Alcanza la velocidad objetivo en los primeros 15 m del desmarque. No requiere corrección.',
      drills: [
        ['Mantener el trabajo de arrancadas', '—'],
        ['Sprints con cambio de dirección', '3 × 6'],
      ],
    },
  ],
  slowTitle: 'recepción y golpeo del #10',
  phases: [
    { name: 'Aproximación', dur: '0,48 s', metric: 'Zancada 1,6 m', state: 1, note: 'Última zancada larga y estable.' },
    { name: 'Apoyo', dur: '0,12 s', metric: 'Pie a 31 cm', state: -1, note: 'El pie de apoyo queda retrasado respecto al balón.' },
    { name: 'Impacto', dur: '0,02 s', metric: 'Tronco 12°', state: 1, note: 'Tronco sobre el balón en el momento del contacto.' },
    { name: 'Acompañamiento', dur: '0,40 s', metric: 'Cadera 48°', state: 0, note: 'La cadera rota menos de lo esperado tras el golpeo.' },
  ],
  summary:
    'El equipo dominó la posesión y generó sus mejores ocasiones con desmarques al espacio, pero perdió balones en la salida desde atrás al recibir de espaldas.',
  plays: [
    ['00:25:28', 'Pérdida en salida de balón', 'El mediocentro recibe de espaldas y sin escanear; el rival roba y remata.'],
    ['00:32:04', 'Gol tras desmarque al espacio', 'Pase filtrado al punta, que ataca la espalda del central.'],
    ['00:59:26', 'Retorno defensivo tras pérdida', 'Sprint de 40 m del interior que evita el contraataque.'],
    ['01:24:54', 'Gol con tiro cruzado', 'Recepción orientada en el borde del área y golpeo al palo largo.'],
  ],
  drills: [
    ['Rondo 4 contra 2 con recepción orientada', 'Perfilarse y escanear antes de recibir.', '4 × 3 min'],
    ['Desmarque de ruptura con pase filtrado', 'Coordinar el momento del pase con la carrera del punta.', '3 × 8'],
    ['Transición defensiva 5 contra 4', 'Reaccionar a la pérdida en los primeros 5 segundos.', '4 × 2 min'],
  ],
  demos: [
    ['Partido · primer tiempo', '02:30 · 1080p'],
    ['Recepciones y pases · entrenamiento', '01:20 · 1080p'],
  ],
}

export const SPORTS: Record<SportId, SportData> = { basket, futbol }
export const SPORT_LIST: SportData[] = [basket, futbol]

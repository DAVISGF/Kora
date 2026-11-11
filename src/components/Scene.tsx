import type { SportId } from '../data/sports'

export interface LayerState {
  track: boolean
  skel: boolean
  vec: boolean
  zone: boolean
}

interface SceneProps {
  sport: SportId
  accent: string
  layers: LayerState
  /** Desplazamiento "x,y" de cada uno de los seis jugadores */
  offsets: string[]
  /** Etiqueta de cada caja de tracking */
  labels: string[]
}

const MONO = 'JetBrains Mono, monospace'
const TRACK = '#CBF62E'
const SKEL = '#30C0F8'
const VEC = '#FFC237'
const ZONE = '#A78BFA'
const TEAM_A = '#E3E8EF'
const TEAM_B = '#6F7B8C'

interface PlayerDef {
  /** Pies del jugador y escala de la silueta */
  x: number
  y: number
  s: number
  fill: string
  box: [number, number, number, number]
  chip: [number, number]
  rival?: boolean
}

const PLAYERS: Record<SportId, PlayerDef[]> = {
  basket: [
    { x: 540, y: 410, s: 1.3, fill: TEAM_A, box: [518, 311, 44, 103], chip: [462, 291] },
    { x: 330, y: 320, s: 1, fill: TEAM_A, box: [313, 244, 34, 80], chip: [313, 224] },
    { x: 720, y: 250, s: 0.9, fill: TEAM_A, box: [705, 182, 31, 72], chip: [705, 162] },
    { x: 640, y: 400, s: 1.25, fill: TEAM_B, box: [619, 301, 42, 99], chip: [619, 281], rival: true },
    { x: 760, y: 340, s: 1.1, fill: TEAM_B, box: [741, 256, 38, 88], chip: [741, 236], rival: true },
    { x: 450, y: 240, s: 0.9, fill: TEAM_B, box: [435, 172, 31, 72], chip: [435, 152], rival: true },
  ],
  futbol: [
    { x: 520, y: 400, s: 1.3, fill: TEAM_A, box: [498, 301, 44, 103], chip: [498, 418] },
    { x: 260, y: 330, s: 1, fill: TEAM_A, box: [243, 254, 34, 80], chip: [243, 234] },
    { x: 700, y: 300, s: 1, fill: TEAM_A, box: [683, 224, 34, 80], chip: [683, 204] },
    { x: 610, y: 385, s: 1.2, fill: TEAM_B, box: [590, 294, 41, 96], chip: [531, 274], rival: true },
    { x: 770, y: 430, s: 1.25, fill: TEAM_B, box: [749, 335, 42, 99], chip: [691, 315], rival: true },
    { x: 858, y: 345, s: 1, fill: ZONE, box: [841, 269, 34, 80], chip: [841, 249], rival: true },
  ],
}

function Chip({ x, y, w, color, children, size = 12 }: { x: number; y: number; w: number; color: string; children: string; size?: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={size + 12} rx="5" fill="#10151B" stroke={color} strokeWidth="1.5" />
      <text x={x + 9} y={y + size + 5} fill={color} fontFamily={MONO} fontSize={size} fontWeight="700">
        {children}
      </text>
    </>
  )
}

function BasketBase() {
  return (
    <>
      <rect width="960" height="540" fill="#0B0F15" />
      <rect width="960" height="170" fill="#0E131A" />
      <path d="M0 60h960M0 100h960M0 138h960" stroke="#161C25" strokeWidth="2" />
      <polygon points="60,170 900,170 960,540 0,540" fill="#331F10" />
      <g fill="none" stroke="#8A6F56" strokeWidth="2">
        <path d="M850 170 900 540M150 170 100 540" />
        <polygon points="866,290 636,290 651,400 881,400" fill="#FE7902" fillOpacity="0.08" />
        <ellipse cx="643" cy="345" rx="70" ry="55" />
        <path d="M858 215H760Q470 345 790 480h102" />
        <path d="M146 300q70 50-8 110" />
      </g>
      <ellipse cx="830" cy="346" rx="18" ry="5" fill="#000" fillOpacity="0.35" />
      <rect x="846" y="228" width="5" height="60" fill="#8A95A0" />
      <ellipse cx="830" cy="282" rx="16" ry="5" fill="none" stroke="#FE7902" strokeWidth="3" />
    </>
  )
}

function FootballBase() {
  return (
    <>
      <rect width="960" height="540" fill="#0B0F15" />
      <rect width="960" height="150" fill="#0E131A" />
      <path d="M0 50h960M0 90h960M0 124h960" stroke="#161C25" strokeWidth="2" />
      <polygon points="40,150 920,150 960,540 0,540" fill="#0F2A1C" />
      <polygon points="250,150 440,150 420,540 200,540" fill="#123222" />
      <polygon points="630,150 800,150 830,540 640,540" fill="#123222" />
      <g fill="none" stroke="#4F9470" strokeWidth="2">
        <path d="M870 150 915 540" />
        <polygon points="878,215 628,215 658,480 908,480" />
        <polygon points="886,290 806,290 820,410 900,410" />
        <path d="M640 300q-50 47 8 95" />
      </g>
      <circle cx="722" cy="350" r="3" fill="#4F9470" />
      <path d="M888 300v-40l11 95v40M888 260l11 95" fill="none" stroke="#E7ECF0" strokeWidth="3" strokeLinejoin="round" />
    </>
  )
}

function Zones({ sport }: { sport: SportId }) {
  const text = { fontFamily: MONO, fontSize: 12, fontWeight: 700, fill: ZONE }
  const tag = (x: number, y: number, w: number, label: string) => (
    <>
      <rect x={x} y={y} width={w} height="22" rx="4" fill="#10151B" stroke={ZONE} strokeWidth="1.5" />
      <text x={x + 8} y={y + 15} {...text}>
        {label}
      </text>
    </>
  )
  if (sport === 'basket')
    return (
      <g>
        <polygon points="866,290 636,290 651,400 881,400" fill={ZONE} fillOpacity="0.22" stroke={ZONE} strokeWidth="2" />
        <path d="M858 215H760Q470 345 790 480h102L881 400H651L636 290h230z" fill={ZONE} fillOpacity="0.1" stroke={ZONE} strokeWidth="1.5" strokeDasharray="6 5" />
        {tag(700, 408, 126, 'Pintura · 62 %')}
        {tag(596, 446, 170, 'Media distancia · 41 %')}
        {tag(250, 446, 112, 'Triple · 36 %')}
      </g>
    )
  return (
    <g>
      <polygon points="878,215 628,215 658,480 908,480" fill={ZONE} fillOpacity="0.2" stroke={ZONE} strokeWidth="2" />
      <polygon points="628,215 520,215 548,480 658,480" fill={ZONE} fillOpacity="0.1" stroke={ZONE} strokeWidth="1.5" strokeDasharray="6 5" />
      {tag(770, 486, 118, 'Área · 3 tiros')}
      {tag(520, 486, 162, 'Zona 14 · 7 entradas')}
    </g>
  )
}

function Skeleton({ sport }: { sport: SportId }) {
  const joints = (pts: [number, number, number?][]) => (
    <g fill={SKEL} stroke="#090D10" strokeWidth="1.5">
      {pts.map(([cx, cy, r = 4]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  )
  if (sport === 'basket')
    return (
      <g>
        <g fill="none" stroke={SKEL} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M540 338v37M530 345h18M548 345l18-7-4-26M530 345l-10 16 14 8M540 375l6 17-8 18M540 375l-8 17-2 18" />
          <path d="M556 334a12 12 0 0 1 8-8" strokeWidth="2" />
        </g>
        {joints([[548, 345], [566, 338, 5], [562, 312], [530, 345], [540, 375], [546, 392], [532, 392], [538, 410], [530, 410]])}
        <path d="M570 334l14-64" stroke={SKEL} strokeWidth="1.5" />
        <Chip x={574} y={246} w={96} color={SKEL} size={13}>
          Codo 82°
        </Chip>
      </g>
    )
  return (
    <g>
      <g fill="none" stroke={SKEL} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M520 328v44M508 338h24M512 372h16M508 338l-10 20 4 18M532 338l12 17-4 19M512 372l-6 20-6 18M528 372l6 20 6 18" />
      </g>
      {joints([[508, 338], [532, 338], [512, 372, 5], [528, 372, 5], [506, 392], [534, 392], [500, 410], [540, 410]])}
      <path d="M520 372l-58-22M520 372l64-10" stroke={SKEL} strokeWidth="1.5" strokeDasharray="4 4" />
      <path d="M498 300l-22-28" stroke={SKEL} strokeWidth="1.5" />
      <Chip x={380} y={246} w={104} color={SKEL} size={13}>
        Perfil 38°
      </Chip>
    </g>
  )
}

function Vectors({ sport }: { sport: SportId }) {
  const id = `arrow-${sport}`
  const line = { fill: 'none', stroke: VEC, markerEnd: `url(#${id})` }
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10z" fill={VEC} />
        </marker>
      </defs>
      {sport === 'basket' ? (
        <>
          <path d="M562 290Q690 100 826 274" {...line} strokeWidth="3" strokeDasharray="10 7" />
          <path d="M350 290 508 352" {...line} strokeWidth="2.5" />
          <Chip x={640} y={112} w={150} color={VEC} size={13}>
            Tiro 4,6 m · 47°
          </Chip>
          <Chip x={352} y={330} w={98} color={VEC}>
            Pase 5,1 m
          </Chip>
        </>
      ) : (
        <>
          <path d="M282 322 484 402" {...line} strokeWidth="2.5" />
          <path d="M548 396 882 334" {...line} strokeWidth="3" strokeDasharray="10 7" />
          <path d="M722 262q40-30 96-22" {...line} strokeWidth="2.5" />
          <Chip x={300} y={372} w={112} color={VEC}>
            Pase 18,4 m
          </Chip>
          <Chip x={648} y={382} w={92} color={VEC}>
            Tiro 21 m
          </Chip>
          <Chip x={730} y={160} w={150} color={VEC}>
            Desmarque 7,8 m/s
          </Chip>
        </>
      )}
    </g>
  )
}

/** Fotograma ilustrado con las capas de visión por computadora simuladas. */
export default function Scene({ sport, accent, layers, offsets, labels }: SceneProps) {
  const players = PLAYERS[sport]
  const figure = `figure-${sport}`
  const describe =
    sport === 'basket'
      ? 'Fotograma de baloncesto: media cancha con seis jugadores y capas de análisis'
      : 'Fotograma de fútbol: último tercio del campo con seis jugadores y capas de análisis'
  return (
    <svg role="img" aria-label={describe} viewBox="0 0 960 540" className="absolute inset-0 h-full w-full">
      <defs>
        <g id={figure}>
          <circle cx="0" cy="-64" r="9" />
          <rect x="-12" y="-53" width="24" height="32" rx="6" />
          <rect x="-11" y="-22" width="9" height="22" rx="3" />
          <rect x="2" y="-22" width="9" height="22" rx="3" />
        </g>
      </defs>

      <>
          {sport === 'basket' ? <BasketBase /> : <FootballBase />}
          {players.map((p, i) => (
            <g key={i} transform={`translate(${offsets[i]})`}>
              <use href={`#${figure}`} fill={p.fill} transform={`translate(${p.x},${p.y}) scale(${p.s})`} />
            </g>
          ))}
          {sport === 'basket' ? <circle cx="562" cy="298" r="9" fill="#FE7902" /> : <circle cx="494" cy="406" r="6" fill="#fff" />}
      </>

      {layers.zone && <Zones sport={sport} />}

      {layers.track && (
        <g fontFamily={MONO} fontSize="12" fontWeight="700">
          {players.map((p, i) => {
            const color = p.rival ? accent : TRACK
            return (
              <g key={i} transform={`translate(${offsets[i]})`}>
                <rect x={p.box[0]} y={p.box[1]} width={p.box[2]} height={p.box[3]} fill="none" stroke={color} strokeWidth="2" />
                <rect x={p.chip[0]} y={p.chip[1]} width="100" height="18" fill={color} />
                <text x={p.chip[0] + 4} y={p.chip[1] + 13} fill="#0F1405">
                  {labels[i]}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {layers.skel && <Skeleton sport={sport} />}
      {layers.vec && <Vectors sport={sport} />}
    </svg>
  )
}

/** Líneas de la cancha o el campo en vista cenital (viewBox 320 × 200). */
export function PitchLines({ sport, half }: { sport: SportId; half?: boolean }) {
  const stroke = sport === 'basket' ? '#C7A890' : '#B9D8C4'
  return (
    <svg aria-hidden="true" viewBox="0 0 320 200" className="absolute inset-0 h-full w-full">
      <g fill="none" stroke={stroke} strokeOpacity="0.65" strokeWidth="1.5">
        {sport === 'basket' && half ? (
          <>
            <rect x="1" y="1" width="318" height="198" />
            <rect x="125" y="1" width="70" height="92" />
            <circle cx="160" cy="93" r="28" />
            <path d="M32 1v48a128 128 0 0 0 256 0V1M132 199a28 28 0 0 1 56 0" />
            <circle cx="160" cy="22" r="6" />
            <path d="M146 12h28" />
          </>
        ) : sport === 'basket' ? (
          <>
            <rect x="6" y="6" width="308" height="188" />
            <path d="M160 6v188" />
            <circle cx="160" cy="100" r="22" />
            <rect x="6" y="68" width="56" height="64" />
            <rect x="258" y="68" width="56" height="64" />
            <path d="M6 24h40a80 80 0 0 1 0 152H6M314 24h-40a80 80 0 0 0 0 152h40" />
          </>
        ) : (
          <>
            <rect x="6" y="6" width="308" height="188" />
            <path d="M160 6v188" />
            <circle cx="160" cy="100" r="24" />
            <rect x="6" y="50" width="44" height="100" />
            <rect x="270" y="50" width="44" height="100" />
            <rect x="6" y="78" width="16" height="44" />
            <rect x="298" y="78" width="16" height="44" />
          </>
        )}
      </g>
    </svg>
  )
}

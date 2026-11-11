import { jointAngles, mainPerson, MIN_KEYPOINT_CONF, SKELETON, type FrameAnalysis } from '../lib/vision'
import type { LayerState } from './Scene'

const TRACK = '#CBF62E'
const SKEL = '#30C0F8'
const BALL = '#FFC237'

interface Props {
  analysis: FrameAnalysis
  layers: LayerState
  /** Tamaño natural del video; el SVG lo usa como sistema de coordenadas */
  width: number
  height: number
}

/** Dibuja sobre el video las detecciones reales devueltas por el servicio de visión. */
export default function RealOverlay({ analysis, layers, width, height }: Props) {
  // Unidad de trazo y texto proporcional al video, para que se vea igual en 480p que en 4K.
  const u = width / 960
  const main = mainPerson(analysis.persons)
  const angles = main ? jointAngles(main, width / height) : []

  return (
    <svg
      role="img"
      aria-label={`Detecciones reales: ${analysis.persons.length} personas`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
    >
      {layers.skel &&
        analysis.persons.map((p) => {
          const kp = new Map(p.keypoints.filter((k) => k.conf >= MIN_KEYPOINT_CONF).map((k) => [k.name, k]))
          return (
            <g key={`s${p.id}`}>
              <g stroke={SKEL} strokeWidth={3 * u} strokeLinecap="round">
                {SKELETON.map(([a, b]) => {
                  const ka = kp.get(a)
                  const kb = kp.get(b)
                  return ka && kb ? <line key={a + b} x1={ka.x * width} y1={ka.y * height} x2={kb.x * width} y2={kb.y * height} /> : null
                })}
              </g>
              <g fill={SKEL} stroke="#090D10" strokeWidth={1.5 * u}>
                {[...kp.values()].map((k) => (
                  <circle key={k.name} cx={k.x * width} cy={k.y * height} r={4 * u} />
                ))}
              </g>
            </g>
          )
        })}

      {layers.skel &&
        angles.slice(0, 4).map((a) => (
          <text
            key={a.label}
            x={a.at.x * width + 8 * u}
            y={a.at.y * height - 8 * u}
            fill={SKEL}
            stroke="#090D10"
            strokeWidth={3 * u}
            paintOrder="stroke"
            fontFamily="JetBrains Mono, monospace"
            fontSize={14 * u}
            fontWeight="700"
          >
            {a.degrees}°
          </text>
        ))}

      {layers.track &&
        analysis.persons.map((p) => {
          const x = p.box.x * width
          const y = p.box.y * height
          const label = `#${p.id} · ${Math.round(p.conf * 100)} %`
          const chipW = (label.length * 7.4 + 8) * u
          return (
            <g key={`t${p.id}`}>
              <rect x={x} y={y} width={p.box.w * width} height={p.box.h * height} fill="none" stroke={TRACK} strokeWidth={2 * u} />
              <rect x={x} y={Math.max(0, y - 20 * u)} width={chipW} height={18 * u} fill={TRACK} />
              <text x={x + 4 * u} y={Math.max(0, y - 20 * u) + 13 * u} fill="#0F1405" fontFamily="JetBrains Mono, monospace" fontSize={12 * u} fontWeight="700">
                {label}
              </text>
            </g>
          )
        })}

      {layers.vec && analysis.ball && (
        <g>
          <ellipse
            cx={(analysis.ball.box.x + analysis.ball.box.w / 2) * width}
            cy={(analysis.ball.box.y + analysis.ball.box.h / 2) * height}
            rx={Math.max(8 * u, (analysis.ball.box.w * width) / 2 + 4 * u)}
            ry={Math.max(8 * u, (analysis.ball.box.h * height) / 2 + 4 * u)}
            fill="none"
            stroke={BALL}
            strokeWidth={2.5 * u}
          />
          <text
            x={(analysis.ball.box.x + analysis.ball.box.w) * width + 8 * u}
            y={analysis.ball.box.y * height}
            fill={BALL}
            stroke="#090D10"
            strokeWidth={3 * u}
            paintOrder="stroke"
            fontFamily="JetBrains Mono, monospace"
            fontSize={13 * u}
            fontWeight="700"
          >
            Balón · {Math.round(analysis.ball.conf * 100)} %
          </text>
        </g>
      )}
    </svg>
  )
}

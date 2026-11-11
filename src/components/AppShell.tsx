import type { CSSProperties } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { History, ListVideo, MonitorPlay, Plus, Scissors, Sparkles, Upload } from 'lucide-react'
import { SPORT_LIST } from '../data/sports'
import { useStore } from '../lib/store'
import { cx } from '../lib/util'
import { btnPrimary, SampleBadge, Segmented } from './ui'

const NAV = [
  { to: '/', label: 'Ingesta', icon: Upload },
  { to: '/analisis', label: 'Análisis', icon: MonitorPlay },
  { to: '/coach', label: 'AI Coach', icon: Sparkles },
  { to: '/jugadas', label: 'Jugadas IA', icon: ListVideo },
  { to: '/historial', label: 'Historial', icon: History },
  { to: '/recortes', label: 'Recortes', icon: Scissors },
]

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28">
        <rect x="1" y="1" width="26" height="26" rx="7" fill="#CBF62E" />
        <path d="M9 7v14M9 14l9-7M12 12l7 9" fill="none" stroke="#0F1405" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg font-bold tracking-[0.08em]">KORA</span>
    </div>
  )
}

export default function AppShell() {
  const { sport, setSport, data, video } = useStore()
  return (
    <div className="min-h-screen bg-bg text-ink" style={{ '--accent': data.accent } as CSSProperties}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-5 py-2.5">
        <Logo />
        <Segmented
          label="Deporte"
          accent
          value={sport}
          onChange={setSport}
          options={SPORT_LIST.map((s) => ({ id: s.id, label: s.label }))}
        />
        <span className="min-w-0 truncate text-sm">{video?.name ?? data.match}</span>
        {!video && <span className="rounded-md border border-line px-2 py-1 font-mono text-xs">1080p</span>}
        <SampleBadge />
        <div className="grow" />
        <Link to="/" className={btnPrimary}>
          <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
          Nuevo video
        </Link>
      </header>

      <div className="md:flex">
        <nav
          aria-label="Secciones"
          className="flex shrink-0 flex-wrap justify-center gap-1 border-b border-line bg-card p-2 md:w-[84px] md:flex-col md:justify-start md:border-r md:border-b-0"
        >
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 min-w-[68px] flex-col items-center justify-center gap-1 rounded-[10px] px-1.5 py-2 text-center text-[11px] font-medium no-underline',
                  isActive ? 'bg-raised text-lime' : 'text-mute hover:text-ink',
                )
              }
            >
              <Icon size={20} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

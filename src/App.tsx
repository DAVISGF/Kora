import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import Analysis from './pages/Analysis'
import Clips from './pages/Clips'
import Coach from './pages/Coach'
import HistoryPage from './pages/History'
import Ingest from './pages/Ingest'
import Plays from './pages/Plays'
import SupportCases from './pages/SupportCases'
import HelpdeskConsole from './pages/admin/HelpdeskConsole'

export default function App() {
  return (
    <Routes>
      {/* Kilora Admin Console: layout propio, fuera del shell de la app */}
      <Route path="admin/soporte" element={<HelpdeskConsole />} />
      <Route path="admin/soporte/:code" element={<HelpdeskConsole />} />
      <Route element={<AppShell />}>
        <Route index element={<Ingest />} />
        <Route path="analisis" element={<Analysis />} />
        <Route path="coach" element={<Coach />} />
        <Route path="jugadas" element={<Plays />} />
        <Route path="historial" element={<HistoryPage />} />
        <Route path="recortes" element={<Clips />} />
        <Route path="soporte" element={<SupportCases />} />
        <Route path="soporte/:id" element={<SupportCases />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

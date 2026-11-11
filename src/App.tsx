import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import Analysis from './pages/Analysis'
import Clips from './pages/Clips'
import Coach from './pages/Coach'
import HistoryPage from './pages/History'
import Ingest from './pages/Ingest'
import Plays from './pages/Plays'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Ingest />} />
        <Route path="analisis" element={<Analysis />} />
        <Route path="coach" element={<Coach />} />
        <Route path="jugadas" element={<Plays />} />
        <Route path="historial" element={<HistoryPage />} />
        <Route path="recortes" element={<Clips />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

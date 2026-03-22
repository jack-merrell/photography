import { Navigate, Route, Routes } from 'react-router-dom'
import ArchivePage from './pages/ArchivePage'
import GeotagPage from './pages/GeotagPage'
import PeopleCollagePage from './pages/PeopleCollagePage'

export default function App() {
  return (
    <Routes>
      <Route element={<ArchivePage />} path="/" />
      <Route element={<PeopleCollagePage />} path="/people" />
      <Route element={<GeotagPage />} path="/metadata" />
      <Route element={<Navigate replace to="/metadata" />} path="/geotag" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  )
}

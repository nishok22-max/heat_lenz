import { createBrowserRouter, Navigate } from 'react-router-dom'
import DashboardLayout from './layouts/DashboardLayout'
import RouteError from './components/layout/RouteError'
import NotFound from './components/layout/NotFound'
import Dashboard from './pages/Dashboard'
import ForecastView from './pages/ForecastView'
import InterventionsView from './pages/InterventionsView'
import HeatStressView from './pages/HeatStressView'
import ReportsView from './pages/ReportsView'
import AboutView from './pages/AboutView'
import MethodsView from './pages/MethodsView'
import ZoneView from './pages/ZoneView'
import AdvisoryView from './pages/AdvisoryView'
import PublicView from './pages/PublicView'
import CityMapView, { AdviceRedirect } from './pages/CityMapView'

export const router = createBrowserRouter([
  {
    element: <DashboardLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/forecast', element: <ForecastView /> },
      { path: '/heat-stress', element: <HeatStressView /> },
      { path: '/interventions', element: <InterventionsView /> },
      // Earlier addresses, kept so old links and bookmarks still open the right page.
      { path: '/emergency', element: <Navigate to="/heat-stress" replace /> },
      { path: '/simulator', element: <Navigate to="/interventions" replace /> },
      { path: '/vulnerable', element: <Navigate to="/heat-stress" replace /> },
      { path: '/history', element: <Navigate to="/?mode=history&date=2010-05-21" replace /> },
      { path: '/analytics', element: <Navigate to="/forecast" replace /> },
      { path: '/reports', element: <ReportsView /> },
      { path: '/about', element: <AboutView /> },
      { path: '/methods', element: <MethodsView /> },
      { path: '/zones/:zoneId', element: <ZoneView /> },
      { path: '/advisory/:zoneId', element: <AdvisoryView /> },
      { path: '/map', element: <CityMapView /> },
      { path: '/advice', element: <AdviceRedirect /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '/public/:zoneId', element: <PublicView />, errorElement: <RouteError /> },
], {
  basename: import.meta.env.BASE_URL,
})


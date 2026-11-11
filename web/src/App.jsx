import { useCallback } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider, useLangState } from './i18n/index.jsx';
import { SessionProvider, useSession } from './session.jsx';
import Layout from './components/Layout.jsx';
import { Loading, ToastProvider } from './components/ui.jsx';
import { Login, Register, Forgot, Reset, Invite } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import JobsPage from './pages/Jobs.jsx';
import JobNew from './pages/JobNew.jsx';
import JobPage from './pages/Job.jsx';
import Customers from './pages/Customers.jsx';
import Services from './pages/Services.jsx';
import People from './pages/People.jsx';
import { TeamEarnings, MyEarnings } from './pages/Earnings.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import Notifications from './pages/Notifications.jsx';
import Today from './pages/Today.jsx';
import CustomerHome from './pages/CustomerHome.jsx';

function home(user) {
  if (user.role === 'admin' || user.role === 'supervisor') return '/dashboard';
  if (user.role === 'worker') return '/today';
  return '/my-jobs';
}

function Guard({ roles, children }) {
  const { user } = useSession();
  if (roles && !roles.includes(user.role)) return <Navigate to={home(user)} replace />;
  return children;
}

function Routed() {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading full />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  const staff = ['admin', 'supervisor'];
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={home(user)} replace />} />
        <Route path="/login" element={<Navigate to={location.state?.from || home(user)} replace />} />
        <Route path="/invite/:token" element={<Navigate to={home(user)} replace />} />
        <Route path="/dashboard" element={<Guard roles={staff}><Dashboard /></Guard>} />
        <Route path="/jobs" element={<Guard roles={staff}><JobsPage /></Guard>} />
        <Route path="/jobs/new" element={<Guard roles={staff}><JobNew /></Guard>} />
        <Route path="/jobs/:id" element={<JobPage />} />
        <Route path="/customers" element={<Guard roles={staff}><Customers /></Guard>} />
        <Route path="/services" element={<Guard roles={staff}><Services /></Guard>} />
        <Route path="/people" element={<Guard roles={staff}><People /></Guard>} />
        <Route path="/earnings" element={<Guard roles={staff}><TeamEarnings /></Guard>} />
        <Route path="/my-earnings" element={<Guard roles={['worker', 'supervisor']}><MyEarnings /></Guard>} />
        <Route path="/today" element={<Guard roles={['worker', 'supervisor']}><Today /></Guard>} />
        <Route path="/my-jobs" element={<Guard roles={['customer']}><CustomerHome /></Guard>} />
        <Route path="/audit" element={<Guard roles={['admin']}><Audit /></Guard>} />
        <Route path="/settings" element={<Guard roles={['admin']}><Settings /></Guard>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to={home(user)} replace />} />
      </Routes>
    </Layout>
  );
}

function WithI18n({ lang, setLang }) {
  const { company } = useSession();
  return (
    <I18nProvider lang={lang} setLang={setLang} timeZone={company?.timezone} currency={company?.currency}>
      <ToastProvider><Routed /></ToastProvider>
    </I18nProvider>
  );
}

export default function App() {
  const [lang, setLang] = useLangState();
  const onLang = useCallback((l) => l && setLang(l), [setLang]);
  return (
    <SessionProvider onLang={onLang}>
      <WithI18n lang={lang} setLang={setLang} />
    </SessionProvider>
  );
}

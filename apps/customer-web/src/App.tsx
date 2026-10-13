import { Routes, Route } from 'react-router-dom';
import PhoneOnly, { isDesktopBlocked } from './pages/PhoneOnly';

export default function App() {
  if (typeof window !== 'undefined' && isDesktopBlocked(window.innerWidth, window.location.search)) return <PhoneOnly />;
  return (
    <div className="app" data-testid="app-shell">
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </div>
  );
}

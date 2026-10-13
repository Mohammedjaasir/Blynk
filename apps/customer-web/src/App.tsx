import { Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <div className="app" data-testid="app-shell">
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </div>
  );
}

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { RoleSwitcher } from './components/common/RoleSwitcher';
import { CustomerAppLayout } from './components/customer/CustomerAppLayout';
import { RiderAppLayout } from './components/rider/RiderAppLayout';
import { DarkStoreLayout } from './components/darkstore/DarkStoreLayout';
import { AdminLayout } from './components/admin/AdminLayout';

const AppContent: React.FC = () => {
  const { role, viewMode } = useApp();

  if (viewMode === 'split') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col">
        <RoleSwitcher />
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-800">
          <div className="p-4 bg-gray-100 text-blynk-dark flex justify-center items-start overflow-y-auto">
            <CustomerAppLayout />
          </div>
          <div className="p-4 bg-gray-100 text-blynk-dark overflow-y-auto">
            <AdminLayout />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
      <RoleSwitcher />

      <div className="flex-1">
        {role === 'customer' && <CustomerAppLayout />}
        {role === 'rider' && <RiderAppLayout />}
        {role === 'darkstore' && <DarkStoreLayout />}
        {role === 'admin' && <AdminLayout />}
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;

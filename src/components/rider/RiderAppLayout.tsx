import React, { useState } from 'react';
import { RiderDashboard } from './RiderDashboard';
import { RiderOrderDetails } from './RiderOrderDetails';
import { RiderEarnings } from './RiderEarnings';
import { Toast } from '../common/Toast';
import { Order } from '../../types';

export const RiderAppLayout: React.FC = () => {
  const [currentView, setCurrentView] = useState<'dashboard' | 'detail' | 'earnings'>('dashboard');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const handleSelectOrder = (order: Order) => {
    setSelectedOrder(order);
    setCurrentView('detail');
  };

  return (
    <div className="relative min-h-[calc(100vh-60px)] bg-gray-100 flex items-center justify-center p-0 sm:p-4">
      {/* Mobile Frame */}
      <div className="relative w-full max-w-[420px] bg-gray-50 sm:rounded-[36px] shadow-blynk-lg border border-gray-200 min-h-[840px] flex flex-col overflow-hidden">
        
        {/* Top Rider Header Notch Bar */}
        <div className="bg-blynk-dark text-white px-5 pt-3 pb-2 flex items-center justify-between text-xs font-bold border-b border-gray-800 select-none">
          <span className="text-blynk-yellow-400 font-black">BLYKN RIDER PRO</span>
          <div className="w-14 h-3 bg-gray-800 rounded-full" />
          <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full uppercase">
            Dharga Town
          </span>
        </div>

        {/* View Switcher */}
        <main className="flex-1 overflow-y-auto">
          {currentView === 'dashboard' && (
            <RiderDashboard 
              onSelectOrder={handleSelectOrder}
              onViewEarnings={() => setCurrentView('earnings')}
            />
          )}

          {currentView === 'detail' && selectedOrder && (
            <RiderOrderDetails
              order={selectedOrder}
              onBack={() => setCurrentView('dashboard')}
            />
          )}

          {currentView === 'earnings' && (
            <RiderEarnings
              onBack={() => setCurrentView('dashboard')}
            />
          )}
        </main>

        <Toast />
      </div>
    </div>
  );
};

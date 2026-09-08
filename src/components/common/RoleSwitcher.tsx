import React from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, Bike, PackageCheck, LayoutDashboard, Smartphone, Monitor, Columns } from 'lucide-react';
import { AppRole } from '../../types';

export const RoleSwitcher: React.FC = () => {
  const { role, setRole, viewMode, setViewMode, orders } = useApp();

  const activeOrdersCount = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;

  const roleButtons: { id: AppRole; label: string; icon: React.ReactNode; badge?: number; color: string }[] = [
    { id: 'customer', label: 'Customer App', icon: <ShoppingBag className="w-4 h-4" />, color: 'bg-blynk-green-500' },
    { id: 'rider', label: 'Rider App', icon: <Bike className="w-4 h-4" />, badge: orders.filter(o => o.status === 'out_for_delivery' || o.status === 'packed').length, color: 'bg-blue-600' },
    { id: 'darkstore', label: 'Dark Store Packing', icon: <PackageCheck className="w-4 h-4" />, badge: orders.filter(o => o.status === 'placed' || o.status === 'packed').length, color: 'bg-amber-600' },
    { id: 'admin', label: 'Admin Ops', icon: <LayoutDashboard className="w-4 h-4" />, badge: activeOrdersCount, color: 'bg-purple-600' },
  ];

  return (
    <header className="bg-blynk-dark text-white border-b border-gray-800 sticky top-0 z-50 px-4 py-2.5 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Logo & Launch Info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-blynk-green-500 text-white font-extrabold text-lg px-3 py-1 rounded-xl shadow-blynk-glow">
            <span className="text-xl tracking-tight font-black">Blynk</span>
            <span className="text-[10px] bg-blynk-yellow-400 text-blynk-dark font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
              Dharga Town
            </span>
          </div>
          <span className="hidden md:inline text-xs text-gray-400 border-l border-gray-700 pl-3">
            Grocery-Only Quick Commerce Platform
          </span>
        </div>

        {/* Role Selectors */}
        <div className="flex items-center gap-1.5 bg-gray-900/90 p-1 rounded-2xl border border-gray-800 overflow-x-auto max-w-full no-scrollbar">
          {roleButtons.map(b => {
            const isActive = role === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setRole(b.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  isActive 
                    ? `${b.color} text-white shadow-sm scale-[1.02]` 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {b.icon}
                <span>{b.label}</span>
                {b.badge !== undefined && b.badge > 0 && (
                  <span className={`px-1.5 py-0.2 text-[10px] font-bold rounded-full ${
                    isActive ? 'bg-white text-blynk-dark' : 'bg-blynk-green-500 text-white'
                  }`}>
                    {b.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* View Mode Toggle (Mobile / Desktop / Split) */}
        <div className="hidden lg:flex items-center gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800">
          <button
            onClick={() => setViewMode('mobile')}
            title="Mobile View (390px)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'mobile' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('desktop')}
            title="Full Width Desktop View"
            className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'desktop' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Monitor className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('split')}
            title="Split Dual View (Customer + Admin)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'split' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Columns className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

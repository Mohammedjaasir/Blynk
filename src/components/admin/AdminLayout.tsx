import React from 'react';
import { useApp } from '../../context/AppContext';
import { AdminDashboard } from './AdminDashboard';
import { AdminOrders } from './AdminOrders';
import { AdminInventory } from './AdminInventory';
import { AdminCatalog } from './AdminCatalog';
import { AdminRiders } from './AdminRiders';
import { AdminReports } from './AdminReports';
import { Toast } from '../common/Toast';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Package, 
  Store, 
  Bike, 
  BarChart3, 
  Bell, 
  Search,
  ChevronDown,
  Layers
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const { adminTab, setAdminTab, orders, products, riders } = useApp();

  const pendingOrdersCount = orders.filter(o => o.status === 'placed' || o.status === 'packed').length;
  const lowStockCount = products.filter(p => p.stock < 10).length;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'orders', label: 'Live Orders', icon: <ShoppingBag className="w-4 h-4" />, badge: pendingOrdersCount },
    { id: 'packing', label: 'Dark Store Queue', icon: <Package className="w-4 h-4" />, badge: orders.filter(o => o.status === 'placed').length },
    { id: 'inventory', label: 'Inventory Stock', icon: <Store className="w-4 h-4" />, badge: lowStockCount },
    { id: 'catalog', label: 'Catalog SKUs', icon: <Layers className="w-4 h-4" /> },
    { id: 'riders', label: 'Rider Fleet', icon: <Bike className="w-4 h-4" /> },
    { id: 'reports', label: 'Analytics Reports', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  const renderContent = () => {
    switch (adminTab) {
      case 'dashboard': return <AdminDashboard />;
      case 'orders': return <AdminOrders />;
      case 'packing': return <AdminOrders />;
      case 'inventory': return <AdminInventory />;
      case 'catalog': return <AdminCatalog />;
      case 'riders': return <AdminRiders />;
      case 'reports': return <AdminReports />;
      default: return <AdminDashboard />;
    }
  };

  return (
    <div className="min-h-[calc(100vh-60px)] bg-gray-100 flex flex-col md:flex-row font-sans">
      {/* Desktop Sidebar */}
      <aside className="w-full md:w-64 bg-blynk-dark text-white border-r border-gray-800 shrink-0 p-4 space-y-6 flex flex-col justify-between">
        <div className="space-y-6">
          {/* Logo & Hub Header */}
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="w-10 h-10 rounded-xl bg-blynk-green-500 text-white flex items-center justify-center font-black text-xl shadow-blynk-glow">
              B
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-white">Blynk Ops</h2>
              <p className="text-[10px] text-blynk-green-400 font-bold">Dharga Town Command Hub</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="space-y-1">
            {navItems.map(item => {
              const isActive = adminTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setAdminTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-extrabold transition-all ${
                    isActive
                      ? 'bg-blynk-green-500 text-white shadow-blynk-glow scale-[1.01]'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`px-2 py-0.5 text-[10px] font-black rounded-full ${
                      isActive ? 'bg-white text-blynk-dark' : 'bg-blynk-green-500 text-white'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Admin Footer Hub Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-xs space-y-1">
          <div className="flex items-center justify-between text-gray-400 font-bold">
            <span>Dark Store #01</span>
            <span className="w-2 h-2 rounded-full bg-blynk-green-500 animate-pulse" />
          </div>
          <p className="text-[11px] text-gray-300 font-semibold">Station Road, Dharga Town</p>
        </div>
      </aside>

      {/* Main Operations Body */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Operational Mode</span>
            <span className="text-xs font-black text-gray-900 capitalize bg-gray-100 px-3 py-1 rounded-xl">
              {adminTab}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-1.5 text-xs font-bold text-gray-800">
              <Store className="w-4 h-4 text-blynk-green-600" />
              <span>Dharga Town Dark Store</span>
            </div>

            <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
              OP
            </div>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-6 overflow-y-auto">
          {renderContent()}
        </main>
      </div>

      <Toast />
    </div>
  );
};

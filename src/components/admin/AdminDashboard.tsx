import React from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, TrendingUp, Clock, AlertTriangle, Users, PackageCheck, Bike, DollarSign } from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { orders, products, riders } = useApp();

  const totalOrdersCount = orders.length;
  const totalRevenue = orders.reduce((acc, o) => acc + o.total, 0) + 142800; // includes historical demo revenue
  const pendingPacking = orders.filter(o => o.status === 'placed').length;
  const readyRider = orders.filter(o => o.status === 'packed').length;
  const outForDelivery = orders.filter(o => o.status === 'out_for_delivery').length;
  const ridersOnlineCount = riders.filter(r => r.status !== 'offline').length;
  const lowStockCount = products.filter(p => p.availability === 'low_stock' || p.stock < 10).length;

  return (
    <div className="space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Revenue */}
        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Today's Revenue</span>
            <h3 className="text-2xl font-black text-gray-900 mt-1">Rs. {totalRevenue.toLocaleString()}</h3>
            <span className="text-[11px] font-bold text-blynk-green-600 flex items-center gap-1 mt-1">
              <TrendingUp className="w-3.5 h-3.5" /> +14.2% vs yesterday
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blynk-green-50 text-blynk-green-600 flex items-center justify-center shrink-0">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 2: Total Orders */}
        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Total Orders Today</span>
            <h3 className="text-2xl font-black text-gray-900 mt-1">{totalOrdersCount + 184}</h3>
            <span className="text-[11px] font-bold text-blue-600 flex items-center gap-1 mt-1">
              <ShoppingBag className="w-3.5 h-3.5" /> Dharga Town Store
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 3: Avg Delivery Time */}
        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Avg Delivery Time</span>
            <h3 className="text-2xl font-black text-gray-900 mt-1">24.5 mins</h3>
            <span className="text-[11px] font-bold text-blynk-green-600 flex items-center gap-1 mt-1">
              <Clock className="w-3.5 h-3.5" /> Within target window
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 4: Low Stock Alerts */}
        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Low Stock Alerts</span>
            <h3 className="text-2xl font-black text-amber-600 mt-1">{lowStockCount} SKUs</h3>
            <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1 mt-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Reorder required
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Operational Live Status Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider block">Needs Packing</span>
            <span className="text-xl font-black text-amber-900">{pendingPacking}</span>
          </div>
          <PackageCheck className="w-6 h-6 text-amber-600" />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-blue-800 uppercase tracking-wider block">Ready for Rider</span>
            <span className="text-xl font-black text-blue-900">{readyRider}</span>
          </div>
          <Bike className="w-6 h-6 text-blue-600" />
        </div>

        <div className="bg-blynk-green-50 border border-blynk-green-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-blynk-green-800 uppercase tracking-wider block">Out on Delivery</span>
            <span className="text-xl font-black text-blynk-green-900">{outForDelivery}</span>
          </div>
          <TrendingUp className="w-6 h-6 text-blynk-green-600" />
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-extrabold text-purple-800 uppercase tracking-wider block">Riders Online</span>
            <span className="text-xl font-black text-purple-900">{ridersOnlineCount} / {riders.length}</span>
          </div>
          <Users className="w-6 h-6 text-purple-600" />
        </div>
      </div>

      {/* Data Visualization Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hourly Order Volume Chart */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-gray-200 shadow-blynk-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-gray-900">Hourly Order Volume</h3>
              <p className="text-xs text-gray-500">Dharga Town Dark Store Peak Order Hours</p>
            </div>
            <span className="text-xs font-bold text-blynk-green-600 bg-blynk-green-50 px-3 py-1 rounded-xl">Today</span>
          </div>

          {/* Bar Chart Simulation */}
          <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 border-b border-gray-100 px-2">
            {[
              { hour: '7 AM', count: 12 },
              { hour: '8 AM', count: 28 },
              { hour: '9 AM', count: 45 },
              { hour: '10 AM', count: 32 },
              { hour: '11 AM', count: 18 },
              { hour: '12 PM', count: 22 },
              { hour: '1 PM', count: 38 },
              { hour: '2 PM', count: 15 },
              { hour: '3 PM', count: 24 },
              { hour: '4 PM', count: 42 },
              { hour: '5 PM', count: 50 },
            ].map(b => (
              <div key={b.hour} className="flex-1 flex flex-col items-center gap-2 group cursor-pointer">
                <div 
                  className="w-full bg-blynk-green-500 rounded-t-xl group-hover:bg-blynk-green-600 transition-all shadow-xs relative"
                  style={{ height: `${(b.count / 50) * 100}%` }}
                >
                  <span className="opacity-0 group-hover:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs transition-opacity">
                    {b.count}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">{b.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category Share Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-blynk-sm space-y-4">
          <h3 className="text-sm font-extrabold text-gray-900">Category Sales Share</h3>
          
          <div className="space-y-3">
            {[
              { name: 'Vegetables & Produce', pct: 35, color: 'bg-blynk-green-500' },
              { name: 'Dairy & Eggs', pct: 28, color: 'bg-blue-500' },
              { name: 'Rice & Grains', pct: 18, color: 'bg-amber-500' },
              { name: 'Snacks & Beverages', pct: 12, color: 'bg-purple-500' },
              { name: 'Bakery & Household', pct: 7, color: 'bg-gray-400' },
            ].map(cat => (
              <div key={cat.name} className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-gray-800">{cat.name}</span>
                  <span className="text-gray-600">{cat.pct}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${cat.color} rounded-full`} style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

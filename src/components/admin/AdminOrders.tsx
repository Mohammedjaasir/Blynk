import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, Bike, CheckCircle2, PackageCheck, AlertCircle, Phone, MapPin } from 'lucide-react';
import { OrderStatus } from '../../types';

export const AdminOrders: React.FC = () => {
  const { orders, riders, assignRiderToOrder, updateOrderStatus, showToast } = useApp();
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const filteredOrders = orders.filter(o => {
    const matchesStatus = selectedStatus === 'all' || o.status === selectedStatus;
    const matchesSearch = 
      o.id.toLowerCase().includes(search.toLowerCase()) ||
      o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.customerPhone.includes(search);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-gray-900">Real-Time Order Management</h2>
          <p className="text-xs text-gray-500 font-medium">Dharga Town Dark Store Operations</p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Order ID, Name or Phone..."
            className="w-full bg-white border border-gray-300 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 shadow-xs"
          />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex bg-white p-1 rounded-2xl border border-gray-200 shadow-xs overflow-x-auto no-scrollbar">
        {['all', 'placed', 'packed', 'out_for_delivery', 'delivered'].map(st => (
          <button
            key={st}
            onClick={() => setSelectedStatus(st)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all ${
              selectedStatus === st
                ? 'bg-blynk-green-500 text-white shadow-blynk-glow'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {st === 'all' ? 'All Orders' : st.replace('_', ' ').toUpperCase()}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-blynk-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                <th className="p-4">Order ID & Time</th>
                <th className="p-4">Customer Details</th>
                <th className="p-4">Items Count</th>
                <th className="p-4">Total & Payment</th>
                <th className="p-4">Status</th>
                <th className="p-4">Manual Rider Dispatch</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
              {filteredOrders.length > 0 ? (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="p-4">
                      <span className="font-black text-gray-900">#{order.id}</span>
                      <p className="text-[10px] text-gray-400 font-semibold">{order.createdAt}</p>
                    </td>

                    <td className="p-4">
                      <span className="font-extrabold text-gray-900">{order.customerName}</span>
                      <p className="text-[11px] text-gray-500">{order.customerPhone}</p>
                      <p className="text-[10px] text-gray-400 truncate max-w-[180px]">
                        {order.address.houseNo}, {order.address.street}
                      </p>
                    </td>

                    <td className="p-4">
                      <span className="font-bold text-gray-900">{order.items.length} Items</span>
                      <p className="text-[10px] text-gray-500 truncate max-w-[160px]">
                        {order.items.map(i => i.productName).join(', ')}
                      </p>
                    </td>

                    <td className="p-4">
                      <span className="font-black text-gray-900">Rs. {order.total}</span>
                      <span className="block text-[10px] text-blynk-green-700 font-bold">{order.paymentMethod}</span>
                    </td>

                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                        order.status === 'delivered'
                          ? 'bg-blynk-green-100 text-blynk-green-800'
                          : order.status === 'out_for_delivery'
                          ? 'bg-blue-100 text-blue-800'
                          : order.status === 'packed'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Manual Rider Dispatch Dropdown */}
                    <td className="p-4">
                      <select
                        value={order.riderId || ''}
                        onChange={e => {
                          if (e.target.value) {
                            assignRiderToOrder(order.id, e.target.value);
                          }
                        }}
                        className="bg-gray-50 border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:outline-none focus:border-blynk-green-500"
                      >
                        <option value="">-- Assign Rider --</option>
                        {riders.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.status.toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="p-4 text-right space-x-1">
                      {order.status === 'placed' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'packed')}
                          className="bg-amber-500 text-blynk-dark font-extrabold text-[11px] px-2.5 py-1 rounded-lg hover:bg-amber-600"
                        >
                          Pack Order
                        </button>
                      )}
                      {order.status === 'packed' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'out_for_delivery')}
                          className="bg-blue-600 text-white font-extrabold text-[11px] px-2.5 py-1 rounded-lg hover:bg-blue-700"
                        >
                          Dispatch
                        </button>
                      )}
                      {order.status === 'out_for_delivery' && (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'delivered')}
                          className="bg-blynk-green-500 text-white font-extrabold text-[11px] px-2.5 py-1 rounded-lg hover:bg-blynk-green-600"
                        >
                          Complete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400 font-medium">
                    No orders match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

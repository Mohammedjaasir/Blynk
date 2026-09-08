import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, ChevronRight, Truck, CheckCircle2 } from 'lucide-react';
import { Order } from '../../types';

export const OrdersHistoryView: React.FC = () => {
  const { orders, setActiveTrackingOrder, setCustomerTab } = useApp();
  const [filter, setFilter] = useState<'active' | 'past'>('active');

  const activeOrders = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  const pastOrders = orders.filter(o => o.status === 'delivered' || o.status === 'cancelled');

  const list = filter === 'active' ? activeOrders : pastOrders;

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-extrabold text-gray-900">Your Orders</h2>
        <p className="text-xs text-gray-500 font-medium">Blynk Dharga Town Delivery History</p>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 p-1 rounded-2xl">
        <button
          onClick={() => setFilter('active')}
          className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all ${
            filter === 'active' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Active Orders ({activeOrders.length})
        </button>
        <button
          onClick={() => setFilter('past')}
          className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all ${
            filter === 'past' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Past Orders ({pastOrders.length})
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {list.length > 0 ? (
          list.map(order => (
            <div
              key={order.id}
              className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div>
                  <span className="text-xs font-black text-gray-900">#{order.id}</span>
                  <p className="text-[10px] text-gray-400 font-medium">{order.createdAt}</p>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  order.status === 'delivered' 
                    ? 'bg-blynk-green-50 text-blynk-green-700 border border-blynk-green-200' 
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}>
                  {order.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <div>
                  <p className="font-extrabold text-gray-800">
                    {order.items.length} items • Rs. {order.total}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate max-w-[200px]">
                    {order.items.map(i => i.productName).join(', ')}
                  </p>
                </div>

                <button
                  onClick={() => {
                    setActiveTrackingOrder(order);
                    setCustomerTab('tracking');
                  }}
                  className="bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-blynk-glow flex items-center gap-1 shrink-0"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>Track</span>
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white rounded-3xl p-8 text-center space-y-2 border border-gray-100">
            <ShoppingBag className="w-10 h-10 text-gray-300 mx-auto" />
            <h4 className="text-sm font-extrabold text-gray-900">No {filter} orders found</h4>
            <p className="text-xs text-gray-500">Everyday essentials delivered right when you need them.</p>
          </div>
        )}
      </div>
    </div>
  );
};

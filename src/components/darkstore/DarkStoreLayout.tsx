import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PackageCheck, CheckSquare, Square, ArrowRight, Store, Clock, User, Bike } from 'lucide-react';
import { Order } from '../../types';
import { Toast } from '../common/Toast';

export const DarkStoreLayout: React.FC = () => {
  const { orders, toggleOrderItemPacked, updateOrderStatus, assignRiderToOrder, riders, showToast } = useApp();
  const [selectedTab, setSelectedTab] = useState<'new' | 'packing' | 'ready'>('new');
  const [activeOrderForPacking, setActiveOrderForPacking] = useState<Order | null>(null);

  const newOrders = orders.filter(o => o.status === 'placed');
  const packingOrders = orders.filter(o => o.status === 'packed' && (!o.items || o.items.some(i => !i.packed)));
  const readyOrders = orders.filter(o => o.status === 'packed' && o.items.every(i => i.packed) || o.status === 'out_for_delivery');

  const currentList = selectedTab === 'new' ? newOrders : selectedTab === 'packing' ? packingOrders : readyOrders;

  const handleStartPacking = (order: Order) => {
    setActiveOrderForPacking(order);
    setSelectedTab('packing');
  };

  const handleCompletePacking = (order: Order) => {
    updateOrderStatus(order.id, 'packed');
    showToast(`Order #${order.id} marked PACKED & READY FOR RIDER!`);
    setActiveOrderForPacking(null);
  };

  return (
    <div className="min-h-[calc(100vh-60px)] bg-gray-100 p-4 space-y-4">
      <div className="max-w-4xl mx-auto space-y-4">
        
        {/* Dark Store Header */}
        <div className="bg-gradient-to-r from-amber-950 via-gray-900 to-blynk-dark text-white rounded-3xl p-5 shadow-blynk-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 text-blynk-dark font-black text-xl flex items-center justify-center shadow-md">
              <PackageCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white">Dharga Town Dark Store #01</h1>
                <span className="bg-amber-500/20 border border-amber-400 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  OPERATIONAL QUEUE
                </span>
              </div>
              <p className="text-xs text-gray-300 font-medium">Packing & Inventory Dispatch Terminal</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs">
            <div className="text-right">
              <span className="text-gray-400 text-[10px] font-bold block">New Pending</span>
              <span className="text-lg font-black text-amber-400">{newOrders.length}</span>
            </div>
            <div className="text-right border-l border-gray-800 pl-4">
              <span className="text-gray-400 text-[10px] font-bold block">Packing</span>
              <span className="text-lg font-black text-blue-400">{packingOrders.length}</span>
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex bg-white p-1.5 rounded-2xl border border-gray-200 shadow-xs">
          <button
            onClick={() => setSelectedTab('new')}
            className={`flex-1 py-3 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-2 ${
              selectedTab === 'new' ? 'bg-amber-500 text-blynk-dark shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>1. New Orders ({newOrders.length})</span>
          </button>

          <button
            onClick={() => setSelectedTab('packing')}
            className={`flex-1 py-3 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-2 ${
              selectedTab === 'packing' ? 'bg-blynk-green-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>2. Packing Queue ({packingOrders.length})</span>
          </button>

          <button
            onClick={() => setSelectedTab('ready')}
            className={`flex-1 py-3 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-2 ${
              selectedTab === 'ready' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>3. Ready for Rider ({readyOrders.length})</span>
          </button>
        </div>

        {/* Packing Interface / List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Order Cards */}
          {currentList.length > 0 ? (
            currentList.map(order => {
              const allPacked = order.items.every(i => i.packed);
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <div>
                        <span className="text-xs font-black text-gray-900">Order #{order.id}</span>
                        <p className="text-[10px] text-gray-400 font-semibold">{order.createdAt} • {order.customerName}</p>
                      </div>
                      <span className="bg-amber-100 text-amber-900 border border-amber-300 text-xs font-extrabold px-2.5 py-1 rounded-xl">
                        {order.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Packing Checklist */}
                    <div className="space-y-2 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                      <span className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block mb-1">
                        Item Checklist ({order.items.filter(i => i.packed).length}/{order.items.length} Packed)
                      </span>

                      {order.items.map(item => (
                        <div
                          key={item.productId}
                          onClick={() => toggleOrderItemPacked(order.id, item.productId)}
                          className={`flex items-center justify-between p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                            item.packed
                              ? 'bg-blynk-green-50 border-blynk-green-300 text-blynk-green-900 line-through opacity-80'
                              : 'bg-white border-gray-200 text-gray-800 hover:border-gray-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {item.packed ? (
                              <CheckSquare className="w-4 h-4 text-blynk-green-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-400 shrink-0" />
                            )}
                            <span>{item.quantity}x {item.productName} ({item.unit})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-black text-gray-900">Total: Rs. {order.total}</span>

                    {selectedTab === 'new' ? (
                      <button
                        onClick={() => handleStartPacking(order)}
                        className="bg-amber-500 hover:bg-amber-600 text-blynk-dark font-extrabold text-xs px-4 py-2 rounded-xl shadow-xs flex items-center gap-1.5"
                      >
                        <span>Start Packing</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCompletePacking(order)}
                        className="bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-blynk-glow flex items-center gap-1.5"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>Mark Ready for Rider</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-2 bg-white rounded-3xl p-12 text-center space-y-2 border border-gray-200">
              <PackageCheck className="w-12 h-12 text-gray-300 mx-auto" />
              <h3 className="text-base font-black text-gray-900">No orders in this packing queue</h3>
              <p className="text-xs text-gray-500">Orders placed by customers will automatically appear here in real-time.</p>
            </div>
          )}
        </div>

      </div>

      <Toast />
    </div>
  );
};

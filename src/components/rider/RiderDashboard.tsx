import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Bike, Power, MapPin, Phone, CheckCircle2, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { Order } from '../../types';

export const RiderDashboard: React.FC<{ onSelectOrder: (order: Order) => void; onViewEarnings: () => void }> = ({ onSelectOrder, onViewEarnings }) => {
  const { activeRider, toggleRiderStatus, orders, showToast } = useApp();

  const isOnline = activeRider.status !== 'offline';

  // Find orders assigned to this rider or ready for delivery
  const assignedOrders = orders.filter(o => 
    (o.riderId === activeRider.id || o.status === 'packed' || o.status === 'out_for_delivery') &&
    o.status !== 'delivered' && o.status !== 'cancelled'
  );

  const completedToday = orders.filter(o => o.status === 'delivered').length + activeRider.completedToday;

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Header with Online/Offline Toggle */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white font-black text-lg flex items-center justify-center shadow-md">
            <Bike className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-sm font-black text-gray-900">{activeRider.name}</h2>
            <p className="text-xs text-gray-500 font-semibold">{activeRider.vehicleNo}</p>
          </div>
        </div>

        {/* Online / Offline Toggle Button */}
        <button
          onClick={() => toggleRiderStatus(activeRider.id)}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-extrabold text-xs transition-all shadow-xs ${
            isOnline
              ? 'bg-blynk-green-500 text-white shadow-blynk-glow'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          <Power className="w-4 h-4" />
          <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </button>
      </div>

      {/* Offline State Banner */}
      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 text-center space-y-2">
          <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
          <h3 className="text-sm font-extrabold text-amber-900">You are currently OFFLINE</h3>
          <p className="text-xs text-amber-700 font-medium max-w-xs mx-auto">
            Toggle your status to ONLINE to receive order assignments from Blynk Dark Store.
          </p>
        </div>
      )}

      {/* Rider Metrics */}
      {isOnline && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Today's</span>
              <span className="text-lg font-black text-gray-900">{completedToday}</span>
              <span className="text-[9px] text-gray-500 font-medium block">Completed</span>
            </div>

            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Assigned</span>
              <span className="text-lg font-black text-blynk-green-600">{assignedOrders.length}</span>
              <span className="text-[9px] text-gray-500 font-medium block">Pending</span>
            </div>

            <div 
              onClick={onViewEarnings}
              className="bg-blynk-green-50 p-3 rounded-2xl border border-blynk-green-200 shadow-xs text-center cursor-pointer hover:bg-blynk-green-100 transition-colors"
            >
              <span className="text-[10px] font-bold text-blynk-green-800 uppercase tracking-wider block">Payout</span>
              <span className="text-base font-black text-blynk-green-900">Rs. 3,840</span>
              <span className="text-[9px] text-blynk-green-700 font-bold block">Earnings →</span>
            </div>
          </div>

          {/* Assigned Delivery Cards Queue */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-gray-900">Assigned Deliveries ({assignedOrders.length})</h3>
              <span className="text-xs text-blynk-green-600 font-bold">Dharga Town Zone</span>
            </div>

            {assignedOrders.length > 0 ? (
              assignedOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3 cursor-pointer hover:border-blynk-green-400 transition-all group"
                >
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                    <div>
                      <span className="text-xs font-black text-gray-900">Order #{order.id}</span>
                      <p className="text-[10px] text-gray-400 font-semibold">{order.createdAt}</p>
                    </div>
                    <span className="bg-blynk-green-50 text-blynk-green-700 border border-blynk-green-200 text-xs font-extrabold px-2.5 py-0.5 rounded-full">
                      {order.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-blynk-green-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-extrabold text-gray-900">{order.customerName}</p>
                        <p className="text-gray-600 font-medium">{order.address.houseNo}, {order.address.street}, {order.address.area}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-gray-50 text-[11px]">
                      <span className="font-bold text-gray-700">{order.items.length} items • Rs. {order.total} ({order.paymentMethod})</span>
                      <div className="flex items-center gap-1 text-blynk-green-600 font-bold group-hover:translate-x-1 transition-transform">
                        <span>Details</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-3xl p-8 text-center space-y-2 border border-gray-100">
                <Bike className="w-10 h-10 text-gray-300 mx-auto" />
                <h4 className="text-sm font-extrabold text-gray-900">No active delivery assignments</h4>
                <p className="text-xs text-gray-500">Wait for dark store operators to dispatch new orders.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

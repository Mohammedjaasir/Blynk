import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Order, OrderStatus } from '../../types';
import { ArrowLeft, MapPin, Phone, Navigation, CheckCircle2, AlertOctagon, PackageCheck, Bike } from 'lucide-react';

export const RiderOrderDetails: React.FC<{ order: Order; onBack: () => void }> = ({ order, onBack }) => {
  const { updateOrderStatus, showToast } = useApp();
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState('');

  const handleStatusUpdate = (nextStatus: OrderStatus) => {
    updateOrderStatus(order.id, nextStatus, order.riderId || 'r1');
    showToast(`Order status updated to ${nextStatus.replace('_', ' ').toUpperCase()}`);
  };

  const handleReportIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIssue) return;
    showToast(`Issue reported for Order #${order.id}: "${selectedIssue}". Admin ops notified.`);
    setShowIssueModal(false);
  };

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Top Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-2xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Assigned Delivery</span>
          <h2 className="text-base font-black text-gray-900">Order #{order.id}</h2>
        </div>
      </div>

      {/* Customer Info Card */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-900">{order.customerName}</h3>
            <p className="text-xs text-gray-500 font-semibold">{order.customerPhone}</p>
          </div>

          <button
            onClick={() => showToast(`Calling ${order.customerName} (${order.customerPhone})...`)}
            className="px-3 py-2 bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-bold text-xs rounded-xl shadow-blynk-glow flex items-center gap-1.5"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Call</span>
          </button>
        </div>

        {/* Address & Navigation */}
        <div className="space-y-2">
          <div className="flex items-start gap-2.5 bg-gray-50 p-3 rounded-2xl border border-gray-200">
            <MapPin className="w-4 h-4 text-blynk-green-600 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Drop Address</span>
              <p className="text-xs font-extrabold text-gray-900 mt-0.5">
                {order.address.houseNo}, {order.address.street}, {order.address.area}
              </p>
              {order.address.landmark && (
                <p className="text-[11px] text-gray-500 mt-0.5">Landmark: {order.address.landmark}</p>
              )}
              {order.notes && (
                <p className="text-[11px] text-blynk-green-800 font-bold mt-1 bg-blynk-green-50 p-1.5 rounded-lg border border-blynk-green-200">
                  Customer Note: {order.notes}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => showToast(`Launching map navigation route to ${order.address.street}, Dharga Town...`)}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-sm flex items-center justify-center gap-2"
          >
            <Navigation className="w-4 h-4" />
            <span>Navigate Route (Maps)</span>
          </button>
        </div>
      </div>

      {/* Items Checklist Summary */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <h4 className="text-xs font-extrabold text-gray-900">Order Items ({order.items.length})</h4>
        <div className="space-y-2">
          {order.items.map(item => (
            <div key={item.productId} className="flex items-center justify-between text-xs border-b border-gray-50 pb-2 last:border-0">
              <span className="font-semibold text-gray-800">{item.quantity}x {item.productName} ({item.unit})</span>
              <span className="font-bold text-gray-900">Rs. {item.price * item.quantity}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 pt-2 flex justify-between text-xs font-extrabold text-gray-900">
          <span>Payment Collection</span>
          <span className="text-blynk-green-600">Rs. {order.total} ({order.paymentMethod})</span>
        </div>
      </div>

      {/* Delivery Action Status Flow */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3">
        <h4 className="text-xs font-extrabold text-gray-900">Update Delivery Progress</h4>

        <div className="space-y-2">
          {order.status === 'placed' || order.status === 'packed' ? (
            <button
              onClick={() => handleStatusUpdate('out_for_delivery')}
              className="w-full py-3 bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs rounded-2xl shadow-blynk-glow flex items-center justify-center gap-2"
            >
              <Bike className="w-4 h-4" />
              <span>Mark "Picked Up & Out for Delivery"</span>
            </button>
          ) : order.status === 'out_for_delivery' ? (
            <button
              onClick={() => handleStatusUpdate('delivered')}
              className="w-full py-3 bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs rounded-2xl shadow-blynk-glow flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark "Delivered to Customer"</span>
            </button>
          ) : (
            <div className="p-3 bg-blynk-green-50 text-blynk-green-800 text-xs font-bold rounded-2xl text-center">
              Order Delivered Successfully
            </div>
          )}

          <button
            onClick={() => setShowIssueModal(true)}
            className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
          >
            <AlertOctagon className="w-4 h-4" />
            <span>Report Issue with Delivery</span>
          </button>
        </div>
      </div>

      {/* Report Issue Modal */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-white rounded-3xl p-5 space-y-4 shadow-blynk-lg">
            <h3 className="text-sm font-extrabold text-gray-900">Report Delivery Issue</h3>

            <div className="space-y-2 text-xs">
              {[
                'Customer phone unreachable',
                'Incorrect address or house locked',
                'Customer requested delay',
                'Damaged or missing package item'
              ].map(issue => (
                <button
                  key={issue}
                  type="button"
                  onClick={() => setSelectedIssue(issue)}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                    selectedIssue === issue
                      ? 'border-red-500 bg-red-50 text-red-900'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {issue}
                </button>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowIssueModal(false)}
                className="w-1/2 py-2 bg-gray-100 text-gray-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleReportIssue}
                className="w-1/2 py-2 bg-red-600 text-white font-bold text-xs rounded-xl"
              >
                Submit Alert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

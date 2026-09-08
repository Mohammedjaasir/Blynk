import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, Truck, ArrowRight, ShoppingBag } from 'lucide-react';

export const OrderSuccessView: React.FC = () => {
  const { activeTrackingOrder, setCustomerTab } = useApp();

  const order = activeTrackingOrder;

  return (
    <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center p-6 text-center space-y-5 animate-in zoom-in-95 duration-300">
      {/* Icon */}
      <div className="w-20 h-20 rounded-full bg-blynk-green-500 text-white flex items-center justify-center shadow-blynk-glow animate-bounce-short">
        <CheckCircle2 className="w-12 h-12" />
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-extrabold text-gray-900">Order Placed!</h2>
        <p className="text-xs text-gray-500 max-w-xs font-medium">
          Everyday essentials are being assigned to our dark store packing team in Dharga Town.
        </p>
      </div>

      {/* Order Card Summary */}
      {order && (
        <div className="w-full max-w-xs bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm text-left space-y-2">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <span className="text-xs font-bold text-gray-500">Order ID</span>
            <span className="text-xs font-extrabold text-gray-900">#{order.id}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Est. Delivery</span>
            <span className="font-extrabold text-blynk-green-600">{order.estimatedTime}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Total Amount</span>
            <span className="font-extrabold text-gray-900">Rs. {order.total} ({order.paymentMethod})</span>
          </div>
        </div>
      )}

      {/* CTAs */}
      <div className="w-full max-w-xs space-y-2.5 pt-2">
        <button
          onClick={() => setCustomerTab('tracking')}
          className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold py-3.5 px-4 rounded-2xl shadow-blynk-glow flex items-center justify-center gap-2"
        >
          <Truck className="w-4 h-4" />
          <span>Track Order Live</span>
        </button>

        <button
          onClick={() => setCustomerTab('home')}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs py-3 px-4 rounded-2xl transition-colors flex items-center justify-center gap-1.5"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Continue Shopping</span>
        </button>
      </div>
    </div>
  );
};

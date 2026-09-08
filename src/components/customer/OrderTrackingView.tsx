import React from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Package, 
  Bike, 
  CheckCircle2, 
  Phone, 
  MapPin, 
  Clock, 
  ChevronRight,
  Store
} from 'lucide-react';
import { OrderStatus } from '../../types';

export const OrderTrackingView: React.FC = () => {
  const { activeTrackingOrder, orders, setCustomerTab, showToast } = useApp();

  const order = activeTrackingOrder || orders[0];

  if (!order) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-bold text-gray-700">No active orders to track</p>
        <button
          onClick={() => setCustomerTab('home')}
          className="bg-blynk-green-500 text-white font-bold text-xs px-4 py-2 rounded-xl"
        >
          Start Shopping
        </button>
      </div>
    );
  }

  // Determine timeline steps active index
  const getStepIndex = (status: OrderStatus) => {
    switch (status) {
      case 'placed': return 0;
      case 'packed': return 1;
      case 'out_for_delivery': return 2;
      case 'delivered': return 3;
      case 'cancelled': return -1;
      default: return 0;
    }
  };

  const currentStep = getStepIndex(order.status);

  const timeline = [
    { title: 'Order Placed', desc: 'Received at Blynk Dark Store', icon: <Store className="w-4 h-4" /> },
    { title: 'Order Packed', desc: 'Items checked & bagged by staff', icon: <Package className="w-4 h-4" /> },
    { title: 'Out for Delivery', desc: 'Rider is on the way to your address', icon: <Bike className="w-4 h-4" /> },
    { title: 'Delivered', desc: 'Handed over at your doorstep', icon: <CheckCircle2 className="w-4 h-4" /> },
  ];

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-extrabold text-blynk-green-600 uppercase tracking-wider">Live Tracking</span>
          <h2 className="text-base font-black text-gray-900">Order #{order.id}</h2>
        </div>
        <span className="bg-blynk-green-50 text-blynk-green-700 border border-blynk-green-200 text-xs font-bold px-2.5 py-1 rounded-xl">
          {order.status.replace('_', ' ').toUpperCase()}
        </span>
      </div>

      {/* Arrival Banner */}
      <div className="bg-gradient-to-r from-blynk-dark to-gray-800 text-white p-4 rounded-3xl shadow-blynk-md space-y-1">
        <div className="flex items-center gap-2 text-blynk-yellow-400">
          <Clock className="w-4 h-4 animate-pulse" />
          <span className="text-xs font-bold">Estimated Delivery Time</span>
        </div>
        <h3 className="text-xl font-black tracking-tight">{order.estimatedTime}</h3>
        <p className="text-[11px] text-gray-300">
          Delivering to <span className="font-bold text-white">{order.address.label} • {order.address.street}</span>
        </p>
      </div>

      {/* Stylized Local Map UI */}
      <div className="relative w-full h-36 bg-emerald-950/90 rounded-3xl overflow-hidden border border-emerald-800 p-3 shadow-inner flex flex-col justify-between">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#00B761_1px,transparent_1px)] [background-size:16px_16px]" />
        
        {/* Route Line Graphic */}
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-1 bg-blynk-green-700/60 rounded-full">
          <div 
            className="h-full bg-blynk-green-400 rounded-full transition-all duration-700 shadow-blynk-glow"
            style={{ width: `${Math.min(100, Math.max(15, (currentStep + 1) * 25))}%` }}
          />
        </div>

        {/* Map Nodes */}
        <div className="relative z-10 flex items-center justify-between text-white text-[10px] font-bold">
          <div className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-full bg-blynk-green-500 text-white flex items-center justify-center shadow-blynk-glow border-2 border-emerald-900">
              <Store className="w-4 h-4" />
            </div>
            <span>Dark Store</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 border-emerald-900 shadow-blynk-glow transition-all ${
              currentStep >= 2 ? 'bg-blynk-yellow-400 text-blynk-dark animate-bounce-short' : 'bg-gray-700 text-gray-400'
            }`}>
              <Bike className="w-5 h-5" />
            </div>
            <span className="text-blynk-yellow-300 font-extrabold">Rider</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-blynk-glow border-2 border-emerald-900">
              <MapPin className="w-4 h-4" />
            </div>
            <span>Home</span>
          </div>
        </div>

        <div className="relative z-10 text-[10px] text-emerald-200 font-medium text-center">
          Dharga Town Express Route Active
        </div>
      </div>

      {/* Assigned Rider Card */}
      {order.riderName ? (
        <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blynk-green-100 text-blynk-green-700 flex items-center justify-center shrink-0 font-black text-sm">
              <Bike className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-extrabold text-gray-900">{order.riderName}</h4>
                <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">
                  ★ 4.9
                </span>
              </div>
              <p className="text-[10px] text-gray-500 font-medium">Blynk Delivery Rider</p>
              <p className="text-[10px] text-blynk-green-700 font-bold mt-0.5">Assigned to your order</p>
            </div>
          </div>

          <button
            onClick={() => showToast(`Calling rider ${order.riderName} (${order.riderPhone || '+94 77 123 4567'})...`)}
            className="w-10 h-10 rounded-2xl bg-blynk-green-500 text-white flex items-center justify-center shadow-blynk-glow hover:bg-blynk-green-600 shrink-0"
            title="Call Rider"
          >
            <Phone className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="bg-blynk-green-50 border border-blynk-green-200 p-3 rounded-2xl text-xs text-blynk-green-900 flex items-center justify-between">
          <span>Rider assignment in progress at dark store...</span>
          <Bike className="w-4 h-4 text-blynk-green-600 animate-pulse" />
        </div>
      )}

      {/* Progress Timeline */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-4">
        <h3 className="text-xs font-extrabold text-gray-900">Order Progress Timeline</h3>

        <div className="space-y-4 pl-2">
          {timeline.map((step, idx) => {
            const isPassed = idx <= currentStep;
            const isCurrent = idx === currentStep;
            return (
              <div key={step.title} className="relative flex items-start gap-3">
                {/* Vertical connecting line */}
                {idx < timeline.length - 1 && (
                  <div className={`absolute left-3 top-6 w-0.5 h-8 -ml-px ${
                    idx < currentStep ? 'bg-blynk-green-500' : 'bg-gray-200'
                  }`} />
                )}

                {/* Step Icon Node */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold z-10 ${
                  isPassed 
                    ? 'bg-blynk-green-500 text-white shadow-blynk-glow' 
                    : 'bg-gray-100 text-gray-400 border border-gray-200'
                }`}>
                  {isPassed ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                </div>

                <div>
                  <h4 className={`text-xs font-extrabold ${isCurrent ? 'text-blynk-green-600' : isPassed ? 'text-gray-900' : 'text-gray-400'}`}>
                    {step.title}
                  </h4>
                  <p className="text-[11px] text-gray-500 font-medium">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Order Items List Summary */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <h4 className="text-xs font-extrabold text-gray-900">Order Items ({order.items.length})</h4>
          <span className="text-xs font-extrabold text-gray-900">Total: Rs. {order.total}</span>
        </div>

        <div className="space-y-2 pt-1">
          {order.items.map(item => (
            <div key={item.productId} className="flex items-center justify-between text-xs">
              <span className="text-gray-700 font-semibold">{item.quantity}x {item.productName}</span>
              <span className="font-bold text-gray-900">Rs. {item.price * item.quantity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

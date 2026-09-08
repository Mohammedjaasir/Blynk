import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { MapPin, Banknote, CreditCard, ShieldCheck, ArrowRight, Check } from 'lucide-react';
import { LocationSelector } from './LocationSelector';

export const CheckoutView: React.FC = () => {
  const { 
    cart, 
    cartTotalItems, 
    cartSubtotal, 
    cartDeliveryFee, 
    cartGrandTotal, 
    selectedAddress, 
    placeOrder, 
    setCustomerTab 
  } = useApp();

  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'ONLINE'>('COD');
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notes, setNotes] = useState('');

  const handlePlaceOrder = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      placeOrder(paymentMethod, notes);
      setIsSubmitting(false);
      setCustomerTab('success');
    }, 600);
  };

  return (
    <div className="pb-28 pt-2 px-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-extrabold text-gray-900">Checkout</h2>
        <p className="text-xs text-gray-500 font-medium">Blynk Dharga Town Quick Delivery</p>
      </div>

      {/* 1. Address Card */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blynk-green-500" />
            <h3 className="text-xs font-extrabold text-gray-900">Delivery Address</h3>
          </div>
          <button
            onClick={() => setIsLocationModalOpen(true)}
            className="text-xs text-blynk-green-600 font-bold hover:underline"
          >
            Change
          </button>
        </div>

        <div className="bg-gray-50 p-3 rounded-2xl border border-gray-200">
          <span className="font-extrabold text-xs text-gray-900">{selectedAddress.label}</span>
          <p className="text-xs text-gray-600 font-medium mt-0.5">
            {selectedAddress.houseNo}, {selectedAddress.street}, {selectedAddress.area}
          </p>
          {selectedAddress.instructions && (
            <p className="text-[10px] text-gray-400 mt-1 font-medium">
              Note: {selectedAddress.instructions}
            </p>
          )}
        </div>
      </div>

      {/* 2. Payment Method */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3">
        <h3 className="text-xs font-extrabold text-gray-900">Payment Method</h3>

        <div className="space-y-2">
          {/* COD Card */}
          <div
            onClick={() => setPaymentMethod('COD')}
            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
              paymentMethod === 'COD'
                ? 'border-blynk-green-500 bg-blynk-green-50/50 shadow-xs'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-extrabold text-gray-900">Cash on Delivery (COD)</p>
                <p className="text-[10px] text-gray-500">Pay cash upon receiving your order</p>
              </div>
            </div>

            {paymentMethod === 'COD' && (
              <div className="w-5 h-5 rounded-full bg-blynk-green-500 text-white flex items-center justify-center">
                <Check className="w-3.5 h-3.5" />
              </div>
            )}
          </div>

          {/* ONLINE Payment Card */}
          <div
            onClick={() => setPaymentMethod('ONLINE')}
            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
              paymentMethod === 'ONLINE'
                ? 'border-blynk-green-500 bg-blynk-green-50/50 shadow-xs'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-extrabold text-gray-900">Online Card Payment</p>
                  <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1.5 py-0.2 rounded">Secure</span>
                </div>
                <p className="text-[10px] text-gray-500">Visa / Mastercard / WebPay</p>
              </div>
            </div>

            {paymentMethod === 'ONLINE' && (
              <div className="w-5 h-5 rounded-full bg-blynk-green-500 text-white flex items-center justify-center">
                <Check className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Delivery Instructions / Notes */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <label className="block text-xs font-extrabold text-gray-900">Delivery Notes for Rider (Optional)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Leave at door, call before arrival..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
        />
      </div>

      {/* 4. Order Summary */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <h3 className="text-xs font-extrabold text-gray-900">Order Summary ({cartTotalItems} items)</h3>
        
        <div className="flex justify-between text-xs text-gray-600 font-medium">
          <span>Item Total</span>
          <span className="font-bold text-gray-900">Rs. {cartSubtotal}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-600 font-medium">
          <span>Delivery Charge</span>
          <span className="font-bold text-gray-900">
            {cartDeliveryFee === 0 ? <span className="text-blynk-green-600">FREE</span> : `Rs. ${cartDeliveryFee}`}
          </span>
        </div>
        <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-black text-gray-900">
          <span>Total Payable</span>
          <span className="text-blynk-green-600">Rs. {cartGrandTotal}</span>
        </div>
      </div>

      {/* Sticky Place Order CTA */}
      <div className="fixed bottom-14 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-40">
        <button
          onClick={handlePlaceOrder}
          disabled={isSubmitting}
          className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 disabled:opacity-50 text-white font-extrabold py-3.5 px-5 rounded-2xl shadow-blynk-glow flex items-center justify-between active:scale-98 transition-transform"
        >
          <div className="text-left">
            <span className="text-[10px] font-bold text-blynk-green-100 uppercase tracking-wider block">Payable via {paymentMethod}</span>
            <span className="text-base">Rs. {cartGrandTotal}</span>
          </div>

          <div className="flex items-center gap-1.5 text-sm">
            <span>{isSubmitting ? 'Placing Order...' : 'Place Order'}</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </button>
      </div>

      <LocationSelector isOpen={isLocationModalOpen} onClose={() => setIsLocationModalOpen(false)} />
    </div>
  );
};

import React from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, ArrowRight, Trash2, MapPin, Truck, ShieldCheck } from 'lucide-react';
import { QuantitySelector } from '../common/QuantitySelector';

export const CartView: React.FC = () => {
  const { 
    cart, 
    cartTotalItems, 
    cartSubtotal, 
    cartDeliveryFee, 
    cartGrandTotal, 
    selectedAddress, 
    setCustomerTab, 
    clearCart 
  } = useApp();

  if (cart.length === 0) {
    return (
      <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-blynk-green-50 text-blynk-green-500 flex items-center justify-center border border-blynk-green-100 shadow-blynk-sm">
          <ShoppingBag className="w-10 h-10" />
        </div>
        
        <div className="space-y-1">
          <h3 className="text-lg font-extrabold text-gray-900">Your cart is waiting</h3>
          <p className="text-xs text-gray-500 max-w-xs">
            Add some everyday fresh essentials to get started with fast local delivery.
          </p>
        </div>

        <button
          onClick={() => setCustomerTab('home')}
          className="bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs px-6 py-3 rounded-2xl shadow-blynk-glow flex items-center gap-2 active:scale-98 transition-transform"
        >
          <span>Start Shopping</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="pb-28 pt-2 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold text-gray-900">Your Cart</h2>
          <p className="text-xs text-gray-500 font-medium">{cartTotalItems} items from Blynk Dark Store</p>
        </div>
        <button
          onClick={clearCart}
          className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>

      {/* Delivery address preview */}
      <div className="bg-blynk-green-50 border border-blynk-green-200 p-3 rounded-2xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blynk-green-500 text-white flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-blynk-green-800 uppercase tracking-wider">Delivering to</span>
            <p className="text-xs font-extrabold text-gray-900 truncate max-w-[200px]">
              {selectedAddress.label} • {selectedAddress.street}
            </p>
          </div>
        </div>
      </div>

      {/* Product List */}
      <div className="bg-white rounded-3xl p-3 border border-gray-100 shadow-blynk-sm space-y-3">
        {cart.map(item => (
          <div
            key={item.product.id}
            className="flex items-center justify-between gap-3 border-b border-gray-100 last:border-0 pb-3 last:pb-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 bg-gray-50 rounded-xl overflow-hidden p-1 shrink-0 flex items-center justify-center">
                <img src={item.product.image} alt={item.product.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-gray-900 line-clamp-1">
                  {item.product.name}
                </h4>
                <p className="text-[10px] text-gray-500 font-medium">{item.product.unit}</p>
                <p className="text-xs font-black text-gray-900 mt-0.5">Rs. {item.product.price * item.quantity}</p>
              </div>
            </div>

            <QuantitySelector product={item.product} size="sm" />
          </div>
        ))}
      </div>

      {/* Bill Breakdown */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2.5">
        <h4 className="text-xs font-extrabold text-gray-900">Bill Details</h4>

        <div className="flex justify-between text-xs text-gray-600 font-medium">
          <span>Items Subtotal</span>
          <span className="font-bold text-gray-900">Rs. {cartSubtotal}</span>
        </div>

        <div className="flex justify-between text-xs text-gray-600 font-medium">
          <div className="flex items-center gap-1">
            <span>Delivery Charge</span>
            <Truck className="w-3.5 h-3.5 text-blynk-green-600" />
          </div>
          <span className="font-bold text-gray-900">
            {cartDeliveryFee === 0 ? <span className="text-blynk-green-600">FREE</span> : `Rs. ${cartDeliveryFee}`}
          </span>
        </div>

        <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-extrabold text-gray-900">
          <span>Grand Total</span>
          <span className="text-blynk-green-600">Rs. {cartGrandTotal}</span>
        </div>
      </div>

      {/* Sticky Bottom Checkout CTA */}
      <div className="fixed bottom-14 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-40">
        <button
          onClick={() => setCustomerTab('checkout')}
          className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold py-3.5 px-5 rounded-2xl shadow-blynk-glow flex items-center justify-between active:scale-98 transition-transform"
        >
          <div className="text-left">
            <span className="text-[10px] font-bold text-blynk-green-100 uppercase tracking-wider block">Total Amount</span>
            <span className="text-base">Rs. {cartGrandTotal}</span>
          </div>

          <div className="flex items-center gap-1 text-sm">
            <span>Proceed to Checkout</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { Product } from '../../types';
import { useApp } from '../../context/AppContext';

interface QuantitySelectorProps {
  product: Product;
  size?: 'sm' | 'md' | 'lg';
}

export const QuantitySelector: React.FC<QuantitySelectorProps> = ({ product, size = 'md' }) => {
  const { cart, addToCart, updateCartQuantity } = useApp();

  const cartItem = cart.find(i => i.product.id === product.id);
  const quantity = cartItem ? cartItem.quantity : 0;
  const isOutOfStock = product.availability === 'out_of_stock';

  if (isOutOfStock) {
    return (
      <span className="inline-block text-[11px] font-bold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200 text-center">
        Out of stock
      </span>
    );
  }

  if (quantity === 0) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          addToCart(product, 1);
        }}
        className={`font-extrabold text-blynk-green-600 bg-blynk-green-50 hover:bg-blynk-green-500 hover:text-white border border-blynk-green-300 transition-all rounded-xl shadow-xs flex items-center justify-center gap-1 active:scale-95 ${
          size === 'sm' ? 'px-2.5 py-1 text-xs' : size === 'lg' ? 'px-5 py-2 text-sm' : 'px-3 py-1.5 text-xs'
        }`}
      >
        <Plus className="w-3.5 h-3.5" />
        <span>ADD</span>
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center justify-between bg-blynk-green-500 text-white font-extrabold rounded-xl shadow-blynk-glow transition-all ${
        size === 'sm' ? 'px-1.5 py-0.5 text-xs gap-1.5' : size === 'lg' ? 'px-3 py-1.5 text-sm gap-3' : 'px-2 py-1 text-xs gap-2'
      }`}
    >
      <button
        onClick={() => updateCartQuantity(product.id, -1)}
        className="p-1 hover:bg-blynk-green-600 rounded-lg active:scale-90 transition-transform"
        aria-label="Decrease quantity"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <span className="min-w-[16px] text-center font-bold tracking-tight">{quantity}</span>

      <button
        onClick={() => updateCartQuantity(product.id, 1)}
        className="p-1 hover:bg-blynk-green-600 rounded-lg active:scale-90 transition-transform"
        aria-label="Increase quantity"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

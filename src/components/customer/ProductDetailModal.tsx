import React from 'react';
import { useApp } from '../../context/AppContext';
import { BottomSheet } from '../common/BottomSheet';
import { QuantitySelector } from '../common/QuantitySelector';
import { Sparkles, ShieldCheck, Truck } from 'lucide-react';

export const ProductDetailModal: React.FC = () => {
  const { selectedProduct, setSelectedProduct } = useApp();

  if (!selectedProduct) return null;

  return (
    <BottomSheet
      isOpen={!!selectedProduct}
      onClose={() => setSelectedProduct(null)}
      title={selectedProduct.name}
    >
      <div className="space-y-4">
        {/* Product image container */}
        <div className="relative w-full h-52 bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 flex items-center justify-center p-4">
          <img
            src={selectedProduct.image}
            alt={selectedProduct.name}
            className="max-h-full max-w-full object-contain hover:scale-105 transition-transform duration-300"
          />
          {selectedProduct.isFresh && (
            <span className="absolute top-3 left-3 bg-blynk-green-500 text-white font-extrabold text-[10px] uppercase px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-blynk-yellow-400" />
              Daily Fresh
            </span>
          )}
        </div>

        {/* Brand & Title */}
        <div>
          <span className="text-[11px] font-bold text-blynk-green-600 uppercase tracking-wider">
            {selectedProduct.brand}
          </span>
          <h2 className="text-lg font-extrabold text-gray-900 leading-snug mt-0.5">
            {selectedProduct.name}
          </h2>
          <p className="text-xs text-gray-500 font-medium mt-0.5">{selectedProduct.unit}</p>
        </div>

        {/* Price & Quantity Selector */}
        <div className="flex items-center justify-between bg-gray-50 p-3.5 rounded-2xl border border-gray-100">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-gray-900">
                Rs. {selectedProduct.price}
              </span>
              {selectedProduct.originalPrice && (
                <span className="text-xs font-bold text-gray-400 line-through">
                  Rs. {selectedProduct.originalPrice}
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 font-medium">Inclusive of all local taxes</p>
          </div>

          <QuantitySelector product={selectedProduct} size="lg" />
        </div>

        {/* Description */}
        {selectedProduct.description && (
          <div className="bg-white p-3 border border-gray-100 rounded-xl">
            <h4 className="text-xs font-bold text-gray-700 mb-1">Product Highlights</h4>
            <p className="text-xs text-gray-600 leading-relaxed font-medium">
              {selectedProduct.description}
            </p>
          </div>
        )}

        {/* Delivery Guarantee Card */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-blynk-green-50 p-2.5 rounded-xl border border-blynk-green-100 flex items-center gap-2">
            <Truck className="w-4 h-4 text-blynk-green-600 shrink-0" />
            <div>
              <p className="text-[11px] font-bold text-blynk-green-900">Direct Dark Store</p>
              <p className="text-[9px] text-blynk-green-700">Stocked in Dharga Town</p>
            </div>
          </div>

          <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <div>
              <p className="text-[11px] font-bold text-blue-900">Quality Assured</p>
              <p className="text-[9px] text-blue-700">Freshness guaranteed</p>
            </div>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
};

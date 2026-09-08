import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CategoryId, Product } from '../../types';
import { QuantitySelector } from '../common/QuantitySelector';
import { Sparkles, Filter } from 'lucide-react';

export const CategoryScreen: React.FC = () => {
  const { categories, products, selectedCategoryId, setSelectedCategoryId, setSelectedProduct } = useApp();
  const [activeSubcategory, setActiveSubcategory] = useState<string>('All');

  const activeCategory = categories.find(c => c.id === selectedCategoryId) || categories[0];

  // Filter products by selected category and subcategory
  const filteredProducts = products.filter(p => {
    if (p.category !== selectedCategoryId) return false;
    if (activeSubcategory !== 'All' && p.subcategory !== activeSubcategory) return false;
    return true;
  });

  return (
    <div className="pb-24 pt-2 flex flex-col h-[calc(100vh-120px)] overflow-hidden">
      {/* Category Selection Bar */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-extrabold text-gray-900 mb-2">Categories</h2>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {categories.map(cat => {
            const isSelected = cat.id === selectedCategoryId;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategoryId(cat.id);
                  setActiveSubcategory('All');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-blynk-green-500 text-white shadow-blynk-glow scale-[1.02]'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Subcategory Sidebar */}
        <div className="w-28 bg-gray-50 border-r border-gray-200 overflow-y-auto p-2 space-y-1 shrink-0">
          <button
            onClick={() => setActiveSubcategory('All')}
            className={`w-full text-left p-2 rounded-xl text-[11px] font-bold transition-colors ${
              activeSubcategory === 'All'
                ? 'bg-blynk-green-500 text-white shadow-xs'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Items
          </button>
          {activeCategory.subcategories.map(sub => (
            <button
              key={sub}
              onClick={() => setActiveSubcategory(sub)}
              className={`w-full text-left p-2 rounded-xl text-[11px] font-bold transition-colors ${
                activeSubcategory === sub
                  ? 'bg-blynk-green-500 text-white shadow-xs'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {sub}
            </button>
          ))}
        </div>

        {/* Right Product Grid */}
        <div className="flex-1 overflow-y-auto p-3 bg-gray-100">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold text-gray-500">
              Showing {filteredProducts.length} products
            </span>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5">
              {filteredProducts.map(product => (
                <CategoryProductCard
                  key={product.id}
                  product={product}
                  onSelect={() => setSelectedProduct(product)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm font-bold text-gray-700">No items found in this section</p>
              <p className="text-xs text-gray-400">Try selecting another subcategory</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CategoryProductCard: React.FC<{ product: Product; onSelect: () => void }> = ({ product, onSelect }) => {
  return (
    <div
      onClick={onSelect}
      className="bg-white rounded-2xl p-2.5 border border-gray-100 shadow-blynk-sm flex flex-col justify-between h-[210px] cursor-pointer hover:border-blynk-green-300 transition-all group"
    >
      <div className="relative w-full h-24 bg-gray-50 rounded-xl overflow-hidden p-1 flex items-center justify-center">
        <img
          src={product.image}
          alt={product.name}
          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
        />
        {product.isFresh && (
          <span className="absolute top-1.5 left-1.5 bg-blynk-green-500 text-white font-extrabold text-[9px] uppercase px-1.5 py-0.5 rounded-md">
            Fresh
          </span>
        )}
      </div>

      <div className="mt-1 space-y-0.5">
        <h4 className="text-xs font-bold text-gray-900 line-clamp-2 leading-tight">
          {product.name}
        </h4>
        <p className="text-[10px] text-gray-500 font-medium">{product.unit}</p>
      </div>

      <div className="flex items-center justify-between mt-auto pt-1">
        <div>
          <div className="text-xs font-extrabold text-gray-900">
            Rs. {product.price}
          </div>
          {product.originalPrice && (
            <div className="text-[10px] text-gray-400 line-through font-semibold">
              Rs. {product.originalPrice}
            </div>
          )}
        </div>

        <QuantitySelector product={product} size="sm" />
      </div>
    </div>
  );
};

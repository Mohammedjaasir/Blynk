import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, X, TrendingUp, Sparkles } from 'lucide-react';
import { QuantitySelector } from '../common/QuantitySelector';
import { Product } from '../../types';

export const SearchScreen: React.FC = () => {
  const { products, searchQuery, setSearchQuery, setSelectedProduct, setCustomerTab, setSelectedCategoryId } = useApp();

  const recentSearches = ['fresh milk', 'tomatoes', 'sandwich bread', 'red onions', 'keeri samba'];
  const popularTerms = ['Milk', 'Eggs', 'Tea', 'Potato', 'Biscuits', 'Detergent'];

  const filtered = searchQuery.trim() === ''
    ? []
    : products.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
      );

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Search Header */}
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-blynk-green-600 absolute left-3.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search for fresh groceries, dairy, snacks..."
          className="w-full bg-white border border-gray-300 rounded-2xl pl-10 pr-10 py-3 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 shadow-blynk-sm"
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* When Query is Empty -> Show Recent & Popular */}
      {searchQuery.trim() === '' && (
        <div className="space-y-4">
          {/* Recent Searches */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-gray-800">
              <TrendingUp className="w-3.5 h-3.5 text-blynk-green-600" />
              <span>Recent Searches</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map(term => (
                <button
                  key={term}
                  onClick={() => setSearchQuery(term)}
                  className="bg-white border border-gray-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 hover:border-blynk-green-400 hover:bg-blynk-green-50 transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>

          {/* Popular Categories */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-gray-800">
              <Sparkles className="w-3.5 h-3.5 text-blynk-yellow-500" />
              <span>Popular Searches in Dharga Town</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {popularTerms.map(term => (
                <button
                  key={term}
                  onClick={() => setSearchQuery(term)}
                  className="bg-blynk-green-50 border border-blynk-green-200 px-3 py-1.5 rounded-xl text-xs font-bold text-blynk-green-800 hover:bg-blynk-green-100 transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchQuery.trim() !== '' && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-gray-500">
            Found {filtered.length} products for "{searchQuery}"
          </p>

          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map(product => (
                <div
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className="bg-white p-3 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between gap-3 cursor-pointer hover:border-blynk-green-300 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 bg-gray-50 rounded-xl overflow-hidden p-1 shrink-0 flex items-center justify-center">
                      <img src={product.image} alt={product.name} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div>
                      <h4 className="text-xs font-extrabold text-gray-900 leading-snug">
                        {product.name}
                      </h4>
                      <p className="text-[10px] text-gray-500 font-medium mt-0.5">{product.unit}</p>
                      <p className="text-xs font-black text-gray-900 mt-1">Rs. {product.price}</p>
                    </div>
                  </div>

                  <QuantitySelector product={product} size="sm" />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-8 text-center space-y-3 border border-gray-100">
              <div className="w-12 h-12 rounded-full bg-gray-100 mx-auto flex items-center justify-center text-gray-400">
                <Search className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-gray-900">No products found</h4>
                <p className="text-xs text-gray-500 mt-1">
                  We couldn't find any items matching "{searchQuery}" in our Dharga Town store.
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedCategoryId('vegetables');
                  setCustomerTab('categories');
                }}
                className="inline-block bg-blynk-green-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-blynk-glow"
              >
                Browse Categories
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

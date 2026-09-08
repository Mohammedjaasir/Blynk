import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, Edit3, AlertTriangle, CheckCircle2, PackageX } from 'lucide-react';
import { Product } from '../../types';

export const AdminInventory: React.FC = () => {
  const { products, updateProductStock, updateProductPrice, showToast } = useApp();
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newStock, setNewStock] = useState<number>(0);
  const [newPrice, setNewPrice] = useState<number>(0);

  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setNewStock(p.stock);
    setNewPrice(p.price);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    updateProductStock(editingProduct.id, Number(newStock));
    updateProductPrice(editingProduct.id, Number(newPrice));
    setEditingProduct(null);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-gray-900">Inventory & Dark Store Stock</h2>
          <p className="text-xs text-gray-500 font-medium">Monitor real-time SKU counts & low stock alerts</p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by SKU, Product Name..."
            className="w-full bg-white border border-gray-300 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 shadow-xs"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-blynk-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                <th className="p-4">SKU ID & Product</th>
                <th className="p-4">Category</th>
                <th className="p-4">Unit Spec</th>
                <th className="p-4">Current Price</th>
                <th className="p-4">Stock Level</th>
                <th className="p-4">Availability</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
              {filtered.map(product => (
                <tr key={product.id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-50 rounded-xl overflow-hidden p-1 shrink-0 flex items-center justify-center border border-gray-200">
                        <img src={product.image} alt={product.name} className="max-h-full max-w-full object-contain" />
                      </div>
                      <div>
                        <span className="font-extrabold text-gray-900">{product.name}</span>
                        <span className="block text-[10px] text-gray-400 font-bold">SKU: #{product.id.toUpperCase()}</span>
                      </div>
                    </div>
                  </td>

                  <td className="p-4 capitalize font-bold text-gray-700">{product.category}</td>
                  <td className="p-4 text-gray-600 font-semibold">{product.unit}</td>
                  <td className="p-4 font-black text-gray-900">Rs. {product.price}</td>

                  <td className="p-4">
                    <span className={`font-black text-sm ${product.stock === 0 ? 'text-red-600' : product.stock < 10 ? 'text-amber-600' : 'text-gray-900'}`}>
                      {product.stock} pcs
                    </span>
                  </td>

                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                      product.availability === 'in_stock'
                        ? 'bg-blynk-green-100 text-blynk-green-800'
                        : product.availability === 'low_stock'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {product.availability.replace('_', ' ')}
                    </span>
                  </td>

                  <td className="p-4 text-right">
                    <button
                      onClick={() => handleOpenEdit(product)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-[11px] px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1 ml-auto"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Stock</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Stock Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-sm bg-white rounded-3xl p-5 space-y-4 shadow-blynk-lg">
            <h3 className="text-sm font-extrabold text-gray-900">Edit Stock & Price for "{editingProduct.name}"</h3>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Dark Store Stock Quantity</label>
              <input
                type="number"
                value={newStock}
                onChange={e => setNewStock(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-blynk-green-500"
                min={0}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Unit Price (Rs.)</label>
              <input
                type="number"
                value={newPrice}
                onChange={e => setNewPrice(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold bg-gray-50 focus:bg-white focus:outline-none focus:border-blynk-green-500"
                min={1}
                required
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="w-1/3 py-2.5 bg-gray-100 text-gray-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 bg-blynk-green-500 text-white font-bold text-xs rounded-xl shadow-blynk-glow"
              >
                Update Inventory
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

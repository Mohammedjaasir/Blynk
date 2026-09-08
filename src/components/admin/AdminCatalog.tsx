import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Plus, Search, PackageCheck } from 'lucide-react';
import { CategoryId } from '../../types';

export const AdminCatalog: React.FC = () => {
  const { products, addProduct, categories, showToast } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryId>('vegetables');
  const [brand, setBrand] = useState('Blynk Fresh');
  const [image, setImage] = useState('https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=500&q=80');
  const [unit, setUnit] = useState('500 g');
  const [price, setPrice] = useState<number>(250);
  const [stock, setStock] = useState<number>(50);

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    addProduct({
      name,
      category,
      subcategory: 'General',
      brand,
      image,
      unit,
      price: Number(price),
      stock: Number(stock),
      availability: Number(stock) > 0 ? 'in_stock' : 'out_of_stock',
      description: 'Fresh grocery item stocked at Blynk Dharga Town Store.'
    });
    setShowAddModal(false);
    setName('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-gray-900">Catalog Management</h2>
          <p className="text-xs text-gray-500 font-medium">Manage 300–500 fast-moving grocery SKUs for Dharga Town</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-blynk-glow flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Product SKU</span>
        </button>
      </div>

      {/* Catalog Grid Table */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-blynk-sm overflow-hidden p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {products.map(p => (
            <div key={p.id} className="bg-gray-50 rounded-2xl p-3 border border-gray-200 space-y-2">
              <div className="w-full h-28 bg-white rounded-xl overflow-hidden p-1 flex items-center justify-center border border-gray-100">
                <img src={p.image} alt={p.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div>
                <span className="text-[10px] font-extrabold text-blynk-green-700 uppercase tracking-wider block">{p.category}</span>
                <h4 className="text-xs font-black text-gray-900 line-clamp-1">{p.name}</h4>
                <p className="text-[10px] text-gray-500">{p.unit} • Stock: {p.stock}</p>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs font-black text-gray-900">
                <span>Rs. {p.price}</span>
                <span className="text-[10px] font-bold text-gray-500">#{p.id}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleAddProduct} className="w-full max-w-md bg-white rounded-3xl p-5 space-y-3 shadow-blynk-lg">
            <h3 className="text-sm font-extrabold text-gray-900">Add New Grocery SKU</h3>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Product Title</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Fresh Red Chilies"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as CategoryId)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Brand Name</label>
                <input
                  type="text"
                  value={brand}
                  onChange={e => setBrand(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Unit Spec</label>
                <input
                  type="text"
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  placeholder="500 g"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Price (Rs.)</label>
                <input
                  type="number"
                  value={price}
                  onChange={e => setPrice(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Initial Stock</label>
                <input
                  type="number"
                  value={stock}
                  onChange={e => setStock(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Image URL</label>
              <input
                type="url"
                value={image}
                onChange={e => setImage(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                required
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-1/3 py-2.5 bg-gray-100 text-gray-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-2/3 py-2.5 bg-blynk-green-500 text-white font-bold text-xs rounded-xl shadow-blynk-glow"
              >
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

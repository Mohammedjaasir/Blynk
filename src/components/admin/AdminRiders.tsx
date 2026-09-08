import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Bike, Plus, Phone, Star, CheckCircle2 } from 'lucide-react';

export const AdminRiders: React.FC = () => {
  const { riders, addRider, showToast } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');

  const handleAddRider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;
    addRider({
      name,
      phone,
      vehicleNo: vehicleNo || 'SL-BA-9999 (Honda Dio)',
      status: 'online'
    });
    setShowAddModal(false);
    setName('');
    setPhone('');
    setVehicleNo('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-gray-900">Rider Fleet Management</h2>
          <p className="text-xs text-gray-500 font-medium">Blynk Dharga Town Delivery Bike Roster</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-blynk-glow flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Pre-Register New Rider</span>
        </button>
      </div>

      {/* Rider Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {riders.map(rider => (
          <div key={rider.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white font-black flex items-center justify-center shadow-xs">
                  <Bike className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-gray-900">{rider.name}</h3>
                  <p className="text-xs text-gray-500 font-semibold">{rider.phone}</p>
                </div>
              </div>

              <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                rider.status === 'online'
                  ? 'bg-blynk-green-100 text-blynk-green-800'
                  : rider.status === 'on_delivery'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-700'
              }`}>
                {rider.status.replace('_', ' ')}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Vehicle Info:</span>
                <span className="font-bold text-gray-900">{rider.vehicleNo}</span>
              </div>
              <div className="flex justify-between">
                <span>Deliveries Today:</span>
                <span className="font-bold text-blynk-green-600">{rider.completedToday}</span>
              </div>
              <div className="flex justify-between">
                <span>Rating:</span>
                <span className="font-bold text-amber-600 flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                  {rider.rating} / 5.0
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Rider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleAddRider} className="w-full max-w-sm bg-white rounded-3xl p-5 space-y-3 shadow-blynk-lg">
            <h3 className="text-sm font-extrabold text-gray-900">Pre-Register Rider</h3>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Rider Full Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Mohamed Tariq"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Mobile Phone (+94)</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+94 77 999 1122"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500 bg-gray-50"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Vehicle License & Model</label>
              <input
                type="text"
                value={vehicleNo}
                onChange={e => setVehicleNo(e.target.value)}
                placeholder="e.g. SL-BC-5521 (TVS Ntorq)"
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
                Register Rider
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

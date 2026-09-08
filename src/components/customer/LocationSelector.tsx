import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BottomSheet } from '../common/BottomSheet';
import { MapPin, Plus, Check, Home, Briefcase } from 'lucide-react';

interface LocationSelectorProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LocationSelector: React.FC<LocationSelectorProps> = ({ isOpen, onClose }) => {
  const { userProfile, setSelectedAddressId, addAddress } = useApp();
  const [showAddForm, setShowAddForm] = useState(false);
  const [label, setLabel] = useState<'Home' | 'Work' | 'Other'>('Home');
  const [houseNo, setHouseNo] = useState('');
  const [street, setStreet] = useState('');
  const [landmark, setLandmark] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!houseNo || !street) return;
    addAddress({
      label,
      houseNo,
      street,
      area: 'Dharga Town',
      city: 'Kalutara District',
      landmark,
      instructions: 'Deliver to front porch'
    });
    setShowAddForm(false);
    onClose();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Select Delivery Location">
      {!showAddForm ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 font-medium">Delivering groceries in Dharga Town</p>

          <div className="space-y-2">
            {userProfile.addresses.map(addr => {
              const isSelected = addr.id === userProfile.selectedAddressId;
              return (
                <div
                  key={addr.id}
                  onClick={() => {
                    setSelectedAddressId(addr.id);
                    onClose();
                  }}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isSelected 
                      ? 'border-blynk-green-500 bg-blynk-green-50/50 shadow-xs' 
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl mt-0.5 ${isSelected ? 'bg-blynk-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {addr.label === 'Home' ? <Home className="w-4 h-4" /> : <Briefcase className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-gray-900">{addr.label}</span>
                        {addr.isDefault && (
                          <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-1.5 py-0.2 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 font-medium mt-0.5">
                        {addr.houseNo}, {addr.street}, {addr.area}
                      </p>
                      {addr.landmark && (
                        <p className="text-[11px] text-gray-400 mt-0.5">Landmark: {addr.landmark}</p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-blynk-green-500 text-white flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setShowAddForm(true)}
            className="w-full mt-3 py-3 border border-dashed border-blynk-green-400 text-blynk-green-600 font-bold text-xs rounded-2xl hover:bg-blynk-green-50 flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Address in Dharga Town</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <h4 className="font-bold text-sm text-gray-900">New Address Details</h4>

          <div className="flex gap-2">
            {(['Home', 'Work', 'Other'] as const).map(l => (
              <button
                type="button"
                key={l}
                onClick={() => setLabel(l)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  label === l ? 'bg-blynk-green-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">House / Building No.</label>
            <input
              type="text"
              value={houseNo}
              onChange={e => setHouseNo(e.target.value)}
              placeholder="e.g. No. 18 / 2B"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Street / Road Name</label>
            <input
              type="text"
              value={street}
              onChange={e => setStreet(e.target.value)}
              placeholder="e.g. Alutgama Road"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Nearby Landmark (Optional)</label>
            <input
              type="text"
              value={landmark}
              onChange={e => setLandmark(e.target.value)}
              placeholder="e.g. Near Dharga Town Clock Tower"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-blynk-green-500"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="w-1/3 py-2.5 bg-gray-100 text-gray-700 font-bold text-xs rounded-xl"
            >
              Back
            </button>
            <button
              type="submit"
              className="w-2/3 py-2.5 bg-blynk-green-500 text-white font-bold text-xs rounded-xl shadow-blynk-glow"
            >
              Save & Deliver Here
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
};

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { User, MapPin, Globe, Headphones, LogOut, Phone, ShieldCheck, ChevronRight } from 'lucide-react';
import { LocationSelector } from './LocationSelector';

export const AccountView: React.FC = () => {
  const { userProfile, setIsOnboardingComplete, showToast } = useApp();
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ta' | 'si'>('en');

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-extrabold text-gray-900">Your Profile</h2>
        <p className="text-xs text-gray-500 font-medium">Blynk Account & Preferences</p>
      </div>

      {/* User Info Card */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-blynk-green-500 text-white font-black text-lg flex items-center justify-center shadow-blynk-glow shrink-0">
          {userProfile.name.charAt(0)}
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">{userProfile.name}</h3>
          <p className="text-xs text-gray-500 font-semibold">{userProfile.phone}</p>
          <span className="mt-1 inline-block bg-blynk-green-50 text-blynk-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blynk-green-200">
            Verified Customer • Dharga Town
          </span>
        </div>
      </div>

      {/* Saved Addresses */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blynk-green-500" />
            <h4 className="text-xs font-extrabold text-gray-900">Saved Addresses</h4>
          </div>
          <button
            onClick={() => setIsLocationModalOpen(true)}
            className="text-xs text-blynk-green-600 font-bold hover:underline"
          >
            Manage
          </button>
        </div>

        <div className="space-y-2">
          {userProfile.addresses.map(a => (
            <div key={a.id} className="bg-gray-50 p-3 rounded-2xl border border-gray-200 text-xs">
              <span className="font-extrabold text-gray-900">{a.label}</span>
              <p className="text-gray-600 font-medium">{a.houseNo}, {a.street}, {a.area}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Localization */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-blynk-sm space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blynk-green-500" />
          <h4 className="text-xs font-extrabold text-gray-900">App Language</h4>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setLanguage('en')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              language === 'en' ? 'bg-blynk-green-500 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            English
          </button>
          <button
            onClick={() => {
              setLanguage('ta');
              showToast('Tamil interface ready');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              language === 'ta' ? 'bg-blynk-green-500 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            தமிழ் (Tamil)
          </button>
          <button
            onClick={() => {
              setLanguage('si');
              showToast('Sinhala interface ready');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              language === 'si' ? 'bg-blynk-green-500 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            සිංහල (Sinhala)
          </button>
        </div>
      </div>

      {/* Support & Logout */}
      <div className="bg-white rounded-3xl p-3 border border-gray-100 shadow-blynk-sm space-y-1">
        <button
          onClick={() => showToast('Connecting to Blynk Support hotline (+94 77 123 4567)...')}
          className="w-full p-2.5 hover:bg-gray-50 rounded-2xl flex items-center justify-between text-xs font-bold text-gray-800 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Headphones className="w-4 h-4 text-blynk-green-600" />
            <span>Need Help? Contact Support</span>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>

        <button
          onClick={() => {
            setIsOnboardingComplete(false);
            showToast('Resetting onboarding flow...');
          }}
          className="w-full p-2.5 hover:bg-red-50 rounded-2xl flex items-center justify-between text-xs font-bold text-red-600 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <LogOut className="w-4 h-4" />
            <span>Log Out / Switch User</span>
          </div>
          <ChevronRight className="w-4 h-4 text-red-400" />
        </button>
      </div>

      <LocationSelector isOpen={isLocationModalOpen} onClose={() => setIsLocationModalOpen(false)} />
    </div>
  );
};

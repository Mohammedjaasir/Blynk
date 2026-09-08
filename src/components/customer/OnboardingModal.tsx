import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShoppingBag, ArrowRight, ShieldCheck, MapPin, CheckCircle2 } from 'lucide-react';

export const OnboardingModal: React.FC = () => {
  const { isOnboardingComplete, setIsOnboardingComplete, userProfile, setUserProfile, showToast } = useApp();
  const [step, setStep] = useState<'mobile' | 'otp' | 'address'>('mobile');
  const [phone, setPhone] = useState(userProfile.phone);
  const [otp, setOtp] = useState(['', '', '', '']);
  const [name, setName] = useState(userProfile.name);
  const [house, setHouse] = useState('No. 42');
  const [street, setStreet] = useState('Station Road');

  if (isOnboardingComplete) return null;

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 8) {
      showToast('Please enter a valid mobile number');
      return;
    }
    setStep('otp');
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('address');
  };

  const handleFinishAddress = (e: React.FormEvent) => {
    e.preventDefault();
    setUserProfile(prev => ({
      ...prev,
      name: name || 'Fatima Zohra',
      phone: phone,
      isLoggedIn: true
    }));
    setIsOnboardingComplete(true);
    showToast('Welcome to Blynk Dharga Town!');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-blynk-lg overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Banner header */}
        <div className="bg-gradient-to-br from-blynk-green-600 via-blynk-green-500 to-blynk-green-700 text-white p-6 text-center relative">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 rounded-2xl mb-3 backdrop-blur-xs border border-white/20 shadow-blynk-glow">
            <ShoppingBag className="w-8 h-8 text-blynk-yellow-400" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">Blynk</h2>
          <p className="text-xs text-blynk-green-100 mt-1 font-medium">Groceries, made simple.</p>
          <span className="mt-2 inline-block bg-blynk-yellow-400 text-blynk-dark font-black text-[10px] uppercase px-2.5 py-0.5 rounded-full tracking-wider">
            Dharga Town Store
          </span>
        </div>

        <div className="p-6">
          {/* STEP 1: MOBILE */}
          {step === 'mobile' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-extrabold text-gray-900">Enter Mobile Number</h3>
                <p className="text-xs text-gray-500 mt-1">Everyday essentials delivered straight to your home.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Mobile Number</label>
                <div className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2.5 bg-gray-50 focus-within:bg-white focus-within:border-blynk-green-500 focus-within:ring-2 focus-within:ring-blynk-green-100 transition-all">
                  <span className="text-xs font-bold text-gray-500 border-r border-gray-300 pr-2">+94</span>
                  <input
                    type="tel"
                    value={phone.replace('+94 ', '')}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="77 123 4567"
                    className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-bold py-3 rounded-xl shadow-blynk-glow flex items-center justify-center gap-2 active:scale-98 transition-transform"
              >
                <span>Continue with Mobile</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 pt-2">
                <ShieldCheck className="w-3.5 h-3.5 text-blynk-green-500" />
                <span>No password required • Instant OTP</span>
              </div>
            </form>
          )}

          {/* STEP 2: OTP */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-extrabold text-gray-900">Enter 4-Digit OTP</h3>
                <p className="text-xs text-gray-500 mt-1">Sent via SMS to <span className="font-semibold text-gray-800">{phone}</span></p>
              </div>

              <div className="flex justify-center gap-3 py-2">
                {[0, 1, 2, 3].map(i => (
                  <input
                    key={i}
                    type="text"
                    maxLength={1}
                    value={otp[i] || '7'}
                    onChange={e => {
                      const next = [...otp];
                      next[i] = e.target.value;
                      setOtp(next);
                    }}
                    className="w-12 h-12 text-center text-xl font-bold bg-gray-50 border border-gray-300 rounded-xl focus:border-blynk-green-500 focus:bg-white focus:outline-none shadow-xs"
                  />
                ))}
              </div>

              <button
                type="submit"
                className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-bold py-3 rounded-xl shadow-blynk-glow flex items-center justify-center gap-2"
              >
                <span>Verify & Proceed</span>
                <CheckCircle2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setStep('mobile')}
                className="w-full text-xs text-blynk-green-600 font-semibold text-center hover:underline"
              >
                Change Mobile Number
              </button>
            </form>
          )}

          {/* STEP 3: ADDRESS */}
          {step === 'address' && (
            <form onSubmit={handleFinishAddress} className="space-y-3">
              <div className="text-center mb-2">
                <h3 className="text-lg font-extrabold text-gray-900">Your Delivery Address</h3>
                <p className="text-xs text-gray-500">Dharga Town Local Delivery</p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Your Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Fatima Zohra"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold bg-gray-50 focus:bg-white focus:outline-none focus:border-blynk-green-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">House / Appt No.</label>
                  <input
                    type="text"
                    value={house}
                    onChange={e => setHouse(e.target.value)}
                    placeholder="No. 42"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold bg-gray-50 focus:bg-white focus:outline-none focus:border-blynk-green-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Street / Area</label>
                  <input
                    type="text"
                    value={street}
                    onChange={e => setStreet(e.target.value)}
                    placeholder="Station Road"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold bg-gray-50 focus:bg-white focus:outline-none focus:border-blynk-green-500"
                    required
                  />
                </div>
              </div>

              <div className="bg-blynk-green-50 border border-blynk-green-200 p-2.5 rounded-xl flex items-start gap-2 text-xs text-blynk-green-900">
                <MapPin className="w-4 h-4 text-blynk-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Delivering from Blynk Dark Store</p>
                  <p className="text-[10px] text-blynk-green-700">Station Road Hub • Dharga Town</p>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blynk-green-500 hover:bg-blynk-green-600 text-white font-bold py-3 rounded-xl shadow-blynk-glow flex items-center justify-center gap-2 mt-2"
              >
                <span>Start Shopping</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};

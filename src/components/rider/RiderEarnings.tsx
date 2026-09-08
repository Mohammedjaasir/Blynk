import React from 'react';
import { useApp } from '../../context/AppContext';
import { ArrowLeft, Wallet, CheckCircle2, Calendar } from 'lucide-react';

export const RiderEarnings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { activeRider } = useApp();

  const history = [
    { id: 't1', time: 'Today, 9:20 AM', orderId: '#BLK-10244', payout: 320, status: 'Completed' },
    { id: 't2', time: 'Today, 8:45 AM', orderId: '#BLK-10241', payout: 280, status: 'Completed' },
    { id: 't3', time: 'Yesterday, 6:15 PM', orderId: '#BLK-10198', payout: 450, status: 'Completed' },
    { id: 't4', time: 'Yesterday, 5:30 PM', orderId: '#BLK-10190', payout: 310, status: 'Completed' },
  ];

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-2xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-base font-black text-gray-900">Rider Earnings</h2>
          <p className="text-xs text-gray-500 font-medium">Blynk Dharga Town Delivery Payouts</p>
        </div>
      </div>

      {/* Earnings Summary Card */}
      <div className="bg-gradient-to-br from-blynk-dark via-gray-800 to-emerald-950 text-white rounded-3xl p-5 shadow-blynk-md space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-300">Total Earnings This Week</span>
          <Wallet className="w-5 h-5 text-blynk-yellow-400" />
        </div>
        <h3 className="text-3xl font-black tracking-tight text-white">Rs. 18,450</h3>
        <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold border-t border-gray-700 pt-3">
          <span>Completed Orders: 42</span>
          <span>Avg Payout / Order: Rs. 440</span>
        </div>
      </div>

      {/* Trip Payout History */}
      <div className="space-y-2">
        <h3 className="text-xs font-extrabold text-gray-900">Recent Delivery Payouts</h3>
        <div className="space-y-2">
          {history.map(item => (
            <div key={item.id} className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blynk-green-50 text-blynk-green-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-gray-900">{item.orderId}</h4>
                  <p className="text-[10px] text-gray-400 font-semibold">{item.time}</p>
                </div>
              </div>
              <span className="text-xs font-black text-blynk-green-600">+Rs. {item.payout}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

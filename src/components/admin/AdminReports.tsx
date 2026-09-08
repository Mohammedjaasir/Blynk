import React from 'react';
import { useApp } from '../../context/AppContext';
import { BarChart3, TrendingUp, Calendar, Download, Award } from 'lucide-react';

export const AdminReports: React.FC = () => {
  const { orders } = useApp();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-gray-900">Analytics & Performance Reports</h2>
          <p className="text-xs text-gray-500 font-medium">Blynk Dharga Town Dark Store Phase 1 Operational Audit</p>
        </div>

        <button
          onClick={() => alert('Downloading Blynk Dharga Town Monthly Operational Report CSV...')}
          className="bg-gray-900 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Analytics CSV</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm space-y-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Fulfillment SLA Pass Rate</span>
          <h3 className="text-2xl font-black text-blynk-green-600">98.4%</h3>
          <p className="text-[11px] text-gray-500">Orders packed & handed to rider within 6 mins</p>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm space-y-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Average Ticket Size</span>
          <h3 className="text-2xl font-black text-gray-900">Rs. 1,480</h3>
          <p className="text-[11px] text-gray-500">Avg 4.2 items per basket</p>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-blynk-sm space-y-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Repeat Order Ratio</span>
          <h3 className="text-2xl font-black text-purple-600">64.8%</h3>
          <p className="text-[11px] text-gray-500">Households ordering 2+ times per week</p>
        </div>
      </div>
    </div>
  );
};

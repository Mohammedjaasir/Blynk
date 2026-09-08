import React from 'react';
import { useApp } from '../../context/AppContext';
import { Bell, MessageSquare, CheckCircle2, Bike, ShoppingBag } from 'lucide-react';

export const NotificationsView: React.FC = () => {
  const { orders } = useApp();

  const mockNotifications = [
    {
      id: 'n1',
      title: 'Order Delivered Successfully',
      body: 'Order #BLK-10245 has been delivered to Station Road, Dharga Town.',
      time: '10m ago',
      type: 'delivery',
      icon: <CheckCircle2 className="w-4 h-4 text-blynk-green-500" />
    },
    {
      id: 'n2',
      title: 'Rider Assigned & En Route',
      body: 'Salman Mohamed is on his way to deliver your fresh milk & eggs.',
      time: '25m ago',
      type: 'rider',
      icon: <Bike className="w-4 h-4 text-blue-500" />
    },
    {
      id: 'n3',
      title: 'SMS / WhatsApp Alerts Active',
      body: 'Real-time SMS updates sent to +94 77 888 9911 for all Blynk orders.',
      time: '1h ago',
      type: 'sms',
      icon: <MessageSquare className="w-4 h-4 text-purple-500" />
    }
  ];

  return (
    <div className="pb-24 pt-2 px-4 space-y-4">
      <div>
        <h2 className="text-base font-extrabold text-gray-900">Notifications</h2>
        <p className="text-xs text-gray-500 font-medium">Order updates & SMS alert status</p>
      </div>

      <div className="space-y-2.5">
        {mockNotifications.map(n => (
          <div key={n.id} className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-xs flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-gray-50 shrink-0 mt-0.5 border border-gray-100">
              {n.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold text-gray-900">{n.title}</h4>
                <span className="text-[10px] text-gray-400 font-semibold">{n.time}</span>
              </div>
              <p className="text-xs text-gray-600 font-medium mt-0.5">{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2 } from 'lucide-react';

export const Toast: React.FC = () => {
  const { toastMessage } = useApp();

  if (!toastMessage) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-bounce-short">
      <div className="bg-blynk-dark text-white text-xs font-semibold px-4 py-2.5 rounded-2xl shadow-blynk-lg border border-gray-700 flex items-center gap-2 max-w-xs text-center">
        <CheckCircle2 className="w-4 h-4 text-blynk-green-500 shrink-0" />
        <span>{toastMessage}</span>
      </div>
    </div>
  );
};

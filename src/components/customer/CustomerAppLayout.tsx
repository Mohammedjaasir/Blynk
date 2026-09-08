import React from 'react';
import { useApp } from '../../context/AppContext';
import { HomeScreen } from './HomeScreen';
import { CategoryScreen } from './CategoryScreen';
import { SearchScreen } from './SearchScreen';
import { CartView } from './CartView';
import { CheckoutView } from './CheckoutView';
import { OrderSuccessView } from './OrderSuccessView';
import { OrderTrackingView } from './OrderTrackingView';
import { OrdersHistoryView } from './OrdersHistoryView';
import { NotificationsView } from './NotificationsView';
import { AccountView } from './AccountView';
import { OnboardingModal } from './OnboardingModal';
import { ProductDetailModal } from './ProductDetailModal';
import { Toast } from '../common/Toast';
import { Home, Grid, ShoppingBag, User, ArrowRight, Bell } from 'lucide-react';

export const CustomerAppLayout: React.FC = () => {
  const { customerTab, setCustomerTab, cartTotalItems, cartGrandTotal, orders } = useApp();

  const activeOrdersCount = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length;

  const renderContent = () => {
    switch (customerTab) {
      case 'home': return <HomeScreen />;
      case 'categories': return <CategoryScreen />;
      case 'search': return <SearchScreen />;
      case 'cart': return <CartView />;
      case 'checkout': return <CheckoutView />;
      case 'success': return <OrderSuccessView />;
      case 'tracking': return <OrderTrackingView />;
      case 'orders': return <OrdersHistoryView />;
      case 'notifications': return <NotificationsView />;
      case 'account': return <AccountView />;
      default: return <HomeScreen />;
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-60px)] bg-gray-100 flex items-center justify-center p-0 sm:p-4">
      {/* Mobile Shell Device Frame */}
      <div className="relative w-full max-w-[420px] bg-white sm:rounded-[36px] shadow-blynk-lg border border-gray-200 min-h-[840px] flex flex-col overflow-hidden">
        
        {/* Mobile Top Status Notch Bar */}
        <div className="bg-white px-5 pt-3 pb-1 flex items-center justify-between text-xs text-gray-800 font-bold border-b border-gray-100 select-none">
          <span>9:41</span>
          <div className="w-16 h-3.5 bg-gray-900 rounded-full" />
          <div className="flex items-center gap-1.5 text-[10px]">
            <span>5G</span>
            <div className="w-4 h-2 bg-blynk-green-500 rounded-xs" />
          </div>
        </div>

        {/* Scrollable Main Screen Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50 relative">
          {renderContent()}
        </main>

        {/* Persistent Floating Cart CTA (when cart has items and user is not on cart/checkout) */}
        {cartTotalItems > 0 && customerTab !== 'cart' && customerTab !== 'checkout' && customerTab !== 'success' && (
          <div className="absolute bottom-16 left-0 right-0 px-4 z-30 animate-bounce-short">
            <button
              onClick={() => setCustomerTab('cart')}
              className="w-full bg-blynk-dark text-white font-extrabold p-3 rounded-2xl shadow-blynk-lg border border-gray-800 flex items-center justify-between active:scale-98 transition-transform"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blynk-green-500 text-white flex items-center justify-center text-xs font-black">
                  {cartTotalItems}
                </div>
                <div className="text-left">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Items Added</span>
                  <span className="text-sm font-extrabold text-white">Rs. {cartGrandTotal}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs text-blynk-green-400 font-bold">
                <span>View Cart</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          </div>
        )}

        {/* Bottom Navigation Bar */}
        <nav className="bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-2 flex items-center justify-around z-40">
          <button
            onClick={() => setCustomerTab('home')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
              customerTab === 'home' ? 'text-blynk-green-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>Home</span>
          </button>

          <button
            onClick={() => setCustomerTab('categories')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
              customerTab === 'categories' ? 'text-blynk-green-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Grid className="w-5 h-5" />
            <span>Categories</span>
          </button>

          <button
            onClick={() => setCustomerTab('orders')}
            className={`relative flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
              customerTab === 'orders' || customerTab === 'tracking' ? 'text-blynk-green-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span>Orders</span>
            {activeOrdersCount > 0 && (
              <span className="absolute -top-1 right-2 w-4 h-4 rounded-full bg-blynk-green-500 text-white text-[9px] font-black flex items-center justify-center border border-white">
                {activeOrdersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setCustomerTab('account')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ${
              customerTab === 'account' ? 'text-blynk-green-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <User className="w-5 h-5" />
            <span>Account</span>
          </button>
        </nav>
      </div>

      {/* Global Modals & Toast */}
      <OnboardingModal />
      <ProductDetailModal />
      <Toast />
    </div>
  );
};

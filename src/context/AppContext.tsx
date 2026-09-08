import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  AppRole, 
  Product, 
  Category, 
  CartItem, 
  Order, 
  Rider, 
  Address, 
  UserProfile, 
  OrderStatus, 
  CategoryId 
} from '../types';
import { 
  INITIAL_CATEGORIES, 
  INITIAL_PRODUCTS, 
  INITIAL_ADDRESSES, 
  INITIAL_RIDERS, 
  INITIAL_ORDERS 
} from '../data/mockData';
import confetti from 'canvas-confetti';

interface AppContextType {
  // Navigation & Role
  role: AppRole;
  setRole: (role: AppRole) => void;
  viewMode: 'mobile' | 'desktop' | 'split';
  setViewMode: (mode: 'mobile' | 'desktop' | 'split') => void;
  customerTab: string;
  setCustomerTab: (tab: string) => void;
  adminTab: string;
  setAdminTab: (tab: string) => void;

  // Catalog & Products
  categories: Category[];
  products: Product[];
  selectedCategoryId: CategoryId;
  setSelectedCategoryId: (id: CategoryId) => void;
  selectedProduct: Product | null;
  setSelectedProduct: (p: Product | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  updateProductStock: (id: string, newStock: number) => void;
  updateProductPrice: (id: string, newPrice: number) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;

  // Cart & Checkout
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartQuantity: (productId: string, delta: number) => void;
  clearCart: () => void;
  cartTotalItems: number;
  cartSubtotal: number;
  cartDeliveryFee: number;
  cartGrandTotal: number;

  // User & Address
  userProfile: UserProfile;
  setUserProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  selectedAddress: Address;
  setSelectedAddressId: (id: string) => void;
  addAddress: (addr: Omit<Address, 'id'>) => void;

  // Orders & Real-time State
  orders: Order[];
  activeTrackingOrder: Order | null;
  setActiveTrackingOrder: (order: Order | null) => void;
  placeOrder: (paymentMethod: 'COD' | 'ONLINE', notes?: string) => Order;
  updateOrderStatus: (orderId: string, status: OrderStatus, riderId?: string) => void;
  toggleOrderItemPacked: (orderId: string, productId: string) => void;
  assignRiderToOrder: (orderId: string, riderId: string) => void;

  // Riders
  riders: Rider[];
  toggleRiderStatus: (riderId: string) => void;
  activeRider: Rider;
  addRider: (rider: Omit<Rider, 'id' | 'completedToday' | 'totalDeliveries' | 'rating'>) => void;

  // Notifications & UI feedback
  toastMessage: string | null;
  showToast: (msg: string) => void;
  isOnboardingComplete: boolean;
  setIsOnboardingComplete: (val: boolean) => void;
}

const STORAGE_KEYS = {
  PRODUCTS: 'blynk_products_v1',
  ORDERS: 'blynk_orders_v1',
  CART: 'blynk_cart_v1',
  RIDERS: 'blynk_riders_v1',
  USER: 'blynk_user_v1',
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation State
  const [role, setRole] = useState<AppRole>('customer');
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop' | 'split'>('mobile');
  const [customerTab, setCustomerTab] = useState<string>('home');
  const [adminTab, setAdminTab] = useState<string>('dashboard');

  // Search & Filters
  const [selectedCategoryId, setSelectedCategoryId] = useState<CategoryId>('vegetables');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Onboarding
  const [isOnboardingComplete, setIsOnboardingComplete] = useState<boolean>(true);

  // Products state (persisted)
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  // Cart state (persisted)
  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CART);
    return saved ? JSON.parse(saved) : [];
  });

  // Orders state (persisted)
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ORDERS);
    return saved ? JSON.parse(saved) : INITIAL_ORDERS;
  });

  // Riders state (persisted)
  const [riders, setRiders] = useState<Rider[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RIDERS);
    return saved ? JSON.parse(saved) : INITIAL_RIDERS;
  });

  // User profile
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USER);
    return saved ? JSON.parse(saved) : {
      name: 'Fatima Zohra',
      phone: '+94 77 888 9911',
      addresses: INITIAL_ADDRESSES,
      selectedAddressId: INITIAL_ADDRESSES[0].id,
      isLoggedIn: true
    };
  });

  // Active tracking order
  const [activeTrackingOrder, setActiveTrackingOrder] = useState<Order | null>(null);

  // Sync to LocalStorage & cross-tab events
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RIDERS, JSON.stringify(riders));
  }, [riders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userProfile));
  }, [userProfile]);

  // Keep active tracking order updated if order status changes
  useEffect(() => {
    if (activeTrackingOrder) {
      const updated = orders.find(o => o.id === activeTrackingOrder.id);
      if (updated) {
        setActiveTrackingOrder(updated);
      }
    }
  }, [orders]);

  // Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Selected Address
  const selectedAddress = userProfile.addresses.find(a => a.id === userProfile.selectedAddressId) || userProfile.addresses[0];

  const setSelectedAddressId = (id: string) => {
    setUserProfile(prev => ({ ...prev, selectedAddressId: id }));
    showToast('Delivery address updated');
  };

  const addAddress = (newAddr: Omit<Address, 'id'>) => {
    const id = `addr-${Date.now()}`;
    const fullAddress: Address = { ...newAddr, id };
    setUserProfile(prev => ({
      ...prev,
      addresses: [...prev.addresses, fullAddress],
      selectedAddressId: id
    }));
    showToast('New address saved!');
  };

  // Cart Functions
  const addToCart = (product: Product, qty: number = 1) => {
    if (product.availability === 'out_of_stock') {
      showToast(`${product.name} is currently out of stock`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + qty }
            : item
        );
      }
      return [...prev, { product, quantity: qty }];
    });
    showToast(`Added ${product.name} to cart`);
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateCartQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      }).filter(Boolean) as CartItem[];
    });
  };

  const clearCart = () => setCart([]);

  const cartTotalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
  const cartSubtotal = cart.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  const cartDeliveryFee = cartSubtotal > 0 ? (cartSubtotal > 2000 ? 0 : 120) : 0;
  const cartGrandTotal = cartSubtotal + cartDeliveryFee;

  // Catalog Functions
  const updateProductStock = (id: string, newStock: number) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const availability = newStock === 0 ? 'out_of_stock' : newStock < 10 ? 'low_stock' : 'in_stock';
        return { ...p, stock: newStock, availability };
      }
      return p;
    }));
    showToast('Inventory updated!');
  };

  const updateProductPrice = (id: string, newPrice: number) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, price: newPrice } : p));
    showToast('Product price updated!');
  };

  const addProduct = (newProd: Omit<Product, 'id'>) => {
    const id = `p-${Date.now()}`;
    const fullProduct: Product = { ...newProd, id };
    setProducts(prev => [fullProduct, ...prev]);
    showToast(`Product "${newProd.name}" added to catalog!`);
  };

  // Order Placement & Workflow
  const placeOrder = (paymentMethod: 'COD' | 'ONLINE', notes?: string): Order => {
    const orderId = `BLK-${Math.floor(10000 + Math.random() * 90000)}`;
    const newOrder: Order = {
      id: orderId,
      customerName: userProfile.name,
      customerPhone: userProfile.phone,
      address: selectedAddress,
      items: cart.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        unit: item.product.unit,
        price: item.product.price,
        quantity: item.quantity,
        image: item.product.image,
        packed: false
      })),
      subtotal: cartSubtotal,
      deliveryFee: cartDeliveryFee,
      total: cartGrandTotal,
      paymentMethod,
      status: 'placed',
      createdAt: 'Just now',
      estimatedTime: '20–30 mins',
      notes
    };

    setOrders(prev => [newOrder, ...prev]);
    clearCart();
    setActiveTrackingOrder(newOrder);

    // Trigger celebration confetti
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00B761', '#D4E157', '#FACC15', '#ffffff']
      });
    } catch (e) {
      // fallback
    }

    return newOrder;
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus, riderId?: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        const updated: Order = { ...o, status };
        if (riderId) {
          const r = riders.find(rider => rider.id === riderId);
          if (r) {
            updated.riderId = r.id;
            updated.riderName = r.name;
            updated.riderPhone = r.phone;
          }
        }
        return updated;
      }
      return o;
    }));

    showToast(`Order #${orderId} marked as ${status.replace('_', ' ').toUpperCase()}`);
  };

  const toggleOrderItemPacked = (orderId: string, productId: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        const updatedItems = o.items.map(item => {
          if (item.productId === productId) {
            return { ...item, packed: !item.packed };
          }
          return item;
        });

        // If all items are now packed, auto advance status suggestion to 'packed'
        const allPacked = updatedItems.every(i => i.packed);
        const newStatus = allPacked ? 'packed' : o.status;

        return { ...o, items: updatedItems, status: newStatus };
      }
      return o;
    }));
  };

  const assignRiderToOrder = (orderId: string, riderId: string) => {
    const selectedRider = riders.find(r => r.id === riderId);
    if (!selectedRider) return;

    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        return {
          ...o,
          riderId: selectedRider.id,
          riderName: selectedRider.name,
          riderPhone: selectedRider.phone,
          status: o.status === 'placed' || o.status === 'packed' ? 'out_for_delivery' : o.status
        };
      }
      return o;
    }));

    // Update rider status to 'on_delivery'
    setRiders(prev => prev.map(r => r.id === riderId ? { ...r, status: 'on_delivery', currentOrderId: orderId } : r));

    showToast(`Rider ${selectedRider.name} assigned to Order #${orderId}`);
  };

  // Rider Functions
  const toggleRiderStatus = (riderId: string) => {
    setRiders(prev => prev.map(r => {
      if (r.id === riderId) {
        const nextStatus = r.status === 'online' ? 'offline' : 'online';
        return { ...r, status: nextStatus };
      }
      return r;
    }));
  };

  const addRider = (newRider: Omit<Rider, 'id' | 'completedToday' | 'totalDeliveries' | 'rating'>) => {
    const id = `r-${Date.now()}`;
    const fullRider: Rider = {
      ...newRider,
      id,
      completedToday: 0,
      totalDeliveries: 0,
      rating: 5.0
    };
    setRiders(prev => [...prev, fullRider]);
    showToast(`New rider ${newRider.name} added!`);
  };

  const activeRider = riders[0]; // Salman Mohamed as demo active rider

  return (
    <AppContext.Provider
      value={{
        role,
        setRole,
        viewMode,
        setViewMode,
        customerTab,
        setCustomerTab,
        adminTab,
        setAdminTab,
        categories: INITIAL_CATEGORIES,
        products,
        selectedCategoryId,
        setSelectedCategoryId,
        selectedProduct,
        setSelectedProduct,
        searchQuery,
        setSearchQuery,
        updateProductStock,
        updateProductPrice,
        addProduct,
        cart,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        cartTotalItems,
        cartSubtotal,
        cartDeliveryFee,
        cartGrandTotal,
        userProfile,
        setUserProfile,
        selectedAddress,
        setSelectedAddressId,
        addAddress,
        orders,
        activeTrackingOrder,
        setActiveTrackingOrder,
        placeOrder,
        updateOrderStatus,
        toggleOrderItemPacked,
        assignRiderToOrder,
        riders,
        toggleRiderStatus,
        activeRider,
        addRider,
        toastMessage,
        showToast,
        isOnboardingComplete,
        setIsOnboardingComplete
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

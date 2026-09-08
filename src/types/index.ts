export type CategoryId = 
  | 'vegetables' 
  | 'fruits' 
  | 'dairy' 
  | 'snacks' 
  | 'beverages' 
  | 'grains' 
  | 'bakery' 
  | 'household' 
  | 'personal';

export type ProductAvailability = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface Product {
  id: string;
  name: string;
  category: CategoryId;
  subcategory: string;
  brand: string;
  image: string;
  unit: string;
  price: number;
  originalPrice?: number;
  stock: number;
  availability: ProductAvailability;
  isPopular?: boolean;
  isFresh?: boolean;
  description?: string;
}

export interface Category {
  id: CategoryId;
  name: string;
  iconName: string;
  image: string;
  subcategories: string[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Address {
  id: string;
  label: 'Home' | 'Work' | 'Other';
  houseNo: string;
  street: string;
  area: string;
  city: string;
  landmark?: string;
  instructions?: string;
  isDefault?: boolean;
}

export type OrderStatus = 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';

export interface OrderItem {
  productId: string;
  productName: string;
  unit: string;
  price: number;
  quantity: number;
  image: string;
  packed?: boolean;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  address: Address;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: 'COD' | 'ONLINE';
  status: OrderStatus;
  createdAt: string;
  estimatedTime: string;
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  notes?: string;
}

export interface Rider {
  id: string;
  name: string;
  phone: string;
  status: 'online' | 'offline' | 'on_delivery';
  currentOrderId?: string;
  completedToday: number;
  totalDeliveries: number;
  rating: number;
  vehicleNo: string;
}

export interface UserProfile {
  name: string;
  phone: string;
  addresses: Address[];
  selectedAddressId: string;
  isLoggedIn: boolean;
}

export type AppRole = 'customer' | 'rider' | 'darkstore' | 'admin';

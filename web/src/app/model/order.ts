// ตรงกับตาราง orders และ /orders ของ backend
export type OrderStatus = 'pending' | 'assigned' | 'delivered';

export interface Order {
  order_id: number;
  customer_id: number;
  order_date: string; // YYYY-MM-DD
  box_count: number;
  order_status: OrderStatus;
  delivery_note: string | null;
  created_at: string;
}

// body ของ POST /orders
export interface OrderPostRequest {
  customer_id: number;
  order_date?: string;
  box_count: number;
  delivery_note?: string;
}

// body ของ PUT /orders/:id (ส่งเฉพาะ field ที่แก้ก็ได้)
export type OrderPutRequest = Partial<Pick<Order, 'customer_id' | 'box_count' | 'order_status' | 'delivery_note' | 'order_date'>>;

// ออเดอร์ที่ JOIN กับลูกค้าแล้ว (GET /orders, GET /orders/:id, GET /orders/nearby)
export interface OrderWithCustomer extends Order {
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_km?: number; // มีเฉพาะ /orders/nearby
}

export interface OrderCreateResponse {
  affected_row: number;
  last_id: number;
}

export interface OrderSimulateResponse {
  affected_row: number;
  count: number;
}

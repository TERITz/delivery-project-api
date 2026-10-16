// ข้อมูลออเดอร์จากตาราง orders
export interface Order {
  order_id: number;
  customer_id: number;
  order_date: string;
  box_count: number;
  order_status: "pending" | "assigned" | "delivered";
  delivery_note: string | null;
  created_at: string;
}

// ข้อมูลสำหรับรับเข้าตอนสร้างออเดอร์ใหม่
export interface OrderPostRequest {
  customer_id: number;
  order_date?: string;
  box_count: number;
  delivery_note?: string;
}

// ข้อมูลออเดอร์หลัง JOIN กับ customer (มีข้อมูลและพิกัดลูกค้าครบถ้วน)
export interface OrderWithCustomer extends Order {
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_km?: number;
}
// ตรงกับตาราง customer และ /customers ของ backend
export interface Customer {
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

// body ของ POST /customers
export interface CustomerPostRequest {
  first_name: string;
  last_name: string;
  phone: string;
  address?: string;
  latitude: number;
  longitude: number;
}

// body ของ PUT /customers/:id (ส่งเฉพาะ field ที่แก้ก็ได้, address ส่ง null = ล้างที่อยู่)
export type CustomerPutRequest = Partial<Omit<CustomerPostRequest, 'address'>> & {
  address?: string | null;
};

// ผลของ GET /customers/nearby (มีระยะทางเพิ่มมา)
export interface CustomerNearby extends Customer {
  distance_km: number;
}

// ตัวกรองของ GET /customers/search
export interface CustomerSearchParams {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

// ผลตอบกลับ
export interface CustomerCreateResponse {
  affected_row: number;
  last_id: number;
}

export interface CustomerSimulateResponse {
  affected_row: number;
}

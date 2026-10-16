export interface Customer {
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

export interface CustomerPostRequest {
  first_name: string;
  last_name: string;
  phone: string;
  address?: string;
  latitude: number;
  longitude: number;
}

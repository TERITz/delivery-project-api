import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_ENDPOINT } from '../../config/api';
import { AffectedResponse } from '../../model/common';
import {
  OrderCreateResponse,
  OrderPostRequest,
  OrderPutRequest,
  OrderSimulateResponse,
  OrderWithCustomer,
} from '../../model/order';

// เรียก API ของ /orders
@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private url = `${API_ENDPOINT}/orders`;

  // GET /orders
  getAll(): Promise<OrderWithCustomer[]> {
    return firstValueFrom(this.http.get<OrderWithCustomer[]>(this.url));
  }

  // GET /orders/:id
  getById(id: number): Promise<OrderWithCustomer> {
    return firstValueFrom(this.http.get<OrderWithCustomer>(`${this.url}/${id}`));
  }

  // GET /orders/nearby?lat=&lng=&radius=  (ไม่ส่ง lat/lng = ใช้พิกัดร้าน, radius เริ่มต้น 2 กม.)
  nearby(lat?: number, lng?: number, radius?: number): Promise<OrderWithCustomer[]> {
    let params = new HttpParams();
    if (lat !== undefined) params = params.set('lat', lat);
    if (lng !== undefined) params = params.set('lng', lng);
    if (radius !== undefined) params = params.set('radius', radius);
    return firstValueFrom(this.http.get<OrderWithCustomer[]>(`${this.url}/nearby`, { params }));
  }

  // POST /orders
  create(body: OrderPostRequest): Promise<OrderCreateResponse> {
    return firstValueFrom(this.http.post<OrderCreateResponse>(this.url, body));
  }

  // PUT /orders/:id
  update(id: number, body: OrderPutRequest): Promise<AffectedResponse> {
    return firstValueFrom(this.http.put<AffectedResponse>(`${this.url}/${id}`, body));
  }

  // DELETE /orders/:id  (ลบได้เฉพาะออเดอร์ที่ยัง pending)
  delete(id: number): Promise<AffectedResponse> {
    return firstValueFrom(this.http.delete<AffectedResponse>(`${this.url}/${id}`));
  }

  // DELETE /orders/all  (ลบออเดอร์ทั้งหมด)
  deleteAll(): Promise<AffectedResponse> {
    return firstValueFrom(this.http.delete<AffectedResponse>(`${this.url}/all`));
  }

  // POST /orders/simulate  { count } (1-200)
  simulate(count: number): Promise<OrderSimulateResponse> {
    return firstValueFrom(this.http.post<OrderSimulateResponse>(`${this.url}/simulate`, { count }));
  }
}

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_ENDPOINT } from '../../config/api';
import {
  Customer,
  CustomerCreateResponse,
  CustomerNearby,
  CustomerPostRequest,
  CustomerPutRequest,
  CustomerSearchParams,
  CustomerSimulateResponse,
} from '../../model/customer';
import { AffectedResponse } from '../../model/common';

// เรียก API ของ /customers
@Injectable({ providedIn: 'root' })
export class CustomerService {
  private http = inject(HttpClient);
  private url = `${API_ENDPOINT}/customers`;

  // GET /customers
  getAll(): Promise<Customer[]> {
    return firstValueFrom(this.http.get<Customer[]>(this.url));
  }

  // GET /customers/:id
  getById(id: number): Promise<Customer> {
    return firstValueFrom(this.http.get<Customer>(`${this.url}/${id}`));
  }

  // GET /customers/search?name=&first_name=&last_name=&phone=
  search(filter: CustomerSearchParams): Promise<Customer[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value.trim() !== '') {
        params = params.set(key, value.trim());
      }
    }
    return firstValueFrom(this.http.get<Customer[]>(`${this.url}/search`, { params }));
  }

  // GET /customers/nearby?lat=&lng=&radius=  (radius หน่วยกิโลเมตร)
  nearby(lat: number, lng: number, radius: number): Promise<CustomerNearby[]> {
    const params = new HttpParams().set('lat', lat).set('lng', lng).set('radius', radius);
    return firstValueFrom(this.http.get<CustomerNearby[]>(`${this.url}/nearby`, { params }));
  }

  // POST /customers
  create(body: CustomerPostRequest): Promise<CustomerCreateResponse> {
    return firstValueFrom(this.http.post<CustomerCreateResponse>(this.url, body));
  }

  // PUT /customers/:id
  update(id: number, body: CustomerPutRequest): Promise<AffectedResponse> {
    return firstValueFrom(this.http.put<AffectedResponse>(`${this.url}/${id}`, body));
  }

  // DELETE /customers/:id
  delete(id: number): Promise<AffectedResponse> {
    return firstValueFrom(this.http.delete<AffectedResponse>(`${this.url}/${id}`));
  }

  // POST /customers/simulate  { count } (1-200)
  simulate(count: number): Promise<CustomerSimulateResponse> {
    return firstValueFrom(this.http.post<CustomerSimulateResponse>(`${this.url}/simulate`, { count }));
  }
}

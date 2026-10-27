import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';

import { OrderService } from '../../services/api/order.service';
import { CustomerService } from '../../services/api/customer.service';
import { OrderWithCustomer } from '../../model/order';
import { Customer } from '../../model/customer';
import { getApiError } from '../../services/api/api-error';

import { SHOP } from '../../config/shop';

@Component({
  selector: 'app-order',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, DecimalPipe],
  templateUrl: './order.html',
})
export class OrderPage implements OnInit {
  private orderService = inject(OrderService);
  private customerService = inject(CustomerService);

  // ---------- ข้อมูลตาราง ----------
  orders = signal<OrderWithCustomer[]>([]);
  isOrderFull = computed(() => this.orders().length >= 30); // เช็คว่าถึง 30 ออเดอร์หรือยัง
  loading = signal(false);
  error = signal('');
  
  // ---------- ค้นหาตามระยะ ----------
  nearbyMode = signal(false);
  nearbyRadius = 5; // กม.

  // ---------- ฟอร์มรับออเดอร์ ----------
  searchPhone = '';
  isSearchingPhone = signal(false);
  
  // สถานะลูกค้า (มีในระบบแล้ว หรือ เป็นลูกค้าใหม่)
  existingCustomer = signal<Customer | null>(null);
  
  // ตัวแปรฟอร์ม
  form = {
    first_name: '',
    last_name: '',
    phone: '',
    address: '',
    latitude: SHOP.latitude,   // ดึงละติจูดจากร้านโดยตรง
    longitude: SHOP.longitude, // ดึงลองจิจูดจากร้านโดยตรง
    box_count: 1,
    delivery_note: ''
  };
  formError = signal('');
  saving = signal(false);

  // ---------- จำลองออเดอร์ ----------
  simulating = signal(false);
  clearing = signal(false);

  ngOnInit() {
    this.loadOrders();
  }

  // ==========================================
  // จัดการข้อมูลตารางออเดอร์
  // ==========================================
  async loadOrders() {
    this.loading.set(true);
    this.error.set('');
    this.nearbyMode.set(false);
    try {
      const data = await this.orderService.getAll();
      this.orders.set(data);
    } catch (err) {
      this.error.set(getApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async loadNearby() {
    if (!this.nearbyRadius || this.nearbyRadius <= 0) return;
    this.loading.set(true);
    this.nearbyMode.set(true);
    try {
      const data = await this.orderService.nearby(SHOP.latitude, SHOP.longitude, this.nearbyRadius);
      this.orders.set(data);
    } catch (err) {
      this.error.set(getApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ==========================================
  // ค้นหาลูกค้าด้วยเบอร์โทร
  // ==========================================
  async checkCustomerPhone() {
    const phone = this.searchPhone.trim().replace(/[\s-]/g, '');
    if (!phone) {
      this.formError.set('กรุณากรอกเบอร์โทรศัพท์เพื่อค้นหา');
      return;
    }

    this.isSearchingPhone.set(true);
    this.formError.set('');
    
    try {
      const results = await this.customerService.search({ phone });
      
      if (results.length > 0) {
        const c = results[0];
        this.existingCustomer.set(c);
        this.form.phone = c.phone;
        this.form.first_name = c.first_name;
        this.form.last_name = c.last_name;
        this.form.address = c.address || '';
        this.form.latitude = c.latitude;
        this.form.longitude = c.longitude;
      } else {
        this.existingCustomer.set(null);
        this.form.phone = phone;
        this.formError.set('ไม่พบข้อมูลลูกค้า กรุณากรอกข้อมูลเพื่อเพิ่มลูกค้าใหม่');
      }
    } catch (err) {
      this.formError.set(getApiError(err));
    } finally {
      this.isSearchingPhone.set(false);
    }
  }

  resetForm() {
    this.searchPhone = '';
    this.existingCustomer.set(null);
    this.formError.set('');
    this.form = {
      first_name: '', last_name: '', phone: '', address: '',
      latitude: SHOP.latitude, longitude: SHOP.longitude, box_count: 1, delivery_note: ''
    };
  }

  // ==========================================
  // บันทึกออเดอร์
  // ==========================================
  async submitOrder() {
    this.formError.set('');
    
    if (this.form.box_count < 1 || this.form.box_count > 3) {
      this.formError.set('จำนวนกล่องต้องอยู่ระหว่าง 1 ถึง 3 กล่องเท่านั้น');
      return;
    }

    if (!this.form.first_name || !this.form.last_name || !this.form.phone) {
      this.formError.set('กรุณากรอกชื่อ นามสกุล และเบอร์โทรลูกค้าให้ครบถ้วน');
      return;
    }

    this.saving.set(true);
    try {
      let customerId = this.existingCustomer()?.customer_id;

      if (!customerId) {
        const newCustomerRes = await this.customerService.create({
          first_name: this.form.first_name,
          last_name: this.form.last_name,
          phone: this.form.phone,
          address: this.form.address || undefined,
          latitude: Number(this.form.latitude),
          longitude: Number(this.form.longitude)
        });
        customerId = newCustomerRes.last_id;
      }

      await this.orderService.create({
        customer_id: customerId,
        box_count: this.form.box_count,
        delivery_note: this.form.delivery_note || undefined
      });

      alert('รับออเดอร์เรียบร้อย!');
      this.resetForm();
      this.loadOrders();

    } catch (err) {
      this.formError.set(getApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  // ==========================================
  // จัดการออเดอร์ (ลบ / จำลอง)
  // ==========================================
  async deleteOrder(id: number) {
    if (!confirm('ยืนยันการลบออเดอร์นี้? (ลบได้เฉพาะสถานะ pending)')) return;
    try {
      await this.orderService.delete(id);
      this.loadOrders();
    } catch (err) {
      alert(getApiError(err));
    }
  }

  async editOrder(order: OrderWithCustomer) {
    const newCountStr = prompt(
      `แก้ไขจำนวนกล่องของออเดอร์รหัส ${order.order_id}\n(คุณ ${order.first_name} ${order.last_name})\n\nระบุจำนวนกล่องใหม่ (1-3):`, 
      order.box_count.toString()
    );
    
    if (newCountStr === null) return; // กดยกเลิก
    
    const newCount = parseInt(newCountStr, 10);
    if (isNaN(newCount) || newCount < 1 || newCount > 3) {
      alert('กรุณาระบุจำนวนกล่องเป็นตัวเลข 1 ถึง 3 เท่านั้น');
      return;
    }

    if (newCount === order.box_count) return; // ค่าเดิม ไม่ต้องอัปเดต

    try {
      await this.orderService.update(order.order_id, { box_count: newCount });
      this.loadOrders();
    } catch (err) {
      alert(getApiError(err));
    }
  }

  async clearAllOrders() {
    if (!confirm('ระวัง! ยืนยันการลบ "ออเดอร์ทั้งหมด" ในระบบใช่หรือไม่?')) return;
    this.clearing.set(true);
    try {
      await this.orderService.deleteAll();
      this.loadOrders();
    } catch (err) {
      alert(getApiError(err));
    } finally {
      this.clearing.set(false);
    }
  }

  async simulateOrders() {
    const count = prompt('ต้องการจำลองกี่ออเดอร์? (1-30)', '15');
    if (!count) return;
    const num = parseInt(count, 10);
    if (isNaN(num) || num < 1 || num > 30) {
      alert('กรุณากรอกตัวเลข 1-30');
      return;
    }

    this.simulating.set(true);
    try {
      const res = await this.orderService.simulate(num);
      alert(`จำลองออเดอร์สำเร็จ ${res.count} รายการ`);
      this.loadOrders();
    } catch (err) {
      alert(getApiError(err));
    } finally {
      this.simulating.set(false);
    }
  }
}
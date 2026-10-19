import { DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

import { SHOP } from '../../config/shop';
import { Customer, CustomerPostRequest } from '../../model/customer';
import { getApiError, getApiStatus } from '../../services/api/api-error';
import { CustomerService } from '../../services/api/customer.service';

// ลูกค้า 1 แถวในตาราง (distance_km มีเฉพาะผลจากการค้นตามระยะ)
type CustomerRow = Customer & { distance_km?: number };

// คำค้นที่ใช้อยู่ตอนนี้ (ไว้โหลดซ้ำหลังแก้/ลบ ให้ตารางตรงกับตัวกรองเดิม)
type Query =
  | { mode: 'all' }
  | { mode: 'search'; name: string; phone: string }
  | { mode: 'nearby'; lat: number; lng: number; radius: number };

interface CustomerForm {
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

@Component({
  selector: 'app-customer',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './customer.html',
})
export class CustomerPage implements OnInit, AfterViewInit, OnDestroy {
  private customerService = inject(CustomerService);

  // ---------- แผนที่บ้านลูกค้า (Leaflet) ----------
  private mapEl = viewChild<ElementRef<HTMLDivElement>>('mapEl');
  private map: L.Map | null = null;
  private markerLayer: L.LayerGroup | null = null;
  private markers = new Map<number, L.CircleMarker>(); // customer_id -> หมุด
  private mapReady = signal(false);

  constructor() {
    // วาดหมุดใหม่ทุกครั้งที่รายการลูกค้าเปลี่ยน (ค้นหา / เพิ่ม / ลบ / จำลอง)
    effect(() => {
      const rows = this.customers();
      if (this.mapReady()) this.renderCustomerMarkers(rows);
    });
  }

  // ---------- ข้อมูลในตาราง ----------
  customers = signal<CustomerRow[]>([]);
  loading = signal(false);
  error = signal('');
  activeQuery = signal<Query>({ mode: 'all' });
  private requestId = 0; // กันผลของคำขอเก่าที่ตอบกลับช้ากว่ามาทับคำขอใหม่

  // ---------- แบ่งหน้า ----------
  pageSize = signal(10);
  page = signal(1);
  totalPages = computed(() => Math.max(1, Math.ceil(this.customers().length / this.pageSize())));
  currentPage = computed(() => Math.min(this.page(), this.totalPages()));
  pagedCustomers = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.customers().slice(start, start + this.pageSize());
  });

  // ---------- ตัวกรอง ----------
  filterTab = signal<'search' | 'nearby'>('search');
  searchName = '';
  searchPhone = '';
  nearbyLat: number | null = SHOP.latitude;
  nearbyLng: number | null = SHOP.longitude;
  nearbyRadius: number | null = 1;

  // ---------- ฟอร์มเพิ่ม/แก้ไข ----------
  editingId = signal<number | null>(null); // null = กำลังเพิ่มใหม่
  form: CustomerForm = this.emptyForm();
  formError = signal('');
  saving = signal(false);
  locating = signal(false);
  private formDialog = viewChild.required<ElementRef<HTMLDialogElement>>('formDialog');

  // ---------- ลบ ----------
  deleteTarget = signal<Customer | null>(null);
  deleting = signal(false);
  deleteError = signal('');
  private deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');

  // ---------- จำลองลูกค้า ----------
  simulateCount: number | null = 30;
  simulating = signal(false);

  // ---------- แจ้งเตือนมุมจอ ----------
  toast = signal<{ type: 'success' | 'error'; text: string } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    this.loadAll();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
    this.map?.remove();
    this.map = null;
  }

  // =====================================================
  // แผนที่บ้านลูกค้า
  // =====================================================
  private initMap(): void {
    const el = this.mapEl()?.nativeElement;
    if (!el || this.map) return;

    this.map = L.map(el, { center: [SHOP.latitude, SHOP.longitude], zoom: 13, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    // ร้าน + วงรัศมี 3 กม. (พื้นที่ให้บริการตามโจทย์)
    L.circle([SHOP.latitude, SHOP.longitude], {
      radius: 3000,
      color: '#8a6d1d',
      weight: 1,
      dashArray: '6 6',
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(this.map);
    L.circleMarker([SHOP.latitude, SHOP.longitude], {
      radius: 10,
      color: '#7f1d1d',
      weight: 3,
      fillColor: '#dc2626',
      fillOpacity: 1,
    })
      .bindTooltip(this.escapeHtml(SHOP.name) + ' (ร้าน)', { permanent: false })
      .addTo(this.map);

    this.markerLayer = L.layerGroup().addTo(this.map);
    this.mapReady.set(true);
    setTimeout(() => this.map?.invalidateSize(), 250);
  }

  private renderCustomerMarkers(rows: CustomerRow[]): void {
    if (!this.map || !this.markerLayer) return;
    this.markerLayer.clearLayers();
    this.markers.clear();

    const points: L.LatLngExpression[] = [[SHOP.latitude, SHOP.longitude]];
    for (const c of rows) {
      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: 7,
        color: '#1f4d3a',
        weight: 2,
        fillColor: '#e8a825',
        fillOpacity: 0.95,
      }).bindPopup(
        `<b>${this.escapeHtml(c.first_name)} ${this.escapeHtml(c.last_name)}</b><br>` +
          `โทร ${this.escapeHtml(c.phone)}<br>` +
          `${this.escapeHtml(c.address || '-')}<br>` +
          `<small>${c.latitude}, ${c.longitude}</small>`,
      );
      m.addTo(this.markerLayer);
      this.markers.set(c.customer_id, m);
      points.push([c.latitude, c.longitude]);
    }

    // ปรับมุมมองให้เห็นลูกค้าทุกคนที่แสดงอยู่ (ถ้าไม่มีลูกค้าให้กลับมาที่ร้าน)
    if (rows.length > 0) {
      this.map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    } else {
      this.map.setView([SHOP.latitude, SHOP.longitude], 13);
    }
  }

  // ปุ่ม "ดูแผนที่" ในแถวตาราง: เลื่อนมาที่แผนที่แล้วซูมไปบ้านลูกค้าคนนั้น
  focusOnMap(c: CustomerRow): void {
    const marker = this.markers.get(c.customer_id);
    if (!this.map || !marker) return;
    this.mapEl()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.map.flyTo(marker.getLatLng(), 16);
    marker.openPopup();
  }

  // กัน HTML แทรกจากข้อมูลที่ผู้ใช้กรอก (ชื่อ/ที่อยู่) ก่อนใส่ใน popup
  private escapeHtml(s: string): string {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  // =====================================================
  // โหลดข้อมูล
  // =====================================================
  private async load(query: Query, resetPage: boolean): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    try {
      let rows: CustomerRow[];
      if (query.mode === 'search') {
        rows = await this.customerService.search({ name: query.name, phone: query.phone });
      } else if (query.mode === 'nearby') {
        rows = await this.customerService.nearby(query.lat, query.lng, query.radius);
      } else {
        rows = await this.customerService.getAll();
      }
      if (id !== this.requestId) return;
      this.activeQuery.set(query);
      this.customers.set(rows);
      if (resetPage) this.page.set(1);
    } catch (err) {
      if (id !== this.requestId) return;
      this.customers.set([]);
      this.error.set(getApiError(err));
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  // โหลดตามตัวกรองเดิมซ้ำ (ใช้หลังแก้ไข/ลบ — คงหน้าที่ดูอยู่)
  refresh(): Promise<void> {
    return this.load(this.activeQuery(), false);
  }

  loadAll(): Promise<void> {
    return this.load({ mode: 'all' }, true);
  }

  // ปุ่ม "ล้างตัวกรอง"
  clearFilters(): Promise<void> {
    this.searchName = '';
    this.searchPhone = '';
    this.nearbyLat = SHOP.latitude;
    this.nearbyLng = SHOP.longitude;
    this.nearbyRadius = 1;
    return this.loadAll();
  }

  // =====================================================
  // ค้นหาจากชื่อ / เบอร์
  // =====================================================
  search(): Promise<void> {
    const name = this.searchName.trim();
    const phone = this.searchPhone.trim();
    if (!name && !phone) return this.loadAll();
    return this.load({ mode: 'search', name, phone }, true);
  }

  // =====================================================
  // ค้นลูกค้าในระยะ
  // =====================================================
  searchNearby(): Promise<void> | void {
    const lat = this.nearbyLat;
    const lng = this.nearbyLng;
    const radius = this.nearbyRadius;
    if (lat === null || lng === null || radius === null || !isFinite(lat) || !isFinite(lng) || !isFinite(radius)) {
      this.showToast('error', 'กรอกละติจูด ลองจิจูด และระยะ (กม.) ให้ครบ');
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      this.showToast('error', 'พิกัดไม่ถูกต้อง (ละติจูด -90 ถึง 90, ลองจิจูด -180 ถึง 180)');
      return;
    }
    if (radius <= 0) {
      this.showToast('error', 'ระยะต้องมากกว่า 0 กิโลเมตร');
      return;
    }
    return this.load({ mode: 'nearby', lat, lng, radius }, true);
  }

  useShopLocation(): void {
    this.nearbyLat = SHOP.latitude;
    this.nearbyLng = SHOP.longitude;
  }

  // =====================================================
  // เพิ่ม / แก้ไข
  // =====================================================
  private emptyForm(): CustomerForm {
    return {
      first_name: '',
      last_name: '',
      phone: '',
      address: '',
      latitude: SHOP.latitude,
      longitude: SHOP.longitude,
    };
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.formError.set('');
    this.formDialog().nativeElement.showModal();
  }

  openEdit(c: Customer): void {
    this.editingId.set(c.customer_id);
    this.form = {
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
      address: c.address ?? '',
      latitude: c.latitude,
      longitude: c.longitude,
    };
    this.formError.set('');
    this.formDialog().nativeElement.showModal();
  }

  useCurrentLocationInForm(): void {
    if (!('geolocation' in navigator)) {
      this.formError.set('เบราว์เซอร์นี้ไม่รองรับการหาตำแหน่ง');
      return;
    }
    this.locating.set(true);
    this.formError.set('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.form.latitude = Number(pos.coords.latitude.toFixed(6));
        this.form.longitude = Number(pos.coords.longitude.toFixed(6));
        this.locating.set(false);
      },
      () => {
        this.formError.set('ดึงตำแหน่งปัจจุบันไม่ได้ (ตรวจสอบว่าอนุญาตการเข้าถึงตำแหน่งแล้ว)');
        this.locating.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  closeForm(): void {
    this.formDialog().nativeElement.close();
  }

  // คืนข้อความ error ถ้าฟอร์มไม่ถูกต้อง, null ถ้าผ่าน
  private validateForm(): string | null {
    const f = this.form;
    if (!f.first_name.trim()) return 'กรอกชื่อ';
    if (!f.last_name.trim()) return 'กรอกนามสกุล';
    const phone = f.phone.replace(/[\s-]/g, '');
    if (!/^\d{9,10}$/.test(phone)) return 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก';
    if (f.latitude === null || f.longitude === null || !isFinite(f.latitude) || !isFinite(f.longitude)) {
      return 'กรอกละติจูดและลองจิจูด';
    }
    if (f.latitude < -90 || f.latitude > 90) return 'ละติจูดต้องอยู่ระหว่าง -90 ถึง 90';
    if (f.longitude < -180 || f.longitude > 180) return 'ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180';
    return null;
  }

  async save(): Promise<void> {
    const invalid = this.validateForm();
    if (invalid) {
      this.formError.set(invalid);
      return;
    }

    const f = this.form;
    const address = f.address.trim();
    const base = {
      first_name: f.first_name.trim(),
      last_name: f.last_name.trim(),
      phone: f.phone.replace(/[\s-]/g, ''),
      latitude: Number(f.latitude),
      longitude: Number(f.longitude),
    };

    this.saving.set(true);
    this.formError.set('');
    try {
      const id = this.editingId();
      if (id === null) {
        const body: CustomerPostRequest = { ...base, address: address || undefined };
        await this.customerService.create(body);
        this.closeForm();
        this.showToast('success', 'เพิ่มลูกค้าเรียบร้อย');
        // กลับไปดูรายการทั้งหมด จะได้เห็นลูกค้าที่เพิ่งเพิ่ม
        this.searchName = '';
        this.searchPhone = '';
        await this.loadAll();
      } else {
        await this.customerService.update(id, { ...base, address: address || null });
        this.closeForm();
        this.showToast('success', 'แก้ไขข้อมูลลูกค้าเรียบร้อย');
        await this.refresh();
      }
    } catch (err) {
      this.formError.set(getApiStatus(err) === 409 ? 'เบอร์โทรนี้มีอยู่ในระบบแล้ว' : getApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  // =====================================================
  // ลบ
  // =====================================================
  askDelete(c: Customer): void {
    this.deleteTarget.set(c);
    this.deleteError.set('');
    this.deleteDialog().nativeElement.showModal();
  }

  closeDelete(): void {
    this.deleteDialog().nativeElement.close();
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.customerService.delete(target.customer_id);
      this.closeDelete();
      this.showToast('success', `ลบลูกค้า ${target.first_name} ${target.last_name} แล้ว`);
      await this.refresh();
    } catch (err) {
      this.deleteError.set(
        getApiStatus(err) === 409
          ? 'ลบไม่ได้ เพราะลูกค้ามีออเดอร์ที่ถูกจัดเข้าแผนเส้นทางแล้ว (ต้องลบแผนเส้นทางนั้นก่อน)'
          : getApiError(err),
      );
    } finally {
      this.deleting.set(false);
    }
  }

  // =====================================================
  // จำลองลูกค้า
  // =====================================================
  async simulate(): Promise<void> {
    const count = this.simulateCount;
    if (count === null || !Number.isInteger(count) || count < 1 || count > 200) {
      this.showToast('error', 'จำนวนลูกค้าจำลองต้องเป็นจำนวนเต็ม 1-200');
      return;
    }

    this.simulating.set(true);
    try {
      const res = await this.customerService.simulate(count);
      const skipped = count - res.affected_row;
      this.showToast(
        'success',
        `เพิ่มลูกค้าจำลอง ${res.affected_row} คน` + (skipped > 0 ? ` (ข้าม ${skipped} คนเพราะเบอร์ซ้ำ)` : ''),
      );
      this.searchName = '';
      this.searchPhone = '';
      await this.loadAll();
    } catch (err) {
      this.showToast('error', getApiError(err));
    } finally {
      this.simulating.set(false);
    }
  }

  // =====================================================
  // อื่น ๆ
  // =====================================================
  setPageSize(size: number): void {
    this.pageSize.set(Number(size));
    this.page.set(1);
  }

  mapUrl(c: Customer): string {
    return `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`;
  }

  showToast(type: 'success' | 'error', text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ type, text });
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }
}
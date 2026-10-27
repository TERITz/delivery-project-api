import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, viewChild, ElementRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

import { SHOP } from '../../config/shop';
import { RouteService } from '../../services/api/route.service';
import {
  RoutePlan,
  RoutePlanDetail,
  RoutePlanRequest,
} from '../../model/route';
import { getApiError } from '../../services/api/api-error';

export interface NormalizedStop {
  order_id: number;
  stop_sequence: number;
  arrival_time: string | null;
  is_late: boolean;
  latitude: number;
  longitude: number;
  customer_name?: string;
  phone?: string;
  address?: string | null;
  box_count?: number;
  delivery_note?: string | null;
  order_status?: string;
  google_maps_url?: string;
}

export interface NormalizedJob {
  job_id?: number;
  rider_name: string;
  access_code: string;
  route_color: string;
  total_boxes: number;
  distance_km: number;
  fuel_cost: number; // ความหมายจริง = ค่าจ้างไรเดอร์
  job_status?: string;
  stops: NormalizedStop[];
  late_stops_count: number;
}

export interface NormalizedPlanView {
  plan_id: number;
  plan_date: string;
  plan_status?: string;
  total_distance_km: number;
  total_fuel_cost: number; // ความหมายจริง = ค่าจ้างไรเดอร์รวม
  shop: { name: string; latitude: number; longitude: number };
  jobs: NormalizedJob[];
  total_boxes: number;
  total_stops: number;
  total_late_stops: number;
  // สรุปจาก backend
  revenue: number;
  food_cost: number;
  rider_cost: number;
  profit: number;
  finish_time: string | null;
}

// ฟิลด์สรุปที่ backend ส่งเพิ่ม (ถ้า model/route.ts ยังไม่มี ใช้ตัวนี้ครอบไว้ก่อน)
interface PlanSummaryExtras {
  revenue?: number | string;
  food_cost?: number | string;
  rider_cost?: number | string;
  profit?: number | string;
  finish_time?: string | null;
}

@Component({
  selector: 'app-route',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './route.html',
})
export class RoutePage implements OnInit, OnDestroy, AfterViewInit {
  private routeService = inject(RouteService);

  private mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');
  private deleteModal = viewChild<ElementRef<HTMLDialogElement>>('deleteModal');

  // ---------- แผนและประวัติ ----------
  plans = signal<RoutePlan[]>([]);
  selectedPlanId = signal<number | null>(null);
  currentPlan = signal<NormalizedPlanView | null>(null);

  // ---------- วันที่สำหรับการจัดเส้นทาง ----------
  planDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  // ---------- สถานะการทำงาน ----------
  loading = signal(false);
  planning = signal(false);
  deleting = signal(false);
  error = signal('');
  successMessage = signal('');

  // ---------- การกรอง / เลือกไรเดอร์ ----------
  selectedRiderIndex = signal<number | null>(null);
  expandedRiderIndex = signal<number | null>(null);

  // ---------- ลบแผน ----------
  planToDelete = signal<RoutePlan | null>(null);

  // ---------- Leaflet Map References ----------
  private map: L.Map | null = null;
  private layerGroup: L.LayerGroup | null = null;

  // กติกาตามโจทย์
  readonly MAX_ORDERS_PER_RIDER = 3; // ไรเดอร์รับไม่เกินคนละ 3 ออเดอร์
  readonly DEADLINE_MIN = 12 * 60 + 30; // ต้องส่งถึงไม่เกิน 12:30

  // แคชเส้นทางถนน กันยิง API ซ้ำเวลากรองไรเดอร์/สลับแผน
  private roadGeometryCache = new Map<string, [number, number][]>();
  // ใช้กันผลลัพธ์เก่าที่ตอบกลับมาช้า ไปวาดทับแผนที่ที่เปลี่ยนไปแล้ว
  private renderVersion = 0;
  // ใช้กันผลโหลดแผนเก่าที่ตอบกลับมาช้า ไปทับแผนที่เพิ่งเลือก
  private selectVersion = 0;

  // สรุปเวลาถึงจุดส่งสุดท้าย เทียบกับ 12:30
  finishInfo = computed(() => {
    const plan = this.currentPlan();
    if (!plan?.finish_time) return null;
    const text = this.formatTime(plan.finish_time);
    const m = /^(\d{2}):(\d{2})$/.exec(text);
    if (!m) return { text, late: false, diffMin: null as number | null };
    const mins = Number(m[1]) * 60 + Number(m[2]);
    const diff = this.DEADLINE_MIN - mins;
    return { text, late: diff < 0, diffMin: Math.abs(diff) as number | null };
  });

  // =====================================================
  // ตัวช่วย: ป้องกัน XSS เวลาแทรกข้อมูลลงใน HTML ของแผนที่
  // =====================================================
  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
    );
  }

  private safeUrl(url?: string | null): string | null {
    return url && /^https?:\/\//i.test(url) ? url : null;
  }

  // แปลงเวลาเป็น HH:mm (รองรับทั้งสตริง 'YYYY-MM-DD HH:mm:ss' และ ISO ที่มี Z/offset)
  formatTime(value: string | null | undefined): string {
    if (!value) return '-';
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Bangkok',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      }
    }
    const m = /(\d{1,2}):(\d{2})/.exec(value);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : value;
  }

  // ไรเดอร์คนนี้ได้เกินจำนวนออเดอร์ที่ตกลงกันไว้หรือไม่
  isOverLimit(job: NormalizedJob): boolean {
    return job.stops.length > this.MAX_ORDERS_PER_RIDER;
  }

  // ดึงเส้นทางตามถนนจริงจาก OSRM (ล้มเหลวจะคืน null แล้วใช้เส้นตรงเดิม)
  private async fetchRoadGeometry(
    points: [number, number][],
  ): Promise<[number, number][] | null> {
    const key = points.map(([la, ln]) => `${la.toFixed(6)},${ln.toFixed(6)}`).join(';');
    const cached = this.roadGeometryCache.get(key);
    if (cached) return cached;

    // OSRM ใช้ลำดับ lng,lat (กลับกับ Leaflet)
    const coords = points.map(([la, ln]) => `${ln},${la}`).join(';');
    const url =
      `https://router.project-osrm.org/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) return null;

      const geometry: [number, number][] = data.routes[0].geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng],
      );
      this.roadGeometryCache.set(key, geometry);
      return geometry;
    } catch {
      return null;
    }
  }

  ngOnInit(): void {
    this.loadPlans();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    // ยกเลิกงานที่ค้างอยู่ ไม่ให้ไปวาด/ตั้งค่าหลังหน้าถูกทำลาย
    this.renderVersion++;
    this.selectVersion++;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // สร้างและจัดการแผนที่ Leaflet
  private initMap(): void {
    const el = this.mapContainer()?.nativeElement;
    if (!el || this.map) return;

    this.map = L.map(el, {
      center: [SHOP.latitude, SHOP.longitude],
      zoom: 13,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.layerGroup = L.layerGroup().addTo(this.map);

    // ถ้ามีข้อมูลแผนอยู่แล้ว ให้วาดลงแผนที่
    if (this.currentPlan()) {
      this.renderMapRoutes();
    }

    setTimeout(() => {
      this.map?.invalidateSize();
    }, 250);
  }

  renderMapRoutes(): void {
    if (!this.map || !this.layerGroup) return;

    const version = ++this.renderVersion;
    this.layerGroup.clearLayers();

    const plan = this.currentPlan();
    if (!plan) return;

    const shopLat = plan.shop?.latitude ?? SHOP.latitude;
    const shopLng = plan.shop?.longitude ?? SHOP.longitude;
    const shopName = this.esc(plan.shop?.name || SHOP.name);

    // หมุดร้าน (จุดเริ่มต้น)
    const shopIcon = L.divIcon({
      className: 'shop-marker-icon',
      html: `
        <div style="position: relative; width: 38px; height: 48px; cursor: pointer;" title="${shopName}">
          <svg xmlns="http://www.w3.org/2000/svg" width="38" height="48" viewBox="0 0 38 48" style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.35));">
            <path d="M19 47 C19 47 36 29 36 18 C36 8.6 28.4 1 19 1 C9.6 1 2 8.6 2 18 C2 29 19 47 19 47 Z"
                  fill="#1f4d3c"
                  stroke="#e8a92b"
                  stroke-width="3" />
            <circle cx="19" cy="18" r="12" fill="#ebddbf" />
          </svg>
          <div style="position: absolute; top: 7px; left: 8px; color: #1f4d3c;">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
        </div>
      `,
      iconSize: [38, 48],
      iconAnchor: [19, 47],
      popupAnchor: [0, -48],
    });

    const shopMarker = L.marker([shopLat, shopLng], { icon: shopIcon }).bindPopup(`
      <div style="font-family: inherit; font-size: 13px; color: #2b2218; line-height: 1.4;">
        <strong style="font-size: 14px; color: #1f4d3c;">🏠 ${shopName}</strong><br>
        <span style="color: #666;">(จุดกระจายอาหาร / เริ่มต้นเส้นทาง)</span><br>
        พิกัด: ${shopLat.toFixed(5)}, ${shopLng.toFixed(5)}
      </div>
    `);
    this.layerGroup.addLayer(shopMarker);

    const bounds = L.latLngBounds([L.latLng(shopLat, shopLng)]);
    let hasPoints = false;

    const filteredJobs = this.selectedRiderIndex() !== null
      ? [plan.jobs[this.selectedRiderIndex()!]].filter(Boolean)
      : plan.jobs;

    filteredJobs.forEach((job) => {
      if (!job) return;
      const sortedStops = [...job.stops].sort((a, b) => a.stop_sequence - b.stop_sequence);
      const color = this.esc(job.route_color || '#1f4d3c');
      const riderName = this.esc(job.rider_name);

      // เส้นทางของไรเดอร์: เริ่มจากร้านไปยังจุดส่งต่าง ๆ ตามลำดับ
      const routePoints: [number, number][] = [[shopLat, shopLng]];

      sortedStops.forEach((stop) => {
        if (!stop.latitude || !stop.longitude) return;
        routePoints.push([stop.latitude, stop.longitude]);
        bounds.extend([stop.latitude, stop.longitude]);
        hasPoints = true;

        const isLate = stop.is_late;
        const seq = Number(stop.stop_sequence);

        // ไอคอนหมุดแผนที่พร้อมตัวเลขลำดับข้างใน
        const stopIcon = L.divIcon({
          className: 'rider-stop-marker',
          html: `
            <div style="position: relative; width: 34px; height: 44px; cursor: pointer;">
              <svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44" style="filter: drop-shadow(0 3px 4px rgba(0,0,0,0.35));">
                <path d="M17 43 C17 43 32 27 32 16 C32 7.7 25.3 1 17 1 C8.7 1 2 7.7 2 16 C2 27 17 43 17 43 Z"
                      fill="${color}"
                      stroke="${isLate ? '#b23a25' : '#ffffff'}"
                      stroke-width="${isLate ? '3' : '2.5'}" />
                <circle cx="17" cy="16" r="10.5" fill="#ffffff" />
                <text x="17" y="20.5"
                      font-family="system-ui, -apple-system, sans-serif"
                      font-size="12"
                      font-weight="bold"
                      fill="${color}"
                      text-anchor="middle">${seq}</text>
              </svg>
              ${isLate ? `
                <span style="
                  position: absolute;
                  top: -4px;
                  right: -6px;
                  background: #b23a25;
                  color: #ffffff;
                  font-size: 9px;
                  font-weight: 800;
                  padding: 1px 4px;
                  border-radius: 9999px;
                  border: 1.5px solid #ffffff;
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                  line-height: 1;
                ">เลท</span>
              ` : ''}
            </div>
          `,
          iconSize: [34, 44],
          iconAnchor: [17, 43],
          popupAnchor: [0, -44],
        });

        const mapsUrl = this.safeUrl(stop.google_maps_url);

        const popupHtml = `
          <div style="font-family: inherit; font-size: 13px; color: #2b2218; line-height: 1.5; min-width: 190px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 6px;">
              <span style="font-weight: 700; color: ${color}; font-size: 14px;">
                ${riderName}
              </span>
              <span style="background: ${color}; color: #fff; padding: 1px 6px; border-radius: 9999px; font-size: 11px; font-weight: 600;">
                จุดที่ ${seq}
              </span>
            </div>
            <div><strong>ออเดอร์:</strong> #${Number(stop.order_id)}</div>
            ${stop.customer_name ? `<div><strong>ลูกค้า:</strong> ${this.esc(stop.customer_name)}</div>` : ''}
            ${stop.phone ? `<div><strong>โทร:</strong> <a href="tel:${this.esc(stop.phone)}" style="color: #1f4d3c; text-decoration: underline;">${this.esc(stop.phone)}</a></div>` : ''}
            ${stop.address ? `<div><strong>ที่อยู่:</strong> ${this.esc(stop.address)}</div>` : ''}
            ${stop.box_count ? `<div><strong>จำนวนกล่อง:</strong> ${Number(stop.box_count)} กล่อง</div>` : ''}
            <div><strong>เวลาส่งถึง:</strong> ${this.esc(this.formatTime(stop.arrival_time))}</div>
            <div style="margin-top: 6px;">
              ${isLate
                ? `<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">⚠️ ส่งเลท (เกิน 12:30)</span>`
                : `<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">✓ ส่งตรงเวลา</span>`}
            </div>
            ${stop.delivery_note ? `<div style="margin-top: 4px; font-size: 12px; color: #555;"><em>โน้ต: ${this.esc(stop.delivery_note)}</em></div>` : ''}
            ${mapsUrl ? `
              <div style="margin-top: 8px; padding-top: 4px; border-top: 1px dashed #ddd;">
                <a href="${this.esc(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color: #1f4d3c; font-weight: 600; text-decoration: underline; font-size: 12px;">
                  เปิดใน Google Maps ↗
                </a>
              </div>
            ` : ''}
          </div>
        `;

        const marker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
          .bindPopup(popupHtml);
        this.layerGroup!.addLayer(marker);
      });

      // วาดเส้น Polyline เชื่อมจุดส่งตามลำดับ
      if (routePoints.length > 1) {
        const lineColor = job.route_color || '#1f4d3c';

        // เส้นตรงแบบประจาง ๆ แสดงทันทีระหว่างรอ OSRM
        const polyline = L.polyline(routePoints, {
          color: lineColor,
          weight: 4,
          opacity: 0.45,
          dashArray: '6 8',
          lineJoin: 'round',
          lineCap: 'round',
        });
        this.layerGroup!.addLayer(polyline);

        // ได้เส้นถนนจริงแล้วค่อยสลับเป็นเส้นทึบตามถนน
        this.fetchRoadGeometry(routePoints).then((geometry) => {
          if (!geometry || version !== this.renderVersion) return;
          polyline.setLatLngs(geometry);
          polyline.setStyle({ opacity: 0.85, dashArray: '' });
        });
      }
    });

    // ปรับ Zoom ของแผนที่ให้ครอบคลุมจุดทั้งหมด
    if (hasPoints) {
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else {
      this.map.setView([shopLat, shopLng], 13);
    }

    setTimeout(() => {
      this.map?.invalidateSize();
    }, 100);
  }

  // โหลดรายการแผนทั้งหมด (GET /routes)
  async loadPlans(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.routeService.getAll();
      this.plans.set(data || []);

      if (data && data.length > 0) {
        const current = this.selectedPlanId();
        const target = data.find((p) => p.plan_id === current) ?? data[0];
        await this.selectPlan(target.plan_id);
      } else {
        this.selectVersion++;
        this.selectedPlanId.set(null);
        this.currentPlan.set(null);
        this.layerGroup?.clearLayers();
      }
    } catch (err) {
      this.error.set(getApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  // เลือกดูแผน (GET /routes/:plan_id)
  async selectPlan(planId: number): Promise<void> {
    const version = ++this.selectVersion;
    this.selectedPlanId.set(planId);
    this.selectedRiderIndex.set(null);
    this.expandedRiderIndex.set(null);
    this.error.set('');
    this.successMessage.set('');

    try {
      const detail = await this.routeService.getById(planId);
      if (version !== this.selectVersion) return; // มีการเลือกแผนอื่นแทรกเข้ามาแล้ว
      this.currentPlan.set(this.normalizeDetailResponse(detail));
      this.renderMapRoutes();
    } catch (err) {
      if (version !== this.selectVersion) return;
      this.error.set(getApiError(err));
    }
  }

  // ลำดับทางเลือกที่ขอ (เพิ่มทีละ 1 ทุกครั้งที่กดคำนวณใหม่ทับแผนเดิม)
  private variant = 0;

  // จัดเส้นทาง / คำนวณใหม่ (POST /routes/plan)
  async planRoutes(): Promise<void> {
    this.planning.set(true);
    this.error.set('');
    this.successMessage.set('');
    this.selectedRiderIndex.set(null);

    const body: RoutePlanRequest = {};
    if (this.planDate) {
      body.plan_date = this.planDate;
    }

    // ถ้ามีแผนของวันที่เลือกอยู่แล้ว = คำนวณใหม่ทับแผนนั้น และขอทางเลือกถัดไป
    const cur = this.currentPlan();
    if (cur && cur.plan_date?.slice(0, 10) === this.planDate) {
      this.variant++;
      body.replace_plan_id = cur.plan_id;
      body.variant = this.variant;
    } else {
      this.variant = 0;
    }

    try {
      const res = await this.routeService.plan(body);
      this.plans.set((await this.routeService.getAll()) || []);
      // โหลดรายละเอียดเต็ม (มีชื่อลูกค้า เบอร์ ที่อยู่) แล้ววาดแผนที่
      await this.selectPlan(res.plan_id);
      // selectPlan ล้างข้อความ เลยตั้งหลังสุด
      this.successMessage.set(res.message || 'จัดเส้นทางเรียบร้อยแล้ว');
    } catch (err) {
      this.error.set(getApiError(err));
    } finally {
      this.planning.set(false);
    }
  }

  // การลบแผน (DELETE /routes/:plan_id)
  openDeleteModal(): void {
    const activeId = this.selectedPlanId();
    if (!activeId) return;
    const plan = this.plans().find((p) => p.plan_id === activeId);
    if (!plan && this.currentPlan()) {
      const cur = this.currentPlan()!;
      this.planToDelete.set({
        plan_id: cur.plan_id,
        plan_date: cur.plan_date,
        plan_status: cur.plan_status || 'planned',
        total_distance_km: cur.total_distance_km,
        total_fuel_cost: cur.total_fuel_cost,
      });
    } else {
      this.planToDelete.set(plan || null);
    }
    this.deleteModal()?.nativeElement.showModal();
  }

  closeDeleteModal(): void {
    this.deleteModal()?.nativeElement.close();
    this.planToDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.planToDelete();
    if (!target) return;

    this.deleting.set(true);
    this.error.set('');
    try {
      await this.routeService.delete(target.plan_id);
      this.closeDeleteModal();

      // โหลดรายการแผนใหม่ (selectPlan ข้างในจะล้างข้อความ จึงตั้งข้อความหลังสุด)
      await this.loadPlans();
      this.successMessage.set(`ลบแผน #${target.plan_id} เรียบร้อยแล้ว`);
    } catch (err) {
      this.error.set(getApiError(err));
    } finally {
      this.deleting.set(false);
    }
  }

  // =====================================================
  // การกรองแสดงผลเฉพาะไรเดอร์
  // =====================================================
  toggleRiderFilter(index: number): void {
    if (this.selectedRiderIndex() === index) {
      this.selectedRiderIndex.set(null);
    } else {
      this.selectedRiderIndex.set(index);
    }
    this.renderMapRoutes();
  }

  showAllRiders(): void {
    this.selectedRiderIndex.set(null);
    this.renderMapRoutes();
  }

  toggleExpandRider(index: number): void {
    if (this.expandedRiderIndex() === index) {
      this.expandedRiderIndex.set(null);
    } else {
      this.expandedRiderIndex.set(index);
    }
  }

  // =====================================================
  // ตัวแปลงข้อมูลให้เป็นรูปแบบมาตรฐาน (Normalization)
  // is_late อาจมาเป็น 0/1 หรือ boolean
  // =====================================================
  private toBoolean(val: any): boolean {
    return val === true || val === 1 || val === '1' || val === 'true';
  }

  private normalizeDetailResponse(detailRaw: RoutePlanDetail): NormalizedPlanView {
    const detail = detailRaw as RoutePlanDetail & PlanSummaryExtras;

    const jobs: NormalizedJob[] = (detail.jobs || []).map((j) => {
      const stops: NormalizedStop[] = (j.stops || []).map((s) => ({
        order_id: s.order_id,
        stop_sequence: s.stop_sequence,
        arrival_time: s.arrival_time,
        is_late: this.toBoolean(s.is_late),
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        customer_name: s.first_name ? `${s.first_name} ${s.last_name || ''}`.trim() : undefined,
        phone: s.phone,
        address: s.address,
        box_count: s.box_count,
        delivery_note: s.delivery_note,
        order_status: s.order_status,
        google_maps_url: s.google_maps_url || s.google_maps_link,
      }));

      return {
        job_id: j.job_id,
        rider_name: j.rider_name,
        access_code: j.access_code,
        route_color: j.route_color,
        total_boxes: Number(j.total_boxes || 0),
        distance_km: Number(j.distance_km || 0),
        fuel_cost: Number(j.fuel_cost || 0),
        job_status: j.job_status,
        stops,
        late_stops_count: stops.filter((s) => s.is_late).length,
      };
    });

    return {
      plan_id: detail.plan_id,
      plan_date: detail.plan_date,
      plan_status: detail.plan_status,
      total_distance_km: Number(detail.total_distance_km || 0),
      total_fuel_cost: Number(detail.total_fuel_cost || 0),
      shop: detail.shop || {
        name: SHOP.name,
        latitude: SHOP.latitude,
        longitude: SHOP.longitude,
      },
      jobs,
      total_boxes: jobs.reduce((sum, j) => sum + j.total_boxes, 0),
      total_stops: jobs.reduce((sum, j) => sum + j.stops.length, 0),
      total_late_stops: jobs.reduce((sum, j) => sum + j.late_stops_count, 0),
      revenue: Number(detail.revenue || 0),
      food_cost: Number(detail.food_cost || 0),
      rider_cost: Number(detail.rider_cost ?? detail.total_fuel_cost ?? 0),
      profit: Number(detail.profit || 0),
      finish_time: detail.finish_time ?? null,
    };
  }
}
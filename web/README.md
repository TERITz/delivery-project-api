# delivery-project-web (ส่งด่วนมื้อเที่ยง)

Frontend ของระบบจัดเส้นทางไรเดอร์ — Angular + Tailwind CSS + DaisyUI
ต่อกับ backend `delivery-project-api` (Express + MySQL)

## เริ่มใช้งาน

```bash
npm install
npm start          # เปิด http://localhost:4200
```

ต้องมี backend เปิดอยู่ด้วย (`npm run dev` ในโปรเจกต์ api — ค่าเริ่มต้นพอร์ต 3000)
ถ้าใช้ backend ที่อื่น (เช่น Vercel) แก้ที่เดียวที่ `src/app/config/api.ts`:

```ts
export const API_ENDPOINT = 'http://localhost:3000';
```

> โปรเจกต์นี้ใช้ Angular 20 (standalone component, ไม่มี NgModule) และ Tailwind v4 + DaisyUI v5
> ถ้า Node เก่ากว่า 20.19 ให้อัปเดต Node ก่อน

## โครงโฟลเดอร์

```
src/app/
├── config/
│   ├── api.ts            # API_ENDPOINT (ที่อยู่ backend)
│   └── shop.ts           # พิกัดร้าน (ตรงกับ backend)
├── model/                # interface ตรงกับ response/request ของ backend
│   ├── customer.ts  order.ts  route.ts  job.ts  common.ts
├── services/api/         # เรียก API ทุกตัว (คืนค่าเป็น Promise)
│   ├── customer.service.ts  order.service.ts
│   ├── route.service.ts     job.service.ts
│   └── api-error.ts      # getApiError(err) ดึงข้อความ error จาก backend
├── components/navbar/    # เมนูบนสุด
├── pages/
│   ├── home/             # หน้าแรก
│   ├── customer/         # หน้าลูกค้า (เสร็จแล้ว)
│   ├── order/            # หน้าว่าง — รอเพื่อนทำ
│   ├── route/            # หน้าว่าง — รอเพื่อนทำ
│   └── job/              # หน้าว่าง — รอเพื่อนทำ
├── app.routes.ts         # route ทั้งหมด (เจ้าของไฟล์: คนที่ 1)
└── app.config.ts
```

## ธีม

ธีม DaisyUI ชื่อ `lunchrider` ตั้งไว้ใน `src/styles.css` (พื้นเขียวใบตอง + พื้นที่เนื้อหาเป็นสีกระดาษคราฟต์)
กติกาการใช้สีเพื่อให้ทุกหน้าหน้าตาเหมือนกัน:

- เนื้อหาหลักวางใน `<div class="panel">` (กระดาษ) ตัวหนังสือสีเข้มอัตโนมัติ
- ปุ่มหลักบนกระดาษใช้ `btn-primary` (เขียวเข้ม) ปุ่มบนพื้นเขียวใช้ `btn-accent` (ขมิ้น)
- หัวเรื่องหน้าที่อยู่บนพื้นเขียวใช้ `font-display text-3xl text-neutral-content`
- ตารางใช้ `class="table table-slip"` (หัวตารางเส้นทึบ แถวคั่นเส้นประ)
- ไม่ใช้อิโมจิ ถ้าต้องมีไอคอนให้ใช้ SVG

## Service ที่เตรียมไว้ให้เพื่อน

| Service | method |
|---|---|
| `CustomerService` | `getAll` `getById` `search` `nearby` `create` `update` `delete` `simulate` |
| `OrderService` | `getAll` `getById` `nearby` `create` `update` `delete` `deleteAll` `simulate` |
| `RouteService` | `plan` `getAll` `getById` `delete` |
| `JobService` | `getAll` `login` `getByAccessCode` `markDelivered` `updateStatus` `simulate` |

ตัวอย่างใช้งานในหน้า (ดูของจริงที่ `pages/customer/customer.ts`):

```ts
private orderService = inject(OrderService);

async load() {
  try {
    this.orders.set(await this.orderService.getAll());
  } catch (err) {
    this.error.set(getApiError(err));   // import จาก services/api/api-error
  }
}
```

## วิธีเพิ่มหน้า / route (สำหรับเพื่อน)

1. ทำหน้าในโฟลเดอร์ `pages/<ชื่อ>/` ของตัวเอง (หน้าว่างมีให้แล้ว: order, route, job)
2. ถ้าต้องการ route ใหม่ที่ยังไม่มี ส่งบรรทัดแบบนี้ให้คนที่ 1 ไปวางใน `app.routes.ts`
   ```ts
   { path: 'xxx', title: 'ชื่อหน้า', loadComponent: () => import('./pages/xxx/xxx').then((m) => m.XxxPage) },
   ```
3. ถ้าต้องการเมนูใหม่ ส่งบรรทัดให้คนที่ 1 เพิ่มใน `links` ของ `components/navbar/navbar.ts`

**แก้เฉพาะไฟล์ในโฟลเดอร์ `pages/<ของตัวเอง>/` จะไม่ชนกับใคร**
ส่วน `model/` และ `services/api/` ทำให้ครบแล้ว ถ้าต้องแก้ให้บอกคนที่ 1

## หน้าลูกค้า (`/customers`)

- แสดงรายการ + แบ่งหน้า (10/20/50 ต่อหน้า)
- ค้นหาจากชื่อ/นามสกุล และเบอร์โทร (`GET /customers/search`)
- เพิ่ม / แก้ไข / ลบ (ลบแล้วออเดอร์ที่ยัง pending ของลูกค้าจะหายด้วย; ลบไม่ได้ถ้ามีออเดอร์ที่จัดเข้าแผนเส้นทางแล้ว)
- ค้นลูกค้าในระยะ กม. จากพิกัด (ใช้พิกัดร้านหรือตำแหน่งของฉันได้) เรียงจากใกล้ไปไกล (`GET /customers/nearby`)
- ปุ่ม “จำลองลูกค้า” (`POST /customers/simulate`, 1-200 คน)

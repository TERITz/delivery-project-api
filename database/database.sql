-- ฐานข้อมูลระบบจัดเส้นทางไรเดอร์ (ส่งด่วนมื้อเที่ยง)
-- สร้างตามไฟล์ ER Diagram: Customer, Orders, Route_Plan, Delivery_Job, Job_stop
CREATE DATABASE IF NOT EXISTS lunchrider CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lunchrider;

DROP TABLE IF EXISTS job_stop;
DROP TABLE IF EXISTS delivery_job;
DROP TABLE IF EXISTS route_plan;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customer;

CREATE TABLE customer (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  phone       VARCHAR(20)  NOT NULL UNIQUE,
  address     VARCHAR(255) NULL,
  latitude    DOUBLE NOT NULL,
  longitude   DOUBLE NOT NULL
) ENGINE=InnoDB;

CREATE TABLE orders (
  order_id      INT AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT NOT NULL,
  order_date    DATE NOT NULL,
  box_count     INT NOT NULL,
  order_status  VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / assigned / delivered
  delivery_note VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_box_count CHECK (box_count BETWEEN 1 AND 3),
  FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE CASCADE,
  INDEX idx_order_date (order_date)
) ENGINE=InnoDB;

CREATE TABLE route_plan (
  plan_id           INT AUTO_INCREMENT PRIMARY KEY,
  plan_date         DATE NOT NULL,
  plan_status       VARCHAR(20) NOT NULL DEFAULT 'planned',
  total_distance_km DOUBLE NOT NULL DEFAULT 0,
  total_fuel_cost   DOUBLE NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE delivery_job (
  job_id       INT AUTO_INCREMENT PRIMARY KEY,
  plan_id      INT NOT NULL,
  rider_name   VARCHAR(100) NOT NULL,
  access_code  VARCHAR(10)  NOT NULL UNIQUE,   -- รหัสที่ไรเดอร์ใช้ล็อกอินดูใบงาน
  route_color  VARCHAR(10)  NOT NULL,
  total_boxes  INT NOT NULL,
  distance_km  DOUBLE NOT NULL DEFAULT 0,
  fuel_cost    DOUBLE NOT NULL DEFAULT 0,
  job_status   VARCHAR(20) NOT NULL DEFAULT 'assigned',  -- assigned / in_progress / done
  FOREIGN KEY (plan_id) REFERENCES route_plan(plan_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE job_stop (
  stop_id       INT AUTO_INCREMENT PRIMARY KEY,
  job_id        INT NOT NULL,
  order_id      INT NOT NULL UNIQUE,           -- 1 ออเดอร์ = 1 จุดส่ง
  stop_sequence INT NOT NULL,
  arrival_time  DATETIME NULL,
  is_late       TINYINT(1) NOT NULL DEFAULT 0,
  delivered_at  DATETIME NULL,
  FOREIGN KEY (job_id)   REFERENCES delivery_job(job_id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)     ON DELETE CASCADE
) ENGINE=InnoDB;

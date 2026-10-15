import { createPool } from "mysql2/promise";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const conn = createPool({
  connectionLimit: 3, // บน Vercel ลดลง เพราะหลาย function รันพร้อมกันได้
  host: required("DB_HOST"),
  port: Number(required("DB_PORT")),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  database: required("DB_NAME"),
  dateStrings: true,
  ssl: { rejectUnauthorized: false },
});
import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { router as customers } from "./controller/customer";
import { router as orders } from "./controller/order";
import { router as routes } from "./controller/route";
import { router as jobs } from "./controller/job";

export const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.text());
app.use(express.json());

app.use("/", index);
app.use("/customers", customers);
app.use("/orders", orders);
app.use("/routes", routes);
app.use("/jobs", jobs);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
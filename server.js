// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// -----------------------
// 🔌 SUPABASE CONNECT
// -----------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// -----------------------
// 🚀 EXPRESS INIT
// -----------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// -----------------------
// 📁 STATIC PATH
// -----------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

app.get("/", (req, res) => {
  const indexFile = fs.existsSync(path.join(distPath, "index.html"))
    ? path.join(distPath, "index.html")
    : path.join(__dirname, "index.html");

  res.sendFile(indexFile);
});

// ================================
// 📌 STATUS CHECK
// ================================
app.get("/api/status", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ======================================================
//                 🔥 API ROUTE-LAR
// ======================================================

// ================================
// 📌 1) CREATE/UPSERT ORDER
// ================================
app.post("/api/order", async (req, res) => {
  try {
    const {
      tokenId,
      price,
      sellerAddress,
      buyerAddress,
      seaportOrder,
      orderHash,
      image,
      status = "active",
    } = req.body;

    if (!sellerAddress || !seaportOrder || !orderHash) {
      return res
        .status(400)
        .json({ success: false, error: "Missing sellerAddress, orderHash or seaportOrder" });
    }

    const id = nanoid();
    const now = new Date().toISOString();

    const { error } = await supabase.from("orders").upsert(
      {
        id,
        tokenId: tokenId ? tokenId.toString() : null,
        price: price || null,
        nftContract: process.env.NFT_CONTRACT_ADDRESS,
        marketplaceContract: process.env.SEAPORT_CONTRACT_ADDRESS,
        seller: sellerAddress.toLowerCase(),
        buyerAddress: buyerAddress ? buyerAddress.toLowerCase() : null,
        seaportOrder,
        orderHash,
        onChain: !!buyerAddress,
        status,
        image: image || null,
        createdAt: now,
        updatedAt: now,
      },
      { onConflict: "orderHash" }
    );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/order error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ================================
// 📌 2) GET ACTIVE ORDERS
// ================================
app.get("/api/orders", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(500);

    if (error) throw error;

    res.json({ success: true, orders: data });
  } catch (err) {
    console.error("GET /api/orders error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ================================
// 📌 3) BUY CALLBACK (after Seaport tx)
// ================================
app.post("/api/buy", async (req, res) => {
  try {
    const { orderHash, buyerAddress } = req.body;

    if (!orderHash || !buyerAddress) {
      return res.status(400).json({ success: false, error: "Missing orderHash or buyerAddress" });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({
        onChain: true,
        buyerAddress: buyerAddress.toLowerCase(),
        status: "fulfilled",
        updatedAt: new Date().toISOString(),
      })
      .eq("orderHash", orderHash)
      .select();

    if (error) throw error;

    res.json({ success: true, order: data[0] });
  } catch (err) {
    console.error("POST /api/buy error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 🚀 START SERVER
// ------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Backend ${PORT}-də işləyir`);
});
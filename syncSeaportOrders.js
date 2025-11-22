/**
 * syncSeaportOrders.js — ApeChain On-Chain Seaport Sync (ALL EVENTS)
 * Optimized: Active listings + Fulfilled + Cancelled
 */

import { ethers } from "ethers";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// -----------------------
// ENV
// -----------------------
const BACKEND_URL = process.env.BACKEND_URL;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const SEAPORT_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;
const FROM_BLOCK = process.env.FROM_BLOCK ? parseInt(process.env.FROM_BLOCK) : 0;

if (!BACKEND_URL || !NFT_CONTRACT_ADDRESS || !SEAPORT_CONTRACT_ADDRESS) {
  console.error("❌ Missing env variables");
  process.exit(1);
}

// -------------------- MULTI-RPC --------------------
const RPC_LIST = [
  process.env.APECHAIN_RPC,
  "https://rpc.apechain.com/http",
  "https://apechain.drpc.org",
  "https://33139.rpc.thirdweb.com",
];

let provider = null;
async function initProvider() {
  for (const rpc of RPC_LIST) {
    if (!rpc) continue;
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      console.log("✅ RPC working:", rpc);
      provider = p;
      break;
    } catch (e) {
      console.warn("❌ RPC failed:", rpc, e.message);
    }
  }
  if (!provider) {
    console.error("💀 No RPC available!");
    process.exit(1);
  }
}

// -------------------- SEAPORT ABI --------------------
const seaportABI = [
  "event OrderValidated(bytes32 indexed orderHash,address indexed offerer,address indexed zone,tuple(address token,address conduit,uint256 identifier,uint256 startAmount,uint256 endAmount)[] offer,tuple(address token,address recipient,uint256 identifier,uint256 startAmount,uint256 endAmount)[] consideration)",
  "event OrderFulfilled(bytes32 indexed orderHash,address indexed offerer,address indexed fulfiller,tuple(address token,address conduit,uint256 identifier,uint256 startAmount,uint256 endAmount)[] offer,tuple(address token,address recipient,uint256 identifier,uint256 startAmount,uint256 endAmount)[] consideration)",
  "event OrderCancelled(bytes32 indexed orderHash,address indexed offerer)"
];

let seaportContract;

// -------------------- BACKEND POST --------------------
async function postOrderEvent(payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.log("❌ Backend rejected:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.log("❌ Backend error:", e.message);
    return false;
  }
}

// -------------------- SAFE QUERY FILTER --------------------
async function safeQueryFilter(filter, from, to, retry = 0) {
  try {
    return await seaportContract.queryFilter(filter, from, to);
  } catch(e) {
    if(retry < 3){
      console.warn(`⚠️ Retry #${retry+1} queryFilter:`, e.message);
      await new Promise(r => setTimeout(r, 2000 * (retry+1)));
      return safeQueryFilter(filter, from, to, retry+1);
    }
    throw e;
  }
}

// -------------------- CHUNK QUERY --------------------
const CHUNK = 5000; // RPC limit friendly
async function queryInChunks(callback, from, to) {
  let start = from;
  while (start <= to) {
    const end = Math.min(start + CHUNK, to);
    console.log(`🔍 Chunk scan: ${start} → ${end}`);
    try { await callback(start, end); } catch(e){ console.log("⚠️ Chunk error:", e.message);}
    start = end + 1;
  }
}

// -------------------- MAIN --------------------
let totalActive = 0;
let totalFulfilled = 0;
let totalCancelled = 0;

async function main() {
  console.log("🚀 On-chain Seaport Sync started...");
  await initProvider();
  seaportContract = new ethers.Contract(SEAPORT_CONTRACT_ADDRESS, seaportABI, provider);
  const latestBlock = await provider.getBlockNumber();
  console.log(`🔎 Block range: ${FROM_BLOCK} → ${latestBlock}`);

  // 1) ACTIVE LISTINGS
  await queryInChunks(async (start, end) => {
    const filter = seaportContract.filters.OrderValidated();
    const events = await safeQueryFilter(filter, start, end);

    for(const ev of events){
      const args = ev.args || {};
      const offerItem = args.offer?.[0]; // İlk token
      const considerationItem = args.consideration?.[0];

      const payload = {
        tokenId: offerItem?.identifier?.toString() || null,
        price: considerationItem?.startAmount 
          ? ethers.utils.formatUnits(considerationItem.startAmount, 18) 
          : null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        buyerAddress: null,
        seaportOrder: { orderHash: args.orderHash, parameters: args },
        orderHash: args.orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "active",
        onChainBlock: ev.blockNumber
      };

      if(await postOrderEvent(payload)) totalActive++;
    }
  }, FROM_BLOCK, latestBlock);

  // 2) FULFILLED
  await queryInChunks(async (start, end) => {
    const filter = seaportContract.filters.OrderFulfilled();
    const events = await safeQueryFilter(filter, start, end);

    for(const ev of events){
      const args = ev.args || {};
      const offerItem = args.offer?.[0];
      const considerationItem = args.consideration?.[0];

      const payload = {
        tokenId: offerItem?.identifier?.toString() || null,
        price: considerationItem?.startAmount 
          ? ethers.utils.formatUnits(considerationItem.startAmount, 18) 
          : null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        buyerAddress: args.fulfiller?.toLowerCase() || null,
        seaportOrder: { orderHash: args.orderHash, parameters: args },
        orderHash: args.orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "fulfilled",
        onChainBlock: ev.blockNumber
      };

      if(await postOrderEvent(payload)) totalFulfilled++;
    }
  }, FROM_BLOCK, latestBlock);

  // 3) CANCELLED
  await queryInChunks(async (start, end) => {
    const filter = seaportContract.filters.OrderCancelled();
    const events = await safeQueryFilter(filter, start, end);

    for(const ev of events){
      const args = ev.args || {};
      const payload = {
        tokenId: null,
        price: null,
        sellerAddress: args.offerer?.toLowerCase() || null,
        buyerAddress: null,
        seaportOrder: { orderHash: args.orderHash },
        orderHash: args.orderHash,
        image: null,
        nftContract: NFT_CONTRACT_ADDRESS,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS,
        status: "cancelled",
        onChainBlock: ev.blockNumber
      };

      if(await postOrderEvent(payload)) totalCancelled++;
    }
  }, FROM_BLOCK, latestBlock);

  console.log("🎉 Sync finished!");
  console.log(`🟢 Active: ${totalActive}`);
  console.log(`💰 Fulfilled: ${totalFulfilled}`);
  console.log(`🗑 Cancelled: ${totalCancelled}`);
}

main().catch(err=>{
  console.error("💀 Fatal:", err);
  process.exit(1);
});
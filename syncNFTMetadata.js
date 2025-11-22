// ==================== syncNFTMetadata.js ====================
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fetch from "node-fetch"; // metadata üçün lazım

dotenv.config();

// -----------------------
// 🔌 Supabase Connect
// -----------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -----------------------
// 🔧 ENV
// -----------------------
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const APECHAIN_RPC = process.env.APECHAIN_RPC;

// -----------------------
// 🌐 Provider + Contract
// -----------------------
const provider = new ethers.JsonRpcProvider(APECHAIN_RPC);

const nftABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, nftABI, provider);

// -----------------------
// 🔄 Process NFT
// -----------------------
async function processNFT(tokenId) {
  try {
    const owner = await nftContract.ownerOf(tokenId);
    const tokenURI = await nftContract.tokenURI(tokenId);

    let name = null;
    try {
      const metadataRes = await fetch(tokenURI);
      const metadata = await metadataRes.json();
      name = metadata.name || null;
    } catch (e) {
      console.warn(`⚠️ NFT #${tokenId} metadata fetch error:`, e.message);
    }

    await supabase.from("nfts").upsert({
      token_id: tokenId.toString(),
      nft_contract: NFT_CONTRACT_ADDRESS,
      owner_address: owner.toLowerCase(),
      name
    }, { onConflict: "token_id" });

    console.log(`✅ NFT #${tokenId} saved. Owner: ${owner}, Name: ${name}`);
  } catch (e) {
    console.warn(`❌ NFT #${tokenId} error:`, e.message);
  }
}

// -----------------------
// 🔄 Main Sync
// -----------------------
async function main() {
  try {
    const totalSupply = await nftContract.totalSupply();
    console.log(`🚀 Total NFTs: ${totalSupply}`);

    const BATCH_SIZE = 20; // paralel RPC çağırışları
    for (let i = 0; i < totalSupply; i += BATCH_SIZE) {
      const batch = Array.from({ length: BATCH_SIZE }, (_, j) => i + j).filter(id => id < totalSupply);
      await Promise.allSettled(batch.map(tokenId => processNFT(tokenId)));
    }

    console.log("🎉 NFT owners + names sync tamamlandı!");
  } catch (err) {
    console.error("💀 Fatal error:", err.message);
    process.exit(1);
  }
}

main();

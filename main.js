// ==================== main.js ====================
import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ---------------- ENV ----------------
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT;
const SEAPORT_CONTRACT_ADDRESS = import.meta.env.VITE_SEAPORT_CONTRACT;

// ApeChain
const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

// ---------------- Global State ----------------
let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let currentPage = 1;
const PAGE_SIZE = 12;

// ---------------- UI Elements ----------------
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// ---------------- Utils ----------------
function notify(msg, timeout = 3500) {
  noticeDiv.textContent = msg;
  if (timeout) {
    setTimeout(() => {
      if (noticeDiv.textContent === msg) noticeDiv.textContent = "";
    }, timeout);
  }
}

function parseOrderPrice(o) {
  try {
    const so =
      o.seaportOrder ||
      o.seaportorder ||
      o.seaport_order ||
      (o.seaportOrderJSON ? JSON.parse(o.seaportOrderJSON) : null);

    const params = so?.parameters || so?.order || so;
    const cons = params?.consideration;

    if (cons?.length > 0) {
      let amount = cons[0].endAmount ?? cons[0].startAmount ?? cons[0].amount;
      if (amount) {
        amount = amount.toString();
        return ethers.utils.formatEther(amount);
      }
    }
  } catch {}
  return null;
}

// ---------------- Wallet Connect ----------------
async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");

    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await provider.send("wallet_addEthereumChain", [{
          chainId: APECHAIN_ID_HEX,
          chainName: "ApeChain Mainnet",
          nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
          rpcUrls: ["https://rpc.apechain.com"],
          blockExplorerUrls: ["https://apescan.io"]
        }]);
        notify("Şəbəkə əlavə edildi, yenidən qoşun.");
        return;
      } catch (e) {
        console.error(e);
      }
    }

    seaport = new Seaport(signer, { contractAddress: SEAPORT_CONTRACT_ADDRESS });

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = userAddress.slice(0, 6) + "..." + userAddress.slice(-4);

    loadOrders(currentPage);
  } catch (err) {
    console.error(err);
    alert("Wallet connect xətası!");
  }
}

// disconnect
disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;

  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";

  notify("Cüzdan ayırıldı", 2000);
};

connectBtn.onclick = connectWallet;

// ---------------- Pagination ----------------
prevBtn.onclick = () => {
  if (currentPage > 1) {
    currentPage--;
    loadOrders(currentPage);
  }
};
nextBtn.onclick = () => {
  currentPage++;
  loadOrders(currentPage);
};

// ---------------- Load Marketplace Orders ----------------
async function loadOrders(page = 1) {
  try {
    pageIndicator.textContent = page;
    marketplaceDiv.innerHTML = "<p style='opacity:.7'>Yüklənir...</p>";

    const res = await fetch(`${BACKEND_URL}/api/orders?page=${page}&limit=${PAGE_SIZE}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      marketplaceDiv.innerHTML = "<p>Server məlumat qaytarmadı.</p>";
      return;
    }

    const orders = data.orders || [];
    if (orders.length === 0) {
      marketplaceDiv.innerHTML = "<p>Bu səhifədə NFT yoxdur.</p>";
      return;
    }

    marketplaceDiv.innerHTML = "";

    for (const o of orders) {
      const tokenId = o.tokenId;
      const price = o.price ?? parseOrderPrice(o);
      const image =
        o.image ??
        o?.metadata?.image ??
        "https://ipfs.io/ipfs/QmExampleNFTImage/default.png";

      const card = document.createElement("div");
      card.className = "nft-card";

      card.innerHTML = `
        <img src="${image}" alt="NFT image"
          onerror="this.src='https://ipfs.io/ipfs/QmExampleNFTImage/default.png'">

        <h4>Bear #${tokenId}</h4>
        <p class="price">Qiymət: ${price} APE</p>

        <div class="nft-actions">
          <button class="wallet-btn buy-btn" data-id="${o.id}">Buy</button>
          <button class="wallet-btn list-btn" data-token="${tokenId}">List</button>
        </div>
      `;

      marketplaceDiv.appendChild(card);

      // Buy
      card.querySelector(".buy-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        await buyNFT(o).catch(console.error);
        ev.target.disabled = false;
      };

      // List
      card.querySelector(".list-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        await listNFT(tokenId).catch(console.error);
        ev.target.disabled = false;
      };
    }
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p>Xəta baş verdi.</p>";
  }
}

// ---------------- BUY NFT ----------------
async function buyNFT(orderRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");

  notify("Alış hazırlanır...");

  const rawOrder =
    orderRecord.seaportOrder ||
    orderRecord.seaportorder ||
    orderRecord.seaport_order ||
    JSON.parse(orderRecord.seaportOrderJSON);

  if (!rawOrder) return alert("Order boşdur!");

  try {
    const buyer = await signer.getAddress();

    notify("Transaction göndərilir...");

    const result = await seaport.fulfillOrder({
      order: rawOrder,
      accountAddress: buyer
    });

    const executeTx = result.executeAllActions || result.execute;
    const tx = await executeTx();
    await tx.wait();

    notify("NFT alındı! ✅");

    // Backendə xəbər ver
    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderHash: orderRecord.orderHash,
        buyerAddress: buyer
      })
    });

    loadOrders(currentPage);
  } catch (err) {
    console.error(err);
    alert("Buy xətası: " + err.message);
  }
}

// ---------------- LIST NFT ----------------
async function listNFT(tokenId) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");

  const seller = await signer.getAddress();

  const nftContract = new ethers.Contract(
    NFT_CONTRACT_ADDRESS,
    [
      "function ownerOf(uint256) view returns (address)",
      "function isApprovedForAll(address owner, address operator) view returns (bool)",
      "function setApprovalForAll(address operator, bool approved)"
    ],
    signer
  );

  notify("Sahiblik yoxlanılır...");

  const owner = (await nftContract.ownerOf(tokenId)).toLowerCase();
  if (owner !== seller.toLowerCase()) {
    return alert("Bu NFT sənin deyil!");
  }

  let price = prompt("NFT neçə APE? (məs: 1.5)");
  if (!price || isNaN(price)) return notify("Listing ləğv edildi.");

  const priceWei = ethers.utils.parseEther(price);

  // Approval
  const approved = await nftContract.isApprovedForAll(
    seller,
    SEAPORT_CONTRACT_ADDRESS
  );
  if (!approved) {
    notify("Approve göndərilir...");
    const tx = await nftContract.setApprovalForAll(
      SEAPORT_CONTRACT_ADDRESS,
      true
    );
    await tx.wait();
  }

  notify("Seaport order yaradılır...");

  const createReq = {
    offer: [
      {
        itemType: 2, // ERC721
        token: NFT_CONTRACT_ADDRESS,
        identifier: tokenId.toString()
      }
    ],
    consideration: [
      {
        amount: priceWei.toString(),
        recipient: seller
      }
    ],
    endTime: Math.floor(Date.now() / 1000 + 86400 * 30).toString()
  };

  const orderResult = await seaport.createOrder(createReq, seller);
  const exec = orderResult.executeAllActions || orderResult.execute;
  const signed = await exec();

  const signedOrder = signed.order || signed;
  const orderHash =
    signedOrder.orderHash ??
    signed.orderHash ??
    null;

  notify("Order backend-ə göndərilir...");

  const res = await fetch(`${BACKEND_URL}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId,
      price: Number(price),
      sellerAddress: seller,
      seaportOrder: signedOrder,
      orderHash,
      image: null
    })
  });

  const j = await res.json();
  if (!j.success) return alert("Backend order-u qəbul etmədi!");

  notify(`NFT #${tokenId} list olundu — ${price} APE`);
  loadOrders(currentPage);
}

// Expose to window (HTML üçün lazımdır)
window.buyNFT = buyNFT;
window.listNFT = listNFT;
window.loadOrders = loadOrders;
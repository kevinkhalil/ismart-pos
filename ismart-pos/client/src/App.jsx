import { useState, useEffect, useCallback } from "react";
import "./App.css";

const API = "http://localhost:3000";

export default function App() {
  const [view, setView]         = useState("pos");
  const [products, setProducts] = useState([]);

  const loadProducts = useCallback(() => {
    fetch(`${API}/api/products`)
      .then(r => r.json())
      .then(setProducts);
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const lowStockCount = products.filter(p =>
    p.isSerialized ? p.units.length === 0 : p.quantity <= 5
  ).length;

  return (
    <div className="pos">
      <header className="pos-header">
        <h1>iSmart POS</h1>
        <nav className="tabs">
          <button className={`tab ${view === "dashboard"  ? "active" : ""}`} onClick={() => setView("dashboard")}>Dashboard</button>
          <button className={`tab ${view === "pos"        ? "active" : ""}`} onClick={() => setView("pos")}>POS</button>
          <button className={`tab ${view === "inventory"  ? "active" : ""}`} onClick={() => setView("inventory")}>
            Inventory{lowStockCount > 0 && <span className="nav-badge">{lowStockCount}</span>}
          </button>
          <button className={`tab ${view === "sales"      ? "active" : ""}`} onClick={() => setView("sales")}>Sales</button>
          <button className={`tab ${view === "customers"  ? "active" : ""}`} onClick={() => setView("customers")}>Customers</button>
        </nav>
      </header>

      {view === "dashboard"  && <DashboardView />}
      {view === "pos"        && <POSView       products={products} onSaleComplete={loadProducts} />}
      {view === "inventory"  && <InventoryView products={products} onStockUpdated={loadProducts} />}
      {view === "sales"      && <SalesView onRefund={loadProducts} />}
      {view === "customers"  && <CustomersView />}
    </div>
  );
}

// ─── Dashboard View ──────────────────────────────────────────────────────────

function DashboardView() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch(`${API}/api/dashboard`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="dashboard-view"><p className="dashboard-empty">Loading…</p></div>;

  const { today, allTime, lowStock, topProducts } = data;

  const todayProfit   = today.revenue   - (today.cost   ?? 0);
  const allTimeProfit = allTime.revenue - (allTime.cost ?? 0);
  const todayMargin   = today.revenue   > 0 ? (todayProfit   / today.revenue)   * 100 : null;
  const allTimeMargin = allTime.revenue > 0 ? (allTimeProfit / allTime.revenue) * 100 : null;

  return (
    <div className="dashboard-view">

      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <div className="stat-card highlight">
          <span className="stat-label">Today's Revenue</span>
          <span className="stat-value">${today.revenue.toFixed(2)}</span>
          {today.revenue > 0 && (
            <span className="stat-profit">
              Profit ${todayProfit.toFixed(2)}{todayMargin !== null && ` · ${todayMargin.toFixed(1)}%`}
            </span>
          )}
        </div>
        <div className="stat-card highlight">
          <span className="stat-label">Sales Today</span>
          <span className="stat-value">{today.sales}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">All-Time Revenue</span>
          <span className="stat-value">${allTime.revenue.toFixed(2)}</span>
          {allTime.revenue > 0 && (
            <span className="stat-profit">
              Profit ${allTimeProfit.toFixed(2)}{allTimeMargin !== null && ` · ${allTimeMargin.toFixed(1)}%`}
            </span>
          )}
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Sales</span>
          <span className="stat-value">{allTime.sales}</span>
        </div>
      </div>

      {/* ── Payment split ── */}
      {(today.revenue > 0 || allTime.revenue > 0) && (
        <div className="payment-split-row">
          <div className="payment-split-card">
            <span className="payment-split-label">Today</span>
            <div className="payment-split-amounts">
              <span className="payment-split-cash">Cash ${(today.payment?.cash ?? 0).toFixed(2)}</span>
              <span className="payment-split-card">Card ${(today.payment?.card ?? 0).toFixed(2)}</span>
            </div>
          </div>
          <div className="payment-split-card">
            <span className="payment-split-label">All Time</span>
            <div className="payment-split-amounts">
              <span className="payment-split-cash">Cash ${(allTime.payment?.cash ?? 0).toFixed(2)}</span>
              <span className="payment-split-card">Card ${(allTime.payment?.card ?? 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom panels ── */}
      <div className="dashboard-panels">

        {/* Low stock warnings */}
        <div className="dashboard-card">
          <h3 className="dashboard-card-title">Low Stock Warnings</h3>
          {lowStock.length === 0 ? (
            <p className="dashboard-empty">All products are well stocked.</p>
          ) : (
            <ul className="low-stock-list">
              {lowStock.map(p => (
                <li key={p.id} className="low-stock-item">
                  <span className="low-stock-name">{p.name}</span>
                  {p.quantity === 0
                    ? <span className="stock-badge out">Out of stock</span>
                    : <span className="stock-badge low">{p.quantity} left</span>
                  }
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top products by revenue */}
        <div className="dashboard-card">
          <h3 className="dashboard-card-title">Top Products by Revenue</h3>
          {topProducts.length === 0 ? (
            <p className="dashboard-empty">No sales recorded yet.</p>
          ) : (
            <ul className="top-products-list">
              {topProducts.map((p, i) => (
                <li key={p.name} className="top-product-item">
                  <span className="top-product-rank">#{i + 1}</span>
                  <span className="top-product-name">{p.name}</span>
                  <div className="top-product-stats">
                    <span className="top-product-revenue">${p.revenue.toFixed(2)}</span>
                    <span className="top-product-units">{p.unitsSold} sold</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}

const COUNTRY_CODES = [
  { name: "Lebanon",        dial: "+961" },
  { name: "United States",  dial: "+1"   },
  { name: "Canada",         dial: "+1"   },
  { name: "United Kingdom", dial: "+44"  },
  { name: "France",         dial: "+33"  },
  { name: "Germany",        dial: "+49"  },
  { name: "UAE",            dial: "+971" },
  { name: "Saudi Arabia",   dial: "+966" },
  { name: "Kuwait",         dial: "+965" },
  { name: "Qatar",          dial: "+974" },
  { name: "Bahrain",        dial: "+973" },
  { name: "Jordan",         dial: "+962" },
  { name: "Egypt",          dial: "+20"  },
  { name: "Turkey",         dial: "+90"  },
  { name: "India",          dial: "+91"  },
  { name: "Australia",      dial: "+61"  },
  { name: "Nigeria",        dial: "+234" },
  { name: "Brazil",         dial: "+55"  },
  { name: "Mexico",         dial: "+52"  },
  { name: "China",          dial: "+86"  },
];

// ─── POS View ────────────────────────────────────────────────────────────────

function POSView({ products, onSaleComplete }) {
  const [cart, setCart]             = useState([]);
  const [customer, setCustomer]     = useState({ name: "", phone: "", email: "" });
  const [countryCode, setCountryCode] = useState("+961");
  const [returning, setReturning]   = useState(null);
  const [lastSale, setLastSale]     = useState(null);
  const [saleError, setSaleError]   = useState(null);
  const [loading, setLoading]         = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [barcodeVal, setBarcodeVal]   = useState("");
  const [scanMsg, setScanMsg]         = useState(null);
  const [categories, setCategories]   = useState([]);
  const [selectedParentId, setSelectedParentId] = useState(null);
  const [selectedSubId, setSelectedSubId]       = useState(null);

  useEffect(() => {
    fetch(`${API}/api/categories`).then(r => r.json()).then(setCategories);
  }, []);

  const fullPhone = customer.phone ? `${countryCode}${customer.phone}` : "";

  function handlePhoneChange(value) {
    setReturning(null);
    if (!value) {
      setCustomer({ name: "", phone: "", email: "" });
    } else {
      setCustomer(p => ({ ...p, phone: value }));
    }
  }

  // Auto-lookup customer by full phone (country code + number) as cashier types
  useEffect(() => {
    if (!fullPhone || customer.phone.length < 6) { setReturning(null); return; }
    const timer = setTimeout(async () => {
      const res   = await fetch(`${API}/api/customers/lookup?phone=${encodeURIComponent(fullPhone)}`);
      const found = await res.json();
      if (found) {
        setReturning(found);
        setCustomer(p => ({ phone: p.phone, name: found.name, email: found.email || "" }));
      } else {
        setReturning(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [fullPhone]);

  function addToCart(product) {
    setLastSale(null);
    setSaleError(null);

    if (product.isSerialized) {
      const usedUnitIds = new Set(cart.filter(i => i.unit).map(i => i.unit.id));
      const unit = product.units.find(u => !usedUnitIds.has(u.id));
      if (!unit) return;
      setCart(prev => [...prev, { product, unit, quantity: 1 }]);
    } else {
      setCart(prev => {
        const idx = prev.findIndex(i => !i.unit && i.product.id === product.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
          return next;
        }
        return [...prev, { product, unit: null, quantity: 1 }];
      });
    }
  }

  function removeFromCart(idx) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  function handleScan(e) {
    if (e.key !== "Enter") return;
    const upc = barcodeVal.trim();
    setBarcodeVal("");
    if (!upc) return;
    const product = products.find(p => p.upc && p.upc === upc);
    if (!product) {
      setScanMsg({ type: "error", text: `No product found for barcode: ${upc}` });
      setTimeout(() => setScanMsg(null), 2500);
      return;
    }
    addToCart(product);
    setScanMsg({ type: "ok", text: `Added: ${product.name}` });
    setTimeout(() => setScanMsg(null), 1500);
  }

  const total = cart.reduce((sum, i) => sum + i.product.sellPrice * i.quantity, 0);

  async function completeSale() {
    setSaleError(null);
    setLoading(true);

    const items = cart.map(i =>
      i.unit
        ? { productId: i.product.id, productUnitId: i.unit.id }
        : { productId: i.product.id, quantity: i.quantity }
    );

    // Only send customer if at least a name or phone was entered
    const customerPayload = (customer.name || fullPhone)
      ? { name: customer.name, phone: fullPhone || undefined, email: customer.email || undefined }
      : undefined;

    try {
      const res  = await fetch(`${API}/api/sales`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ items, customer: customerPayload, paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLastSale(data);
      setCart([]);
      setCustomer({ name: "", phone: "", email: "" });
      setReturning(null);
      setPaymentMethod("cash");
      onSaleComplete();
    } catch (err) {
      setSaleError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const cartUnitIds = new Set(cart.filter(i => i.unit).map(i => i.unit.id));
  const cartQtyById = {};
  for (const i of cart) {
    if (!i.unit) cartQtyById[i.product.id] = (cartQtyById[i.product.id] ?? 0) + i.quantity;
  }

  const [search, setSearch] = useState("");

  const parentCategories = categories.filter(c => !c.parentId);
  const selectedParent   = selectedParentId !== null ? categories.find(c => c.id === selectedParentId) : null;
  const subCategories    = selectedParent?.children || [];

  const visibleProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    let matchesCat = true;
    if (selectedParentId !== null) {
      const validIds = new Set([selectedParentId, ...subCategories.map(c => c.id)]);
      matchesCat = selectedSubId !== null
        ? p.categoryId === selectedSubId
        : p.categoryId !== null && validIds.has(p.categoryId);
    }
    return matchesSearch && matchesCat;
  });

  return (
    <main className="pos-main">
      {/* ── Products ── */}
      <section className="panel products-panel">
        <div className="products-header">
          <h2>Products</h2>
          <input
            className="product-search"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="scan-bar">
          <input
            className="scan-input"
            placeholder="Scan barcode here…"
            value={barcodeVal}
            onChange={e => setBarcodeVal(e.target.value)}
            onKeyDown={handleScan}
          />
          {scanMsg && (
            <span className={`scan-msg ${scanMsg.type}`}>{scanMsg.text}</span>
          )}
        </div>
        {parentCategories.length > 0 && (
          <div className="category-chips">
            <button className={`cat-chip ${selectedParentId === null ? "active" : ""}`} onClick={() => { setSelectedParentId(null); setSelectedSubId(null); }}>All</button>
            {parentCategories.map(c => (
              <button key={c.id} className={`cat-chip ${selectedParentId === c.id ? "active" : ""}`} onClick={() => { setSelectedParentId(c.id); setSelectedSubId(null); }}>{c.name}</button>
            ))}
          </div>
        )}
        {subCategories.length > 0 && (
          <div className="category-chips sub-chips">
            <button className={`cat-chip sub ${selectedSubId === null ? "active" : ""}`} onClick={() => setSelectedSubId(null)}>All</button>
            {subCategories.map(c => (
              <button key={c.id} className={`cat-chip sub ${selectedSubId === c.id ? "active" : ""}`} onClick={() => setSelectedSubId(c.id)}>{c.name}</button>
            ))}
          </div>
        )}
        <ul className="product-list">
          {visibleProducts.map(product => {
            let canAdd, stockLabel;
            if (product.isSerialized) {
              const available = product.units.filter(u => !cartUnitIds.has(u.id));
              canAdd     = available.length > 0;
              stockLabel = `${available.length} in stock`;
            } else {
              const inCart = cartQtyById[product.id] ?? 0;
              canAdd       = product.quantity > inCart;
              stockLabel   = `${product.quantity - inCart} in stock`;
            }
            return (
              <li key={product.id} className="product-card">
                <div className="product-info">
                  <span className="product-name">{product.name}</span>
                  <span className="product-stock">{stockLabel}</span>
                </div>
                <div className="product-right">
                  <span className="product-price">${product.sellPrice}</span>
                  <button className="btn-add" onClick={() => addToCart(product)} disabled={!canAdd}>Add</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <ReceiptModal sale={lastSale} onClose={() => setLastSale(null)} />

      {/* ── Cart ── */}
      <section className="panel cart-panel">
        <h2>Cart</h2>

        {/* Customer lookup — always visible so cashier can enter phone first */}
        <div className="customer-section">
          <div className="customer-section-header">
            <h3>Customer — optional</h3>
            {returning && <span className="returning-badge">✓ Returning customer</span>}
          </div>
          <div className="phone-row">
            <select
              className="country-code-select"
              value={countryCode}
              onChange={e => setCountryCode(e.target.value)}
            >
              {COUNTRY_CODES.map((c, i) => (
                <option key={i} value={c.dial}>{c.dial} {c.name}</option>
              ))}
            </select>
            <input
              className="phone-input"
              placeholder="Phone number"
              value={customer.phone}
              onChange={e => handlePhoneChange(e.target.value)}
            />
          </div>
          <div className="customer-row">
            <input
              placeholder="Name"
              value={customer.name}
              onChange={e => setCustomer(p => ({ ...p, name: e.target.value }))}
            />
            <input
              placeholder="Email — optional"
              value={customer.email}
              onChange={e => setCustomer(p => ({ ...p, email: e.target.value }))}
            />
          </div>
        </div>

        {saleError && <div className="sale-error">{saleError}</div>}

        {cart.length === 0 ? (
          <p className="cart-empty">Cart is empty — add products from the left</p>
        ) : (
          <>
            <ul className="cart-list">
              {cart.map((item, idx) => (
                <li key={idx} className="cart-item">
                  <div className="cart-item-info">
                    <span className="cart-item-name">{item.product.name}</span>
                    {item.unit && <span className="cart-item-imei">IMEI {item.unit.imei}</span>}
                  </div>
                  <div className="cart-item-right">
                    <span className="cart-item-price">
                      {item.quantity > 1 && `${item.quantity} × `}
                      ${(item.product.sellPrice * item.quantity).toFixed(2)}
                    </span>
                    <button className="btn-remove" onClick={() => removeFromCart(idx)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="cart-total">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>

            <div className="payment-toggle">
              <button className={paymentMethod === "cash" ? "active" : ""} onClick={() => setPaymentMethod("cash")}>Cash</button>
              <button className={paymentMethod === "card" ? "active" : ""} onClick={() => setPaymentMethod("card")}>Card</button>
            </div>

            <button className="btn-checkout" onClick={completeSale} disabled={loading}>
              {loading ? "Processing…" : `Complete Sale · ${paymentMethod === "cash" ? "Cash" : "Card"}`}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function ReceiptModal({ sale, onClose }) {
  if (!sale) return null;

  const date = new Date(sale.createdAt).toLocaleString([], {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="receipt-overlay" onClick={onClose}>
      <div className="receipt-modal" onClick={e => e.stopPropagation()}>
        <div className="receipt-paper" id="receipt-paper">
          <div className="receipt-shop-name">iSmart</div>
          <div className="receipt-shop-sub">Smartphone Shop</div>
          <div className="receipt-dashes" />
          <div className="receipt-meta-row">
            <span>Receipt #{sale.id}</span>
            <span>{date}</span>
          </div>
          {sale.customer && (
            <div className="receipt-customer-info">
              <span>{sale.customer.name}</span>
              {sale.customer.phone && <span className="receipt-phone">{sale.customer.phone}</span>}
            </div>
          )}
          <div className="receipt-dashes" />
          <ul className="receipt-items-list">
            {sale.items.map(item => (
              <li key={item.id} className="receipt-line">
                <div className="receipt-line-left">
                  <span className="receipt-line-name">{item.product?.name || "Item"}</span>
                  {item.quantity > 1 && <span className="receipt-qty"> ×{item.quantity}</span>}
                  {item.unit && <div className="receipt-imei">IMEI {item.unit.imei}</div>}
                </div>
                <span className="receipt-line-price">${(item.unitPrice * item.quantity).toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="receipt-dashes" />
          <div className="receipt-total-row">
            <span>Total</span>
            <span>${sale.totalPrice.toFixed(2)}</span>
          </div>
          <div className="receipt-payment-method">
            Paid by {sale.paymentMethod === "card" ? "Card" : "Cash"}
          </div>
          <div className="receipt-thank-you">Thank you for your purchase!</div>
        </div>
        <div className="receipt-buttons no-print">
          <button className="btn-print-receipt" onClick={() => window.print()}>Print</button>
          <button className="btn-close-receipt" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Inventory View ───────────────────────────────────────────────────────────

function InventoryView({ products, onStockUpdated }) {
  const [categories, setCategories] = useState([]);

  function loadCategories() {
    fetch(`${API}/api/categories`).then(r => r.json()).then(setCategories);
  }

  useEffect(() => { loadCategories(); }, []);

  return (
    <div className="inventory-view">
      <NewProductForm    onStockUpdated={onStockUpdated} categories={categories} />
      <AddStockForm      products={products} onStockUpdated={onStockUpdated} />
      <EditProductForm   products={products} onStockUpdated={onStockUpdated} categories={categories} />
      <CategoryManager   categories={categories} onChanged={() => { loadCategories(); onStockUpdated(); }} />
    </div>
  );
}

function NewProductForm({ onStockUpdated, categories }) {
  const blank = { name: "", sellPrice: "", costPrice: "", upc: "", isSerialized: false, quantity: "", imei: "", categoryId: "" };
  const [form, setForm]       = useState(blank);
  const [success, setSuccess] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setSuccess(""); setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    try {
      const res     = await fetch(`${API}/api/products`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: form.name, sellPrice: form.sellPrice, costPrice: form.costPrice, upc: form.upc, isSerialized: form.isSerialized, quantity: form.quantity, categoryId: form.categoryId || null }),
      });
      const product = await res.json();
      if (!res.ok) throw new Error(product.error);

      if (form.isSerialized && form.imei) {
        const unitRes = await fetch(`${API}/api/products/${product.id}/units`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ imei: form.imei, costPrice: form.costPrice }),
        });
        const unit = await unitRes.json();
        if (!unitRes.ok) throw new Error(unit.error);
      }

      setSuccess(`"${product.name}" added successfully`);
      setForm(blank);
      onStockUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Add New Product</h2>
      {success && <div className="form-success">{success}</div>}
      {error   && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Product name</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. iPhone 16 Pro" required />
        </div>
        <div className="form-group">
          <label>Type</label>
          <div className="type-toggle">
            <button type="button" className={!form.isSerialized ? "active" : ""} onClick={() => set("isSerialized", false)}>Accessory</button>
            <button type="button" className={ form.isSerialized ? "active" : ""} onClick={() => set("isSerialized", true)}>Phone (serialized)</button>
          </div>
        </div>
        <div className="form-group">
          <label>Sell price ($)</label>
          <input type="number" min="0" step="0.01" value={form.sellPrice} onChange={e => set("sellPrice", e.target.value)} placeholder="0.00" required />
        </div>
        <div className="form-group">
          <label>Cost price ($) — optional</label>
          <input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => set("costPrice", e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-group">
          <label>UPC / Barcode — optional</label>
          <input value={form.upc} onChange={e => set("upc", e.target.value)} placeholder="012345678901" />
        </div>
        {form.isSerialized ? (
          <div className="form-group">
            <label>First IMEI — optional</label>
            <input value={form.imei} onChange={e => set("imei", e.target.value)} placeholder="15-digit IMEI" />
          </div>
        ) : (
          <div className="form-group">
            <label>Opening stock quantity</label>
            <input type="number" min="0" value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="0" />
          </div>
        )}
        {categories.length > 0 && (
          <div className="form-group">
            <label>Category — optional</label>
            <select value={form.categoryId} onChange={e => set("categoryId", e.target.value)}>
              <option value="">No category</option>
              {categories.map(c => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name}</option>
                  {c.children.map(sub => (
                    <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <button className="btn-submit" disabled={loading}>{loading ? "Saving…" : "Add Product"}</button>
      </form>
    </div>
  );
}

function AddStockForm({ products, onStockUpdated }) {
  const [productId, setProductId] = useState("");
  const [imei, setImei]           = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [quantity, setQuantity]   = useState("");
  const [success, setSuccess]     = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  const selected = products.find(p => p.id === parseInt(productId));

  function reset() { setImei(""); setCostPrice(""); setQuantity(""); setSuccess(""); setError(""); }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    try {
      if (selected.isSerialized) {
        const res  = await fetch(`${API}/api/products/${selected.id}/units`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imei, costPrice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSuccess(`IMEI ${data.imei} added to ${selected.name}`);
      } else {
        const res  = await fetch(`${API}/api/products/${selected.id}/stock`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSuccess(`${selected.name} stock updated — now ${data.quantity} in stock`);
      }
      reset();
      onStockUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Add Stock to Existing Product</h2>
      {success && <div className="form-success">{success}</div>}
      {error   && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Product</label>
          <select value={productId} onChange={e => { setProductId(e.target.value); reset(); }} required>
            <option value="">Select a product…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {selected?.isSerialized ? (
          <>
            <div className="form-group">
              <label>IMEI</label>
              <input value={imei} onChange={e => setImei(e.target.value)} placeholder="15-digit IMEI" required />
            </div>
            <div className="form-group">
              <label>Cost price ($) — optional</label>
              <input type="number" min="0" step="0.01" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="0.00" />
            </div>
          </>
        ) : selected ? (
          <div className="form-group">
            <label>Quantity to add</label>
            <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 10" required />
          </div>
        ) : null}
        <button className="btn-submit" disabled={!selected || loading}>
          {loading ? "Saving…" : selected?.isSerialized ? "Add Unit" : "Add Stock"}
        </button>
      </form>
    </div>
  );
}

function EditProductForm({ products, onStockUpdated, categories }) {
  const [productId, setProductId] = useState("");
  const [form, setForm]           = useState({ name: "", sellPrice: "", costPrice: "", upc: "", categoryId: "" });
  const [success, setSuccess]     = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  const selected = products.find(p => p.id === parseInt(productId));

  function handleSelect(id) {
    setProductId(id);
    setSuccess(""); setError("");
    const p = products.find(p => p.id === parseInt(id));
    if (p) setForm({ name: p.name, sellPrice: p.sellPrice, costPrice: p.costPrice, upc: p.upc || "", categoryId: p.categoryId || "" });
    else   setForm({ name: "", sellPrice: "", costPrice: "", upc: "" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    try {
      const res  = await fetch(`${API}/api/products/${selected.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`"${data.name}" updated successfully`);
      onStockUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card inventory-edit-card">
      <h2>Edit Product</h2>
      {success && <div className="form-success">{success}</div>}
      {error   && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Product</label>
          <select value={productId} onChange={e => handleSelect(e.target.value)} required>
            <option value="">Select a product…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {selected && (
          <>
            <div className="edit-product-row">
              <div className="form-group">
                <label>Name</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Sell price ($)</label>
                <input type="number" min="0" step="0.01" value={form.sellPrice} onChange={e => setForm(p => ({ ...p, sellPrice: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Cost price ($)</label>
                <input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => setForm(p => ({ ...p, costPrice: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>UPC / Barcode</label>
                <input value={form.upc} onChange={e => setForm(p => ({ ...p, upc: e.target.value }))} placeholder="optional" />
              </div>
            </div>
            {categories.length > 0 && (
              <div className="form-group">
                <label>Category</label>
                <select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}>
                  <option value="">No category</option>
                  {categories.map(c => (
                    <optgroup key={c.id} label={c.name}>
                      <option value={c.id}>{c.name}</option>
                      {c.children.map(sub => (
                        <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
            <button className="btn-submit" disabled={loading}>{loading ? "Saving…" : "Save Changes"}</button>
          </>
        )}
      </form>
    </div>
  );
}

function CategoryManager({ categories, onChanged }) {
  const [name, setName]       = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const parents = categories.filter(c => !c.parentId);

  async function handleAdd(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API}/api/categories`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: parentId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setName(""); setParentId("");
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    await fetch(`${API}/api/categories/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="card inventory-edit-card">
      <h2>Manage Categories</h2>
      {error && <div className="form-error">{error}</div>}
      <div className="category-manager">
        <form className="category-add-form" onSubmit={handleAdd}>
          <div className="form-group">
            <label>Category name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smartphones" required />
          </div>
          <div className="form-group">
            <label>Parent category — optional</label>
            <select value={parentId} onChange={e => setParentId(e.target.value)}>
              <option value="">Top-level category</option>
              {parents.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button className="btn-submit" disabled={loading}>{loading ? "Adding…" : "Add Category"}</button>
        </form>

        <div className="category-tree">
          {categories.length === 0 && <p className="category-empty">No categories yet.</p>}
          {parents.map(c => (
            <div key={c.id} className="cat-group">
              <div className="cat-row">
                <span className="cat-name">{c.name}</span>
                <button className="btn-cat-delete" onClick={() => handleDelete(c.id)}>✕</button>
              </div>
              {c.children.map(sub => (
                <div key={sub.id} className="cat-row sub">
                  <span className="cat-name">↳ {sub.name}</span>
                  <button className="btn-cat-delete" onClick={() => handleDelete(sub.id)}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Customers View ──────────────────────────────────────────────────────────

function CustomersView() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState(null);
  const [editing, setEditing]         = useState(null);
  const [editForm, setEditForm]       = useState({ name: "", phone: "", email: "" });
  const [editError, setEditError]     = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [loading, setLoading]     = useState(true);

  function load() {
    fetch(`${API}/api/customers`)
      .then(r => r.json())
      .then(data => { setCustomers(data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  function startEdit(c, e) {
    e.stopPropagation();
    setEditing(c.id);
    setEditForm({ name: c.name, phone: c.phone || "", email: c.email || "" });
    setEditError("");
  }

  function cancelEdit(e) {
    e.stopPropagation();
    setEditing(null);
    setEditError("");
  }

  async function deleteCustomer(id, e) {
    e.stopPropagation();
    try {
      const res  = await fetch(`${API}/api/customers/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmDelete(null);
      load();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  async function saveEdit(id, e) {
    e.stopPropagation();
    setEditLoading(true);
    setEditError("");
    try {
      const res  = await fetch(`${API}/api/customers/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // Filter by name, phone, or email as the cashier types
  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q)  ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="customers-view">
      <div className="customers-header">
        <h2>Customers — {customers.length} total</h2>
        <input
          className="customer-search"
          placeholder="Search by name, phone, or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading && <p className="customers-empty">Loading…</p>}
      {!loading && customers.length === 0 && (
        <p className="customers-empty">No customers yet — they appear here after their first purchase.</p>
      )}
      {!loading && customers.length > 0 && filtered.length === 0 && (
        <p className="customers-empty">No customers match "{search}".</p>
      )}

      <ul className="customers-list">
        {filtered.map(c => (
          <li key={c.id} className="customer-card">
            <div className="customer-card-header" onClick={() => toggleExpand(c.id)}>
              <div className="customer-avatar">{c.name.charAt(0).toUpperCase()}</div>

              <div className="customer-main">
                <span className="customer-name">{c.name}</span>
                <span className="customer-contact">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                </span>
              </div>

              <div className="customer-stats">
                <div className="customer-stat">
                  <span className="customer-stat-value">${c.totalSpent.toFixed(2)}</span>
                  <span className="customer-stat-label">Total spent</span>
                </div>
                <div className="customer-stat">
                  <span className="customer-stat-value">{c.totalSales}</span>
                  <span className="customer-stat-label">{c.totalSales === 1 ? "purchase" : "purchases"}</span>
                </div>
                <div className="customer-stat">
                  <span className="customer-stat-value">
                    {c.lastPurchase ? formatDate(c.lastPurchase) : "—"}
                  </span>
                  <span className="customer-stat-label">Last purchase</span>
                </div>
              </div>

              <button className="btn-edit-customer" onClick={e => startEdit(c, e)}>Edit</button>
              {confirmDelete === c.id ? (
                <div className="delete-confirm" onClick={e => e.stopPropagation()}>
                  <span>Delete?</span>
                  <button className="btn-confirm-delete" onClick={e => deleteCustomer(c.id, e)}>Yes</button>
                  <button className="btn-cancel-delete" onClick={e => { e.stopPropagation(); setConfirmDelete(null); }}>No</button>
                </div>
              ) : (
                <button className="btn-delete-customer" onClick={e => { e.stopPropagation(); setConfirmDelete(c.id); }}>Delete</button>
              )}
              <span className="customer-chevron">{expanded === c.id ? "▲" : "▼"}</span>
            </div>

            {/* Inline edit form */}
            {editing === c.id && (
              <div className="customer-edit-form" onClick={e => e.stopPropagation()}>
                {editError && <div className="form-error">{editError}</div>}
                <div className="customer-edit-row">
                  <div className="customer-edit-group">
                    <label>Name</label>
                    <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="customer-edit-group">
                    <label>Phone</label>
                    <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} />
                  </div>
                  <div className="customer-edit-group">
                    <label>Email</label>
                    <input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                </div>
                <div className="customer-edit-actions">
                  <button className="btn-save-edit" onClick={e => saveEdit(c.id, e)} disabled={editLoading}>
                    {editLoading ? "Saving…" : "Save"}
                  </button>
                  <button className="btn-cancel-edit" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}

            {/* Expanded: full purchase history */}
            {expanded === c.id && (
              <div className="customer-sales">
                {c.sales.map(sale => (
                  <div key={sale.id} className="customer-sale-row">
                    <span className="customer-sale-date">{formatDate(sale.createdAt)}</span>
                    <span className="customer-sale-items">
                      {sale.items.map(i => i.product.name).join(", ")}
                    </span>
                    <span className="customer-sale-total">${sale.totalPrice.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Sales View ───────────────────────────────────────────────────────────────

function SalesView({ onRefund }) {
  const [sales, setSales]           = useState([]);
  const [expanded, setExpanded]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [confirmRefund, setConfirmRefund] = useState(null);

  function load() {
    fetch(`${API}/api/sales`)
      .then(r => r.json())
      .then(data => { setSales(data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function toggleExpand(id) { setExpanded(prev => prev === id ? null : id); }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  async function refundItem(saleId, itemId) {
    try {
      const res  = await fetch(`${API}/api/sales/${saleId}/items/${itemId}/refund`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmRefund(null);
      load();
      onRefund();
    } catch (err) {
      alert("Refund failed: " + err.message);
    }
  }

  return (
    <div className="sales-view">
      <h2>Sales History</h2>

      {loading && <p className="sales-empty">Loading…</p>}
      {!loading && sales.length === 0 && <p className="sales-empty">No sales yet.</p>}

      <ul className="sales-list">
        {sales.map(sale => (
          <li key={sale.id} className="sale-card">
            <div className="sale-card-header" onClick={() => toggleExpand(sale.id)}>
              <div className="sale-meta">
                <span className="sale-id">Sale #{sale.id}</span>
                <span className="sale-date">{formatDate(sale.createdAt)}</span>
              </div>
              <span className="sale-customer">
                {sale.customer ? `${sale.customer.name}${sale.customer.phone ? ` · ${sale.customer.phone}` : ""}` : "Walk-in"}
              </span>
              <span className="sale-total">${sale.totalPrice.toFixed(2)}</span>
              <span className={`payment-badge ${sale.paymentMethod === "card" ? "card" : "cash"}`}>
                {sale.paymentMethod === "card" ? "Card" : "Cash"}
              </span>
              <span className="sale-chevron">{expanded === sale.id ? "▲" : "▼"}</span>
            </div>

            {expanded === sale.id && (
              <ul className="sale-items-list">
                {sale.items.map(item => (
                  <li key={item.id} className={`sale-item-row ${item.refunded ? "refunded" : ""}`}>
                    <div className="sale-item-detail">
                      <span>{item.product.name}</span>
                      {item.unit && <span className="sale-item-imei">IMEI {item.unit.imei}</span>}
                    </div>
                    <div className="sale-item-right">
                      <span>
                        {item.quantity > 1 && `${item.quantity} × `}
                        ${(item.unitPrice * item.quantity).toFixed(2)}
                      </span>
                      {item.refunded ? (
                        <span className="refund-badge">Refunded</span>
                      ) : confirmRefund === item.id ? (
                        <div className="refund-confirm">
                          <span>Refund?</span>
                          <button className="btn-confirm-refund" onClick={() => refundItem(sale.id, item.id)}>Yes</button>
                          <button className="btn-cancel-refund" onClick={() => setConfirmRefund(null)}>No</button>
                        </div>
                      ) : (
                        <button className="btn-refund" onClick={() => setConfirmRefund(item.id)}>Refund</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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

  return (
    <div className="pos">
      <header className="pos-header">
        <h1>iSmart POS</h1>
        <nav className="tabs">
          <button className={`tab ${view === "dashboard"  ? "active" : ""}`} onClick={() => setView("dashboard")}>  Dashboard  </button>
          <button className={`tab ${view === "pos"        ? "active" : ""}`} onClick={() => setView("pos")}>        POS        </button>
          <button className={`tab ${view === "inventory"  ? "active" : ""}`} onClick={() => setView("inventory")}>  Inventory  </button>
          <button className={`tab ${view === "sales"      ? "active" : ""}`} onClick={() => setView("sales")}>      Sales      </button>
          <button className={`tab ${view === "customers"  ? "active" : ""}`} onClick={() => setView("customers")}> Customers  </button>
        </nav>
      </header>

      {view === "dashboard"  && <DashboardView />}
      {view === "pos"        && <POSView       products={products} onSaleComplete={loadProducts} />}
      {view === "inventory"  && <InventoryView products={products} onStockUpdated={loadProducts} />}
      {view === "sales"      && <SalesView />}
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

  return (
    <div className="dashboard-view">

      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <div className="stat-card highlight">
          <span className="stat-label">Today's Revenue</span>
          <span className="stat-value">${today.revenue.toFixed(2)}</span>
        </div>
        <div className="stat-card highlight">
          <span className="stat-label">Sales Today</span>
          <span className="stat-value">{today.sales}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">All-Time Revenue</span>
          <span className="stat-value">${allTime.revenue.toFixed(2)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Sales</span>
          <span className="stat-value">{allTime.sales}</span>
        </div>
      </div>

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

// ─── POS View ────────────────────────────────────────────────────────────────

function POSView({ products, onSaleComplete }) {
  const [cart, setCart]           = useState([]);
  const [customer, setCustomer]   = useState({ name: "", phone: "", email: "" });
  const [lastSale, setLastSale]   = useState(null);
  const [saleError, setSaleError] = useState(null);
  const [loading, setLoading]     = useState(false);

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
    const customerPayload = (customer.name || customer.phone)
      ? { name: customer.name, phone: customer.phone || undefined, email: customer.email || undefined }
      : undefined;

    try {
      const res  = await fetch(`${API}/api/sales`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ items, customer: customerPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLastSale(data);
      setCart([]);
      setCustomer({ name: "", phone: "", email: "" });
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
  const visibleProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

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

      {/* ── Cart ── */}
      <section className="panel cart-panel">
        <h2>Cart</h2>

        {lastSale && (
          <div className="confirmation">
            <strong>Sale #{lastSale.id} complete{lastSale.customer ? ` — ${lastSale.customer.name}` : ""}</strong>
            <span>Total charged: ${lastSale.totalPrice.toFixed(2)}</span>
          </div>
        )}
        {saleError && <div className="sale-error">{saleError}</div>}

        {cart.length === 0 ? (
          <p className="cart-empty">Cart is empty</p>
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

            {/* Customer — optional, cashier can skip for anonymous sales */}
            <div className="customer-section">
              <h3>Customer — optional</h3>
              <div className="customer-row">
                <input
                  placeholder="Name"
                  value={customer.name}
                  onChange={e => setCustomer(p => ({ ...p, name: e.target.value }))}
                />
                <input
                  placeholder="Phone"
                  value={customer.phone}
                  onChange={e => setCustomer(p => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div className="customer-row">
                <input
                  placeholder="Email — optional"
                  value={customer.email}
                  onChange={e => setCustomer(p => ({ ...p, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="cart-total">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>

            <button className="btn-checkout" onClick={completeSale} disabled={loading}>
              {loading ? "Processing…" : "Complete Sale"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

// ─── Inventory View ───────────────────────────────────────────────────────────

function InventoryView({ products, onStockUpdated }) {
  return (
    <div className="inventory-view">
      <NewProductForm  onStockUpdated={onStockUpdated} />
      <AddStockForm    products={products} onStockUpdated={onStockUpdated} />
    </div>
  );
}

function NewProductForm({ onStockUpdated }) {
  const blank = { name: "", sellPrice: "", costPrice: "", upc: "", isSerialized: false, quantity: "", imei: "" };
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
        body:    JSON.stringify({ name: form.name, sellPrice: form.sellPrice, costPrice: form.costPrice, upc: form.upc, isSerialized: form.isSerialized, quantity: form.quantity }),
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

// ─── Customers View ──────────────────────────────────────────────────────────

function CustomersView() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetch(`${API}/api/customers`)
      .then(r => r.json())
      .then(data => { setCustomers(data); setLoading(false); });
  }, []);

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
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

              {/* Avatar: first letter of name */}
              <div className="customer-avatar">
                {c.name.charAt(0).toUpperCase()}
              </div>

              {/* Name + contact */}
              <div className="customer-main">
                <span className="customer-name">{c.name}</span>
                <span className="customer-contact">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                </span>
              </div>

              {/* Stats */}
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

              <span className="customer-chevron">{expanded === c.id ? "▲" : "▼"}</span>
            </div>

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

function SalesView() {
  const [sales, setSales]       = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`${API}/api/sales`)
      .then(r => r.json())
      .then(data => { setSales(data); setLoading(false); });
  }, []);

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
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
              <span className="sale-chevron">{expanded === sale.id ? "▲" : "▼"}</span>
            </div>

            {expanded === sale.id && (
              <ul className="sale-items-list">
                {sale.items.map(item => (
                  <li key={item.id} className="sale-item-row">
                    <div className="sale-item-detail">
                      <span>{item.product.name}</span>
                      {item.unit && <span className="sale-item-imei">IMEI {item.unit.imei}</span>}
                    </div>
                    <span>
                      {item.quantity > 1 && `${item.quantity} × `}
                      ${(item.unitPrice * item.quantity).toFixed(2)}
                    </span>
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

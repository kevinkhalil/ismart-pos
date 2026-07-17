import { useState, useEffect, useCallback, useRef, Component } from "react";
import "./App.css";
import { Chart, CategoryScale, LinearScale, BarElement, BarController, Tooltip } from "chart.js";
Chart.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip);

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Holds the current session's JWT so every apiFetch call can attach it.
// Not React state on purpose — it's read by helper functions outside the component tree.
let authToken = null;

function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return fetch(`${API}${path}`, { ...options, headers }).then(res => {
    if (res.status === 401) {
      authToken = null;
      window.location.reload();
    }
    return res;
  });
}

const ROLE_TABS = {
  cashier: ["pos", "returns"],
  manager: ["pos", "inventory", "sales", "customers", "reports", "returns"],
  owner:   ["dashboard", "pos", "inventory", "sales", "customers", "reports", "returns", "users"],
};

const ROLE_LABELS = { owner: "Owner", manager: "Manager", cashier: "Cashier" };

const ALL_TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pos",       label: "POS" },
  { id: "inventory", label: "Inventory" },
  { id: "sales",     label: "Sales" },
  { id: "customers", label: "Customers" },
  { id: "reports",   label: "Reports" },
  { id: "returns",   label: "Returns" },
  { id: "users",     label: "Users" },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView]               = useState("pos");
  const [products, setProducts]       = useState([]);

  const loadProducts = useCallback(() => {
    apiFetch(`/api/products`)
      .then(r => r.json())
      .then(setProducts);
  }, []);

  useEffect(() => { if (currentUser) loadProducts(); }, [loadProducts, currentUser]);

  function handleLogin(user) {
    authToken = user.token;
    setCurrentUser(user);
    setView(user.role === "owner" ? "dashboard" : "pos");
  }

  function handleLogout() {
    authToken = null;
    setCurrentUser(null);
    setView("pos");
    setProducts([]);
  }

  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

  const lowStockCount = products.filter(p =>
    p.isSerialized ? p.units.length === 0 : p.quantity <= 5
  ).length;

  const visibleTabs = ALL_TABS.filter(t => ROLE_TABS[currentUser.role].includes(t.id));

  return (
    <div className="pos">
      <header className="pos-header">
        <h1>iSmart POS</h1>
        <nav className="tabs">
          {visibleTabs.map(t => (
            <button key={t.id} className={`tab ${view === t.id ? "active" : ""}`} onClick={() => setView(t.id)}>
              {t.label}
              {t.id === "inventory" && lowStockCount > 0 && <span className="nav-badge">{lowStockCount}</span>}
            </button>
          ))}
        </nav>
        <div className="header-user">
          <span className="header-user-name">{currentUser.name}</span>
          <span className={`role-badge ${currentUser.role}`}>{ROLE_LABELS[currentUser.role]}</span>
          <button className="btn-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      {view === "dashboard"  && <DashboardView />}
      {view === "pos"        && <POSView products={products} onSaleComplete={loadProducts} />}
      {view === "inventory"  && <InventoryView products={products} onStockUpdated={loadProducts} />}
      {view === "sales"      && <SalesView onRefund={loadProducts} />}
      {view === "customers"  && <CustomersView />}
      {view === "reports"    && <ReportsErrorBoundary key="reports"><ReportsView /></ReportsErrorBoundary>}
      {view === "returns"    && <ReturnsView onRefund={loadProducts} />}
      {view === "users"      && <UsersView currentUserId={currentUser.id} />}

      {(currentUser.role === "manager" || currentUser.role === "owner") && <ChatBot />}
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [users, setUsers]               = useState(null);
  const [selected, setSelected]         = useState(null);
  const [pin, setPin]                   = useState("");
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(false);

  useEffect(() => {
    apiFetch(`/api/users/list`)
      .then(r => r.json())
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  function appendPin(digit) {
    if (pin.length >= 6) return;
    setPin(p => p + digit);
    setError("");
  }

  function backspace() {
    setPin(p => p.slice(0, -1));
    setError("");
  }

  async function submitPin() {
    if (!pin || loading) return;
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/auth/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId: selected.id, pin }),
      });
      const data = await res.json();
      if (!res.ok) { setError("Incorrect PIN"); setPin(""); }
      else onLogin(data);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  if (users === null) {
    return (
      <div className="login-screen">
        <div className="login-card"><div className="login-logo">iSmart POS</div><p className="login-subtitle">Loading…</p></div>
      </div>
    );
  }

  if (users.length === 0) return <SetupScreen onSetupComplete={onLogin} />;

  if (selected) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">iSmart POS</div>
          <div className="login-selected-name">{selected.name}</div>
          <button className="btn-switch-user" onClick={() => { setSelected(null); setPin(""); setError(""); }}>← Switch user</button>
          <div className="pin-dots">
            {[...Array(6)].map((_, i) => (
              <div key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
            ))}
          </div>
          {error && <div className="pin-error">{error}</div>}
          <div className="pin-pad">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} className="pin-btn" onClick={() => appendPin(String(n))}>{n}</button>
            ))}
            <button className="pin-btn pin-back" onClick={backspace}>⌫</button>
            <button className="pin-btn" onClick={() => appendPin("0")}>0</button>
            <button className="pin-btn pin-enter" onClick={submitPin} disabled={!pin || loading}>
              {loading ? "…" : "→"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">iSmart POS</div>
        <p className="login-subtitle">Who's signing in?</p>
        <div className="user-tiles">
          {users.map(u => (
            <button key={u.id} className="user-tile" onClick={() => setSelected(u)}>
              <div className="user-tile-avatar">{u.name.charAt(0).toUpperCase()}</div>
              <div className="user-tile-name">{u.name}</div>
              <div className={`user-tile-role ${u.role}`}>{ROLE_LABELS[u.role]}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Setup Screen (first time only) ───────────────────────────────────────────

function SetupScreen({ onSetupComplete }) {
  const [form, setForm]     = useState({ name: "", pin: "", confirm: "" });
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(form.pin))       return setError("PIN must be 4–6 digits (numbers only)");
    if (form.pin !== form.confirm)          return setError("PINs don't match");
    setLoading(true); setError("");
    try {
      const res  = await apiFetch(`/api/auth/setup`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: form.name, pin: form.pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSetupComplete(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card setup-card">
        <div className="login-logo">iSmart POS</div>
        <p className="login-subtitle">Welcome! Create your owner account to get started.</p>
        {error && <div className="pin-error">{error}</div>}
        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label>Your name</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Store Owner" required />
          </div>
          <div className="form-group">
            <label>PIN (4–6 digits)</label>
            <input type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value }))} placeholder="••••" required />
          </div>
          <div className="form-group">
            <label>Confirm PIN</label>
            <input type="password" inputMode="numeric" maxLength={6} value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} placeholder="••••" required />
          </div>
          <button className="btn-submit" disabled={loading}>{loading ? "Creating…" : "Create Account & Sign In"}</button>
        </form>
      </div>
    </div>
  );
}

// ─── Dashboard View ──────────────────────────────────────────────────────────

function DashboardView() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [reporting, setReporting]     = useState(false);
  const [reportMsg, setReportMsg]     = useState(null);

  function load() {
    setLoading(true);
    apiFetch(`/api/dashboard`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }

  async function sendOwnerReport() {
    setReporting(true);
    setReportMsg(null);
    try {
      const res  = await apiFetch(`/api/reports/owner`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReportMsg({ type: "ok", text: "Report sent to owner successfully!" });
    } catch (err) {
      setReportMsg({ type: "error", text: `Failed: ${err.message}` });
    } finally {
      setReporting(false);
      setTimeout(() => setReportMsg(null), 4000);
    }
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

      {/* ── Owner report button ── */}
      <div className="dashboard-report-row">
        <button className="btn-owner-report" onClick={sendOwnerReport} disabled={reporting}>
          {reporting ? "Sending…" : "Send Owner Report"}
        </button>
        {reportMsg && <span className={`report-msg ${reportMsg.type}`}>{reportMsg.text}</span>}
      </div>

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
  const [discountType, setDiscountType]   = useState("pct");
  const [discountValue, setDiscountValue] = useState("");
  const [barcodeVal, setBarcodeVal]   = useState("");
  const [scanMsg, setScanMsg]         = useState(null);
  const [categories, setCategories]   = useState([]);
  const [selectedParentId, setSelectedParentId] = useState(null);
  const [selectedSubId, setSelectedSubId]       = useState(null);

  useEffect(() => {
    apiFetch(`/api/categories`).then(r => r.json()).then(setCategories);
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
      const res   = await apiFetch(`/api/customers/lookup?phone=${encodeURIComponent(fullPhone)}`);
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

  const subtotal       = cart.reduce((sum, i) => sum + i.product.sellPrice * i.quantity, 0);
  const discountAmount = discountValue && parseFloat(discountValue) > 0
    ? discountType === "pct"
      ? subtotal * (parseFloat(discountValue) / 100)
      : Math.min(parseFloat(discountValue), subtotal)
    : 0;
  const total = Math.max(0, subtotal - discountAmount);

  async function completeSale() {
    setSaleError(null);
    setLoading(true);

    const items = cart.map(i =>
      i.unit
        ? { productId: i.product.id, productUnitId: i.unit.id }
        : { productId: i.product.id, quantity: i.quantity }
    );

    const customerPayload = (customer.name || fullPhone)
      ? { name: customer.name, phone: fullPhone || undefined, email: customer.email || undefined }
      : undefined;

    const discountPayload = discountAmount > 0
      ? { type: discountType, value: parseFloat(discountValue) }
      : undefined;

    try {
      const res  = await apiFetch(`/api/sales`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ items, customer: customerPayload, paymentMethod, discount: discountPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLastSale(data);
      setCart([]);
      setCustomer({ name: "", phone: "", email: "" });
      setReturning(null);
      setPaymentMethod("cash");
      setDiscountValue("");
      setDiscountType("pct");
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

            <div className="discount-row">
              <div className="discount-type-toggle">
                <button type="button" className={discountType === "pct"   ? "active" : ""} onClick={() => { setDiscountType("pct");   setDiscountValue(""); }}>%</button>
                <button type="button" className={discountType === "fixed" ? "active" : ""} onClick={() => { setDiscountType("fixed"); setDiscountValue(""); }}>$</button>
              </div>
              <input
                className="discount-input"
                type="number"
                min="0"
                max={discountType === "pct" ? 100 : undefined}
                step="0.01"
                placeholder={discountType === "pct" ? "Discount %" : "Discount $"}
                value={discountValue}
                onChange={e => setDiscountValue(e.target.value)}
              />
            </div>

            {discountAmount > 0 && (
              <div className="cart-subtotal-row">
                <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="cart-discount-row">
                <span>Discount {discountType === "pct" ? `(${parseFloat(discountValue)}%)` : ""}</span>
                <span>− ${discountAmount.toFixed(2)}</span>
              </div>
            )}

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
    apiFetch(`/api/categories`).then(r => r.json()).then(setCategories);
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
      const res     = await apiFetch(`/api/products`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: form.name, sellPrice: form.sellPrice, costPrice: form.costPrice, upc: form.upc, isSerialized: form.isSerialized, quantity: form.quantity, categoryId: form.categoryId || null }),
      });
      const product = await res.json();
      if (!res.ok) throw new Error(product.error);

      if (form.isSerialized && form.imei) {
        const unitRes = await apiFetch(`/api/products/${product.id}/units`, {
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
        const res  = await apiFetch(`/api/products/${selected.id}/units`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imei, costPrice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSuccess(`IMEI ${data.imei} added to ${selected.name}`);
      } else {
        const res  = await apiFetch(`/api/products/${selected.id}/stock`, {
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
      const res  = await apiFetch(`/api/products/${selected.id}`, {
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
      const res  = await apiFetch(`/api/categories`, {
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
    await apiFetch(`/api/categories/${id}`, { method: "DELETE" });
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
    apiFetch(`/api/customers`)
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
      const res  = await apiFetch(`/api/customers/${id}`, { method: "DELETE" });
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
      const res  = await apiFetch(`/api/customers/${id}`, {
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
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [activePreset, setActivePreset] = useState("all");

  // Use local date parts — toISOString() is UTC and gives the wrong date in UTC+ timezones
  function localStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function load(from, to) {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to)   params.set("to",   to);
    const qs  = params.toString();
    apiFetch(`/api/sales${qs ? "?" + qs : ""}`)
      .then(r => r.json())
      .then(data => { setSales(data); setLoading(false); });
  }

  useEffect(() => { load(dateFrom, dateTo); }, [dateFrom, dateTo]);

  function setPreset(preset) {
    setActivePreset(preset);
    const today    = new Date();
    const todayStr = localStr(today);
    if (preset === "today") {
      setDateFrom(todayStr); setDateTo(todayStr);
    } else if (preset === "week") {
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      setDateFrom(localStr(start)); setDateTo(todayStr);
    } else if (preset === "month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setDateFrom(localStr(start)); setDateTo(todayStr);
    } else {
      setDateFrom(""); setDateTo("");
    }
  }

  function handleManualDate(field, value) {
    setActivePreset("custom");
    if (field === "from") setDateFrom(value);
    else setDateTo(value);
  }

  function toggleExpand(id) { setExpanded(prev => prev === id ? null : id); }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  async function refundItem(saleId, itemId) {
    try {
      const res  = await apiFetch(`/api/sales/${saleId}/items/${itemId}/refund`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmRefund(null);
      load(dateFrom, dateTo);
      onRefund();
    } catch (err) {
      alert("Refund failed: " + err.message);
    }
  }

  function exportCSV() {
    const rows = [["Sale ID", "Date", "Customer", "Phone", "Email", "Payment", "Total ($)", "Items"]];
    for (const sale of sales) {
      const date     = new Date(sale.createdAt).toLocaleString();
      const customer = sale.customer?.name  || "Walk-in";
      const phone    = sale.customer?.phone || "";
      const email    = sale.customer?.email || "";
      const items    = sale.items.map(i => `${i.product.name} x${i.quantity}`).join("; ");
      rows.push([sale.id, date, customer, phone, email, sale.paymentMethod, sale.totalPrice.toFixed(2), items]);
    }
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `ismart-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filteredRevenue = sales.reduce((sum, s) => sum + s.totalPrice, 0);
  const isFiltered      = dateFrom || dateTo;

  function rangeLabel() {
    if (!dateFrom && !dateTo) return "All sales";
    const fmt = iso => new Date(iso + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    if (dateFrom && dateTo) return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
    if (dateFrom)           return `From ${fmt(dateFrom)}`;
    return `Up to ${fmt(dateTo)}`;
  }

  return (
    <div className="sales-view">
      <div className="sales-view-header">
        <h2>Sales History</h2>
        {sales.length > 0 && (
          <button className="btn-export-csv" onClick={exportCSV}>Export CSV</button>
        )}
      </div>

      {/* ── Date filter bar ── */}
      <div className="sales-filter-bar">
        <div className="sales-preset-btns">
          <button className={`preset-btn ${activePreset === "all"   ? "active" : ""}`} onClick={() => setPreset("all")}>All time</button>
          <button className={`preset-btn ${activePreset === "today" ? "active" : ""}`} onClick={() => setPreset("today")}>Today</button>
          <button className={`preset-btn ${activePreset === "week"  ? "active" : ""}`} onClick={() => setPreset("week")}>This week</button>
          <button className={`preset-btn ${activePreset === "month" ? "active" : ""}`} onClick={() => setPreset("month")}>This month</button>
        </div>
        <div className="sales-date-inputs">
          <label>From
            <input type="date" value={dateFrom} onChange={e => handleManualDate("from", e.target.value)} />
          </label>
          <label>To
            <input type="date" value={dateTo} onChange={e => handleManualDate("to", e.target.value)} />
          </label>
          {isFiltered && (
            <button className="btn-clear-filter" onClick={() => setPreset("all")}>Clear</button>
          )}
        </div>
      </div>

      {/* ── Summary row ── */}
      {!loading && (
        <div className="sales-summary">
          <span className="sales-summary-range">{rangeLabel()}</span>
          <span className="sales-summary-count">{sales.length} {sales.length === 1 ? "sale" : "sales"}</span>
          {sales.length > 0 && (
            <span className="sales-summary-revenue">Total: <strong>${filteredRevenue.toFixed(2)}</strong></span>
          )}
        </div>
      )}

      {loading && <p className="sales-empty">Loading…</p>}
      {!loading && sales.length === 0 && <p className="sales-empty">{isFiltered ? "No sales in this date range." : "No sales yet."}</p>}

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

// ─── Returns View ─────────────────────────────────────────────────────────────

function ReturnsView({ onRefund }) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [selected, setSelected]   = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [doneMsg, setDoneMsg]     = useState("");

  async function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true); setSearchErr(""); setResults(null); setSelected(null); setDoneMsg("");
    try {
      // Try as Sale ID first, then fall back to customer name search
      const params = new URLSearchParams({ q });
      const res  = await apiFetch(`/api/returns/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data);
      if (data.length === 0) setSearchErr("No sales found. Try a Sale ID or customer name.");
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function refundItem(saleId, itemId) {
    setProcessing(true);
    try {
      const res  = await apiFetch(`/api/sales/${saleId}/items/${itemId}/refund`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmId(null);
      setDoneMsg("Item refunded — stock restored.");
      // Refresh the selected sale
      const refreshRes  = await apiFetch(`/api/returns/search?q=${encodeURIComponent(String(saleId))}`);
      const refreshData = await refreshRes.json();
      if (refreshRes.ok) {
        setResults(refreshData);
        setSelected(refreshData.find(s => s.id === saleId) ?? null);
      }
      onRefund();
      setTimeout(() => setDoneMsg(""), 3000);
    } catch (err) {
      alert("Refund failed: " + err.message);
    } finally {
      setProcessing(false);
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="returns-view">
      <div className="returns-header">
        <h2>Process Return</h2>
        <p className="returns-subtitle">Search by Sale ID or customer name to find and refund items.</p>
      </div>

      {/* Search bar */}
      <form className="returns-search-form" onSubmit={handleSearch}>
        <input
          className="returns-search-input"
          placeholder="Sale ID (e.g. 42) or customer name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="btn-submit returns-search-btn" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {searchErr && <p className="returns-error">{searchErr}</p>}
      {doneMsg   && <p className="returns-success">{doneMsg}</p>}

      {/* Results list */}
      {results && !selected && (
        <ul className="returns-results">
          {results.map(sale => (
            <li key={sale.id} className="returns-result-card" onClick={() => setSelected(sale)}>
              <div className="returns-result-left">
                <span className="returns-result-id">Sale #{sale.id}</span>
                <span className="returns-result-date">{formatDate(sale.createdAt)}</span>
              </div>
              <span className="returns-result-customer">
                {sale.customer ? sale.customer.name : "Walk-in"}
              </span>
              <span className="returns-result-total">${sale.totalPrice.toFixed(2)}</span>
              <span className="returns-result-arrow">→</span>
            </li>
          ))}
        </ul>
      )}

      {/* Selected sale detail */}
      {selected && (
        <div className="returns-detail">
          <div className="returns-detail-header">
            <div>
              <span className="returns-result-id">Sale #{selected.id}</span>
              <span className="returns-result-date" style={{ marginLeft: 10 }}>{formatDate(selected.createdAt)}</span>
              {selected.customer && <span className="returns-result-customer" style={{ marginLeft: 10 }}>— {selected.customer.name}</span>}
            </div>
            <button className="btn-cancel-edit" onClick={() => { setSelected(null); setConfirmId(null); }}>← Back to results</button>
          </div>

          <ul className="returns-items-list">
            {selected.items.map(item => (
              <li key={item.id} className={`returns-item-row ${item.refunded ? "refunded" : ""}`}>
                <div className="returns-item-info">
                  <span className="returns-item-name">{item.product?.name || "Item"}</span>
                  {item.unit && <span className="returns-item-imei">IMEI {item.unit.imei}</span>}
                  {item.quantity > 1 && <span className="returns-item-qty">×{item.quantity}</span>}
                </div>
                <div className="returns-item-right">
                  <span className="returns-item-price">${(item.unitPrice * item.quantity).toFixed(2)}</span>
                  {item.refunded ? (
                    <span className="refund-badge">Refunded</span>
                  ) : confirmId === item.id ? (
                    <div className="refund-confirm">
                      <span>Confirm refund?</span>
                      <button className="btn-confirm-refund" onClick={() => refundItem(selected.id, item.id)} disabled={processing}>
                        {processing ? "…" : "Yes, refund"}
                      </button>
                      <button className="btn-cancel-refund" onClick={() => setConfirmId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn-refund" onClick={() => setConfirmId(item.id)}>Refund</button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="returns-total-row">
            <span>Sale total</span>
            <span>${selected.totalPrice.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reports View ─────────────────────────────────────────────────────────────

class ReportsErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return (
      <div className="reports-view">
        <p className="reports-empty" style={{ color: "var(--color-error,#ef4444)", fontFamily: "monospace", fontSize: 13 }}>
          Reports error — {this.state.err.message}
        </p>
        <button className="btn-submit" style={{ marginTop: 12 }} onClick={() => this.setState({ err: null })}>
          Retry
        </button>
      </div>
    );
    return this.props.children;
  }
}

function RevenueChart({ daily }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  // Create chart once on mount, destroy on unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    Chart.getChart(canvas)?.destroy();

    const dark      = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const tickColor = dark ? "#94a3b8" : "#64748b";
    const gridColor = dark ? "#334155" : "#f1f5f9";

    chartRef.current = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels:   [],
        datasets: [{ data: [], backgroundColor: "#2563eb", hoverBackgroundColor: "#1d4ed8", borderRadius: 4, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: c => ` $${Number(c.raw).toFixed(2)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 12, maxRotation: 45 } },
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: tickColor, callback: v => `$${v}` } },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  // Update data imperatively whenever daily changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = daily.map(d =>
      new Date(d.date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })
    );
    chart.data.datasets[0].data = daily.map(d => parseFloat(Number(d.revenue).toFixed(2)));
    chart.update();
  }, [daily]);

  return <div className="reports-chart-wrap"><canvas ref={canvasRef} /></div>;
}

function ReportsFilterBar({ dateFrom, dateTo, activePreset, onPreset, onFromChange, onToChange }) {
  return (
    <div className="sales-filter-bar">
      <div className="sales-preset-btns">
        {[["7days","Last 7 days"],["30days","Last 30 days"],["month","This month"],["year","This year"]].map(([id, label]) => (
          <button key={id} className={`preset-btn ${activePreset === id ? "active" : ""}`} onClick={() => onPreset(id)}>{label}</button>
        ))}
      </div>
      <div className="sales-date-inputs">
        <label>From <input type="date" value={dateFrom} onChange={e => onFromChange(e.target.value)} /></label>
        <label>To   <input type="date" value={dateTo}   onChange={e => onToChange(e.target.value)}   /></label>
      </div>
    </div>
  );
}

function ReportsView() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [activePreset, setActivePreset] = useState("30days");

  function localStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }

  function applyPreset(preset) {
    setActivePreset(preset);
    const today = new Date();
    const str   = localStr(today);
    if (preset === "7days") {
      const s = new Date(today); s.setDate(today.getDate() - 6);
      setDateFrom(localStr(s)); setDateTo(str);
    } else if (preset === "30days") {
      const s = new Date(today); s.setDate(today.getDate() - 29);
      setDateFrom(localStr(s)); setDateTo(str);
    } else if (preset === "month") {
      setDateFrom(localStr(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(str);
    } else if (preset === "year") {
      setDateFrom(localStr(new Date(today.getFullYear(), 0, 1))); setDateTo(str);
    }
  }

  useEffect(() => { applyPreset("30days"); }, []);

  useEffect(() => {
    if (!dateFrom) return;
    setLoading(true);
    setFetchError(null);
    apiFetch(`/api/reports/analytics?from=${dateFrom}&to=${dateTo}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setFetchError(err.message); setLoading(false); });
  }, [dateFrom, dateTo]);


  const { summary, daily, topProducts, payment } = data ?? { summary: {}, daily: [], topProducts: [], payment: {} };
  const totalPayment = (payment.cash ?? 0) + (payment.card ?? 0);
  const cashPct      = totalPayment > 0 ? ((payment.cash ?? 0) / totalPayment) * 100 : 0;
  const cardPct      = 100 - cashPct;

  return (
    <div className="reports-view">
      <ReportsFilterBar
        dateFrom={dateFrom} dateTo={dateTo} activePreset={activePreset}
        onPreset={applyPreset}
        onFromChange={v => { setActivePreset("custom"); setDateFrom(v); }}
        onToChange={v   => { setActivePreset("custom"); setDateTo(v);   }}
      />

      {fetchError && <p className="reports-empty" style={{ color: "var(--color-error, #ef4444)" }}>Failed to load: {fetchError}</p>}
      {loading ? <p className="reports-empty">Loading…</p> : fetchError ? null : (
        <>
          {/* Stat cards */}
          <div className="reports-stat-cards">
            <div className="reports-stat-card">
              <span className="reports-stat-label">Total Revenue</span>
              <span className="reports-stat-value">${(summary.totalRevenue ?? 0).toFixed(2)}</span>
            </div>
            <div className="reports-stat-card">
              <span className="reports-stat-label">Total Sales</span>
              <span className="reports-stat-value">{summary.totalSales ?? 0}</span>
            </div>
            <div className="reports-stat-card">
              <span className="reports-stat-label">Avg Order</span>
              <span className="reports-stat-value">${(summary.avgOrderValue ?? 0).toFixed(2)}</span>
            </div>
          </div>

          {/* Revenue trend chart */}
          <div className="reports-chart-card">
            <h3 className="reports-card-title">Revenue Trend</h3>
            {(summary.totalSales ?? 0) === 0 ? (
              <p className="reports-empty-chart">No sales in this period.</p>
            ) : (
              <RevenueChart daily={data.daily} />
            )}
          </div>

          {/* Bottom grid */}
          <div className="reports-bottom-grid">
            <div className="reports-card">
              <h3 className="reports-card-title">Top Products</h3>
              {topProducts.length === 0 ? (
                <p className="reports-empty">No sales in this period.</p>
              ) : (
                <ul className="reports-top-products">
                  {topProducts.map((p, i) => (
                    <li key={p.name} className="reports-top-product-row">
                      <span className="reports-rank">#{i + 1}</span>
                      <span className="reports-product-name">{p.name}</span>
                      <div className="reports-product-stats">
                        <span className="reports-product-revenue">${p.revenue.toFixed(2)}</span>
                        <span className="reports-product-units">{p.unitsSold} sold</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="reports-card">
              <h3 className="reports-card-title">Payment Split</h3>
              {totalPayment === 0 ? (
                <p className="reports-empty">No sales in this period.</p>
              ) : (
                <div className="reports-payment-split">
                  {[["Cash", payment.cash ?? 0, cashPct, "cash"], ["Card", payment.card ?? 0, cardPct, "card"]].map(([label, amt, pct, cls]) => (
                    <div key={cls} className="payment-split-item">
                      <div className="payment-split-header">
                        <span className="payment-split-method">{label}</span>
                        <span className="payment-split-amount">${amt.toFixed(2)}</span>
                        <span className="payment-split-pct">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="payment-bar-track">
                        <div className={`payment-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Users View (owner only) ─────────────────────────────────────────────────

function UsersView({ currentUserId }) {
  const [users, setUsers]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [form, setForm]                 = useState({ name: "", role: "cashier", pin: "", confirm: "" });
  const [formError, setFormError]       = useState("");
  const [formSuccess, setFormSuccess]   = useState("");
  const [formLoading, setFormLoading]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [changePinFor, setChangePinFor] = useState(null);
  const [newPin, setNewPin]             = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinChangeError, setPinChangeError] = useState("");

  function load() {
    apiFetch(`/api/users`)
      .then(r => r.json())
      .then(d => { setUsers(d); setLoading(false); });
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(form.pin)) return setFormError("PIN must be 4–6 digits");
    if (form.pin !== form.confirm)   return setFormError("PINs don't match");
    setFormLoading(true); setFormError(""); setFormSuccess("");
    try {
      const res  = await apiFetch(`/api/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, role: form.role, pin: form.pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFormSuccess(`${data.name} added successfully`);
      setForm({ name: "", role: "cashier", pin: "", confirm: "" });
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(id) {
    await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    load();
  }

  async function handleChangePin(id) {
    if (!/^\d{4,6}$/.test(newPin)) return setPinChangeError("PIN must be 4–6 digits");
    if (newPin !== newPinConfirm)  return setPinChangeError("PINs don't match");
    const res = await apiFetch(`/api/users/${id}/pin`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: newPin }),
    });
    if (res.ok) { setChangePinFor(null); setNewPin(""); setNewPinConfirm(""); setPinChangeError(""); }
    else { const d = await res.json(); setPinChangeError(d.error); }
  }

  return (
    <div className="users-view">
      <div className="card">
        <h2>Add User</h2>
        {formSuccess && <div className="form-success">{formSuccess}</div>}
        {formError   && <div className="form-error">{formError}</div>}
        <form onSubmit={handleAdd}>
          <div className="form-group">
            <label>Name</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Employee name" required />
          </div>
          <div className="form-group">
            <label>Role</label>
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              <option value="cashier">Cashier — POS only</option>
              <option value="manager">Manager — POS + Inventory + Sales + Customers</option>
              <option value="owner">Owner — Full access</option>
            </select>
          </div>
          <div className="users-pin-row">
            <div className="form-group">
              <label>PIN (4–6 digits)</label>
              <input type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value }))} placeholder="••••" required />
            </div>
            <div className="form-group">
              <label>Confirm PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} placeholder="••••" required />
            </div>
          </div>
          <button className="btn-submit" disabled={formLoading}>{formLoading ? "Adding…" : "Add User"}</button>
        </form>
      </div>

      <div className="card">
        <h2>All Users</h2>
        {loading && <p className="dashboard-empty">Loading…</p>}
        <ul className="users-list">
          {users.map(u => (
            <li key={u.id} className="user-row">
              <div className="user-row-avatar">{u.name.charAt(0).toUpperCase()}</div>
              <div className="user-row-info">
                <span className="user-row-name">
                  {u.name}{u.id === currentUserId && <span className="you-badge"> (you)</span>}
                </span>
                <span className={`role-badge ${u.role}`}>{ROLE_LABELS[u.role]}</span>
              </div>
              <div className="user-row-actions">
                {changePinFor === u.id ? (
                  <div className="change-pin-inline">
                    {pinChangeError && <div className="form-error small-error">{pinChangeError}</div>}
                    <input type="password" inputMode="numeric" maxLength={6} placeholder="New PIN" value={newPin} onChange={e => setNewPin(e.target.value)} />
                    <input type="password" inputMode="numeric" maxLength={6} placeholder="Confirm" value={newPinConfirm} onChange={e => setNewPinConfirm(e.target.value)} />
                    <button className="btn-save-edit" onClick={() => handleChangePin(u.id)}>Save</button>
                    <button className="btn-cancel-edit" onClick={() => { setChangePinFor(null); setNewPin(""); setNewPinConfirm(""); setPinChangeError(""); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn-change-pin" onClick={() => { setChangePinFor(u.id); setPinChangeError(""); }}>Change PIN</button>
                )}
                {u.id !== currentUserId && (
                  confirmDelete === u.id ? (
                    <div className="delete-confirm">
                      <span>Delete?</span>
                      <button className="btn-confirm-delete" onClick={() => handleDelete(u.id)}>Yes</button>
                      <button className="btn-cancel-delete" onClick={() => setConfirmDelete(null)}>No</button>
                    </div>
                  ) : (
                    <button className="btn-delete-customer" onClick={() => setConfirmDelete(u.id)}>Delete</button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── ChatBot ─────────────────────────────────────────────────────────────────

function ChatBot() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your iSmart store assistant. Ask me anything — inventory levels, today's revenue, top products, low stock alerts, anything." },
  ]);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res  = await apiFetch(`/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Something went wrong: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <span className="chatbot-title">iSmart Assistant</span>
            <button className="chatbot-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="chatbot-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
            ))}
            {loading && <div className="chat-bubble assistant chat-typing"><span /><span /><span /></div>}
            <div ref={bottomRef} />
          </div>
          <div className="chatbot-input-row">
            <input
              className="chatbot-input"
              placeholder="Ask about your store…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              disabled={loading}
              autoFocus
            />
            <button className="chatbot-send" onClick={send} disabled={loading || !input.trim()}>Send</button>
          </div>
        </div>
      )}
      <button className="chatbot-fab" onClick={() => setOpen(o => !o)} title="Store Assistant">
        {open ? "✕" : "💬"}
      </button>
    </>
  );
}

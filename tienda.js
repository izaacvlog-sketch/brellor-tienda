(() => {
  "use strict";
  const CFG = window.BRELLOR_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
  const GEM = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M35 10h30l25 25v30L65 90H35L10 65V35z"/><path d="M40 22h20l18 18v20L60 78H40L22 60V40z"/></svg>`;

  const state = {
    db: null,
    categorias: [],
    productos: [],
    ajustes: {},
    filtro: "todo",
    cart: loadCart(),
    step: "lista",
    lastOrder: null,
  };

  // ---------- storage ----------
  function loadCart() {
    try { return JSON.parse(localStorage.getItem("brellor_cart") || "[]").filter((i) => i && i.id && i.cantidad > 0); }
    catch { return []; }
  }
  function saveCart() {
    try { localStorage.setItem("brellor_cart", JSON.stringify(state.cart)); } catch {}
  }

  // ---------- helpers ----------
  const byId = (id) => state.productos.find((p) => p.id === id);
  const catName = (id) => (state.categorias.find((c) => c.id === id) || {}).nombre || id;
  function waNumber() {
    let d = String(state.ajustes.whatsapp || "").replace(/\D/g, "");
    if (d.length === 10) d = "52" + d;
    return d;
  }
  function waLink(text) {
    const n = waNumber();
    return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : "";
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("on"), 2600);
  }
  function stockInfo(p) {
    if (p.existencias <= 0) return { cls: "out", txt: "Agotado" };
    if (p.existencias <= 2) return { cls: "low", txt: p.existencias === 1 ? "Última pieza" : `Quedan ${p.existencias}` };
    return { cls: "ok", txt: "Disponible" };
  }

  // ---------- data ----------
  async function load() {
    renderSkeleton();
    try {
      state.db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
      const [c, p, a] = await Promise.all([
        state.db.from("categorias").select("*").order("orden"),
        state.db.from("productos").select("*").eq("publicado", true)
          .order("destacado", { ascending: false }).order("creado", { ascending: false }),
        state.db.from("ajustes").select("*"),
      ]);
      if (c.error || p.error) throw c.error || p.error;
      state.categorias = c.data || [];
      state.productos = p.data || [];
      state.ajustes = Object.fromEntries((a.data || []).map((r) => [r.clave, r.valor]));
    } catch (e) {
      console.error(e);
      state.categorias = [
        { id: "cadenas", nombre: "Cadenas" }, { id: "aretes", nombre: "Aretes" }, { id: "anillos", nombre: "Anillos" },
        { id: "pulsos", nombre: "Pulsos" }, { id: "ice-chain", nombre: "Ice Chain" },
      ];
      state.productos = [];
      state.loadError = true;
    }
    // quitar del carrito lo que ya no existe
    state.cart = state.cart.filter((i) => byId(i.id));
    saveCart();
    renderAll();
    route();
  }

  // ---------- render ----------
  function renderAll() {
    renderShell();
    renderChips();
    renderGrid();
    renderHero();
    renderCartCount();
  }

  function renderShell() {
    $("#year").textContent = new Date().getFullYear();
    $("#mainNav").innerHTML = state.categorias
      .map((c) => `<a href="#cat=${esc(c.id)}">${esc(c.nombre)}</a>`).join("");
    const places = (state.ajustes.ubicaciones || "Mérida, Yucatán · Tapachula, Chiapas").split("·").map((s) => s.trim()).filter(Boolean);
    $("#heroPlaces").innerHTML = places.map((p) => `<span>${esc(p)}</span>`).join("");
    const wa = waLink("Hola BRELLOR, me interesa una de sus piezas.");
    const heroWa = $("#heroWa");
    if (wa) { heroWa.href = wa; heroWa.hidden = false; }
    const ig = String(state.ajustes.instagram || "").replace(/^@/, "");
    $("#footLinks").innerHTML = [
      ig ? `<a href="https://www.instagram.com/${esc(ig)}/" target="_blank" rel="noopener">Instagram @${esc(ig)}</a>` : "",
      wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : "",
    ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  }

  function renderChips() {
    const count = (id) => state.productos.filter((p) => p.categoria === id).length;
    const chips = [{ id: "todo", nombre: "Todo", n: state.productos.length },
      ...state.categorias.map((c) => ({ ...c, n: count(c.id) }))];
    $("#chips").innerHTML = chips.map((c) =>
      `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === state.filtro}">${esc(c.nombre)}${c.n ? `<small>${c.n}</small>` : ""}</button>`
    ).join("");
  }

  function renderSkeleton() {
    $("#grid").innerHTML = Array.from({ length: 8 }, () =>
      `<div class="piece skeleton" style="opacity:1"><div class="ph"></div><div class="meta"><h3>&nbsp;</h3></div></div>`).join("");
  }

  function renderGrid() {
    const list = state.filtro === "todo" ? state.productos : state.productos.filter((p) => p.categoria === state.filtro);
    $("#catTitle").textContent = state.filtro === "todo" ? "Todas las piezas" : catName(state.filtro);
    $("#catCount").textContent = list.length ? `${list.length} ${list.length === 1 ? "pieza" : "piezas"}` : "";

    if (!list.length) {
      $("#grid").innerHTML = `<div class="empty" style="grid-column:1/-1">
        <h3>${state.loadError ? "Estamos preparando la tienda" : "Muy pronto, nuevas piezas"}</h3>
        <p>${state.loadError ? "El catálogo estará disponible en unos momentos." : "Esta sección se está surtiendo. Escríbenos y te mostramos lo más reciente."}</p>
        ${waLink("Hola BRELLOR, ¿qué piezas tienen disponibles?") ? `<p style="margin-top:18px"><a class="btn ghost" target="_blank" rel="noopener" href="${esc(waLink("Hola BRELLOR, ¿qué piezas tienen disponibles?"))}">Preguntar por WhatsApp</a></p>` : ""}
      </div>`;
      return;
    }

    $("#grid").innerHTML = list.map((p, i) => {
      const s = stockInfo(p);
      const wide = i === 0 && p.destacado && list.length > 3;
      const f = p.fotos || [];
      const img = f[0]
        ? `<img src="${esc(f[0])}" alt="${esc(p.nombre)}" loading="${i < 4 ? "eager" : "lazy"}">${f[1] ? `<img class="alt" src="${esc(f[1])}" alt="" loading="lazy">` : ""}`
        : `<div class="noimg">${GEM}</div>`;
      const tag = s.cls === "ok" ? (p.destacado ? `<span class="tag">Destacado</span>` : "") : `<span class="tag ${s.cls}">${s.txt}</span>`;
      return `<button class="piece depth${wide ? " wide" : ""}${s.cls === "out" ? " soldout" : ""}" data-id="${esc(p.id)}" style="--dl:${(i % 4) * 90}ms">
        <div class="ph">${tag}${img}</div>
        <div class="meta">
          <div><h3>${esc(p.nombre)}</h3><div class="sub">${esc(p.material || catName(p.categoria))}</div></div>
          <div class="price">${money(p.precio)}</div>
        </div>
      </button>`;
    }).join("");
    observeDepth();
  }

  // ---------- animaciones ----------
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" })
    : null;
  function observeDepth() {
    document.querySelectorAll(".depth:not(.in)").forEach((el) => io ? io.observe(el) : el.classList.add("in"));
  }

  // Portada: el logo deja de ser 3D al terminar de girar (evita temblor) + scroll suave estilo parallax
  function setupStage() {
    const stage = $("#stage"), pin = $("#stagePin"), spin = $("#sSpin");
    if (!stage) return;
    const settle = () => spin.classList.add("settled");
    spin.addEventListener("animationend", (e) => { if (e.animationName === "spinIn") settle(); });
    setTimeout(settle, 2200); // por si el navegador no avisa
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cur = 0, target = 0, running = false;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const span = Math.max(1, stage.offsetHeight - innerHeight);
      const t = Math.min(1, Math.max(0, -r.top / span));
      target = t * t * (3 - 2 * t); // smoothstep
    };
    const tick = () => {
      cur += (target - cur) * 0.14;
      if (Math.abs(target - cur) < 0.0005) cur = target;
      pin.style.setProperty("--p", cur.toFixed(4));
      if (cur !== target) requestAnimationFrame(tick); else running = false;
    };
    const kick = () => { measure(); if (!running) { running = true; requestAnimationFrame(tick); } };
    addEventListener("scroll", kick, { passive: true });
    addEventListener("resize", kick);
    kick();
  }

  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("pointermove", (e) => {
      const ph = e.target.closest?.(".piece .ph");
      document.querySelectorAll(".piece .ph[data-tilt]").forEach((el) => {
        if (el !== ph) { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); el.removeAttribute("data-tilt"); }
      });
      if (!ph) return;
      const r = ph.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      ph.dataset.tilt = "1";
      ph.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
      ph.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
      ph.style.setProperty("--mx", `${x * 100}%`);
      ph.style.setProperty("--my", `${y * 100}%`);
    }, { passive: true });
  }

  function renderHero() {
    const withPhotos = state.productos.filter((p) => p.fotos && p.fotos[0]);
    const pick = [...withPhotos.filter((p) => p.destacado), ...withPhotos.filter((p) => !p.destacado)].slice(0, 3);
    if (!pick.length) return;
    const art = $("#heroArt");
    art.querySelector(".gem-fallback")?.remove();
    art.querySelectorAll(".frame").forEach((n) => n.remove());
    pick.forEach((p, i) => {
      const d = document.createElement("button");
      d.className = `frame f${i + 1}`;
      d.style.padding = "0";
      d.setAttribute("aria-label", p.nombre);
      d.dataset.id = p.id;
      d.innerHTML = `<img src="${esc(p.fotos[0])}" alt="${esc(p.nombre)}">`;
      art.appendChild(d);
    });
  }

  function renderCartCount() {
    const n = state.cart.reduce((s, i) => s + i.cantidad, 0);
    const el = $("#cartCount");
    el.textContent = n;
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }

  // ---------- sheets ----------
  function openSheet(id) {
    closeSheets(true);
    $("#scrim").classList.add("on");
    const s = $(id);
    s.classList.add("on");
    s.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => s.querySelector(".x")?.focus({ preventScroll: true }), 50);
  }
  function closeSheets(keepHash) {
    document.querySelectorAll(".sheet.on").forEach((s) => { s.classList.remove("on"); s.setAttribute("aria-hidden", "true"); });
    $("#scrim").classList.remove("on");
    document.body.style.overflow = "";
    if (!keepHash && location.hash.startsWith("#pieza=")) history.replaceState(null, "", location.pathname + location.search);
  }

  function openPiece(id) {
    const p = byId(id);
    if (!p) return;
    const s = stockInfo(p);
    const f = p.fotos && p.fotos.length ? p.fotos : [null];
    let qty = 1;
    const body = $("#pieceBody");
    body.innerHTML = `
      <div class="gallery">
        <div class="main">${f[0] ? `<img id="mainImg" src="${esc(f[0])}" alt="${esc(p.nombre)}">` : `<div class="noimg">${GEM}</div>`}</div>
        ${f.length > 1 ? `<div class="thumbs">${f.map((u, i) => `<button data-src="${esc(u)}" aria-current="${i === 0}" aria-label="Foto ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="detail">
        <div class="eyebrow" style="margin-top:22px">${esc(catName(p.categoria))}</div>
        <h2>${esc(p.nombre)}</h2>
        <div class="price-lg">${money(p.precio)}</div>
        ${p.material ? `<p class="hint" style="margin-top:6px">${esc(p.material)}</p>` : ""}
        ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ""}
        <div class="stock ${s.cls}">● ${s.txt}</div>
        ${s.cls === "out" ? `
          <div class="buy-row">${waLink(`Hola BRELLOR, ¿volverán a tener "${p.nombre}"?`) ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(waLink(`Hola BRELLOR, ¿volverán a tener "${p.nombre}"?`))}">Avísame cuando vuelva</a>` : `<button class="btn" disabled>Agotado</button>`}</div>` : `
          <div class="buy-row">
            <div class="qty" aria-label="Cantidad"><button data-q="-1" aria-label="Menos">−</button><span id="qtyVal">1</span><button data-q="1" aria-label="Más">+</button></div>
            <button class="btn" id="addBtn">Agregar al carrito</button>
          </div>`}
      </div>`;
    body.onclick = (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.src) {
        $("#mainImg").src = t.dataset.src;
        body.querySelectorAll(".thumbs button").forEach((b) => b.setAttribute("aria-current", b === t));
      } else if (t.dataset.q) {
        qty = Math.max(1, Math.min(p.existencias, qty + Number(t.dataset.q)));
        $("#qtyVal").textContent = qty;
      } else if (t.id === "addBtn") {
        addToCart(p.id, qty);
      }
    };
    openSheet("#pieceSheet");
    if (location.hash !== `#pieza=${p.id}`) history.replaceState(null, "", `#pieza=${p.id}`);
  }

  // ---------- cart ----------
  function addToCart(id, qty) {
    const p = byId(id);
    const line = state.cart.find((i) => i.id === id);
    const current = line ? line.cantidad : 0;
    const next = Math.min(p.existencias, current + qty);
    if (next === current) { toast(`Ya tienes todas las piezas disponibles de "${p.nombre}"`); return; }
    if (line) line.cantidad = next; else state.cart.push({ id, cantidad: next });
    if (state.step === "hecho") state.step = "lista";
    saveCart();
    renderCartCount();
    toast(`"${p.nombre}" agregado al carrito`);
    closeSheets();
  }

  function cartTotal() {
    return state.cart.reduce((s, i) => s + (byId(i.id)?.precio || 0) * i.cantidad, 0);
  }

  function renderCart() {
    const body = $("#cartBody"), foot = $("#cartFoot");
    if (state.step === "hecho" && state.lastOrder) {
      const o = state.lastOrder;
      $("#cartTitle").textContent = "Pedido recibido";
      const msg = `Hola BRELLOR, acabo de hacer el pedido #${o.folio} por ${money(o.total)}.\n\n${o.lineas}\n\nA nombre de: ${o.nombre}`;
      const wa = waLink(msg);
      body.innerHTML = `<div class="done">
        <div class="eyebrow">Tu número de pedido</div>
        <div class="folio">#${esc(o.folio)}</div>
        <p>Total: <strong>${money(o.total)}</strong></p>
        <p class="hint">${esc(state.ajustes.aviso_pago || "Te contactaremos para el pago y el envío.")}</p>
      </div>`;
      foot.innerHTML = wa
        ? `<a class="btn accent block" href="${esc(wa)}" target="_blank" rel="noopener">Enviar pedido por WhatsApp</a><p class="hint" style="margin-top:10px;text-align:center">Así confirmamos tu pedido más rápido.</p>`
        : `<button class="btn block" data-close>Seguir viendo</button>`;
      return;
    }
    $("#cartTitle").textContent = "Tu carrito";
    if (!state.cart.length) {
      state.step = "lista";
      body.innerHTML = `<div class="done"><p style="font-family:var(--display);font-size:1.5rem;color:var(--navy-900);margin:0 0 8px">Tu carrito está vacío</p><p class="hint">Explora el catálogo y agrega tus piezas favoritas.</p></div>`;
      foot.innerHTML = `<button class="btn block" data-close>Ver catálogo</button>`;
      return;
    }
    const lines = state.cart.map((i) => {
      const p = byId(i.id);
      return `<div class="line">
        <div class="th">${p.fotos?.[0] ? `<img src="${esc(p.fotos[0])}" alt="">` : `<div class="noimg">${GEM}</div>`}</div>
        <div><h4>${esc(p.nombre)}</h4>
          <div class="qty"><button data-line="${esc(p.id)}" data-d="-1" aria-label="Menos">−</button><span>${i.cantidad}</span><button data-line="${esc(p.id)}" data-d="1" aria-label="Más">+</button></div>
        </div>
        <div class="amt">${money(p.precio * i.cantidad)}<button class="link-btn" data-rm="${esc(p.id)}">Quitar</button></div>
      </div>`;
    }).join("");

    if (state.step === "datos") {
      body.innerHTML = `<form class="form" id="orderForm" novalidate>
        <p class="hint">Déjanos tus datos y te contactamos para el pago y el envío.</p>
        <div class="field"><label for="fNombre">Nombre completo</label><input id="fNombre" name="nombre" autocomplete="name" required maxlength="120"></div>
        <div class="field"><label for="fTel">WhatsApp / Teléfono</label><input id="fTel" name="telefono" type="tel" inputmode="tel" autocomplete="tel" required maxlength="30" placeholder="10 dígitos"></div>
        <div class="field"><label for="fCiudad">Ciudad y estado</label><input id="fCiudad" name="ciudad" autocomplete="address-level2" maxlength="120" placeholder="Ej. Mérida, Yucatán"></div>
        <div class="field"><label for="fNotas">Notas (opcional)</label><textarea id="fNotas" name="notas" maxlength="500" placeholder="Talla de anillo, si es regalo, etc."></textarea></div>
        <p class="err" id="formErr" hidden></p>
      </form>`;
      foot.innerHTML = `<div class="total-row"><span>Total</span><strong>${money(cartTotal())}</strong></div>
        <button class="btn block" id="sendOrder">Confirmar pedido</button>
        <p style="text-align:center;margin:10px 0 0"><button class="link-btn" id="backCart">Regresar al carrito</button></p>`;
      return;
    }

    body.innerHTML = lines;
    foot.innerHTML = `<div class="total-row"><span>Total</span><strong>${money(cartTotal())}</strong></div>
      <button class="btn block" id="toForm">Continuar</button>`;
  }

  async function sendOrder() {
    const f = $("#orderForm");
    const err = $("#formErr");
    const data = Object.fromEntries(new FormData(f));
    const tel = String(data.telefono || "").replace(/\D/g, "");
    err.hidden = true;
    if (!String(data.nombre || "").trim()) { err.textContent = "Escribe tu nombre."; err.hidden = false; return; }
    if (tel.length < 10) { err.textContent = "Escribe un teléfono de 10 dígitos."; err.hidden = false; return; }
    const btn = $("#sendOrder");
    btn.disabled = true; btn.textContent = "Enviando…";
    const { data: res, error } = await state.db.rpc("crear_pedido", {
      p_nombre: data.nombre, p_telefono: data.telefono, p_ciudad: data.ciudad || "", p_notas: data.notas || "",
      p_articulos: state.cart.map((i) => ({ id: i.id, cantidad: i.cantidad })),
    });
    if (error) {
      err.textContent = error.message || "No se pudo enviar el pedido. Intenta de nuevo.";
      err.hidden = false; btn.disabled = false; btn.textContent = "Confirmar pedido";
      return;
    }
    const row = Array.isArray(res) ? res[0] : res;
    state.lastOrder = {
      folio: row.o_folio, total: row.o_total, nombre: data.nombre,
      lineas: state.cart.map((i) => `• ${i.cantidad} × ${byId(i.id).nombre}`).join("\n"),
    };
    state.cart = []; saveCart(); renderCartCount();
    state.step = "hecho";
    renderCart();
    // refrescar existencias
    const p = await state.db.from("productos").select("*").eq("publicado", true)
      .order("destacado", { ascending: false }).order("creado", { ascending: false });
    if (!p.error) { state.productos = p.data; renderChips(); renderGrid(); }
  }

  // ---------- routing ----------
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith("cat=")) {
      const c = h.slice(4);
      if (state.categorias.some((x) => x.id === c)) { state.filtro = c; renderChips(); renderGrid(); }
    } else if (h.startsWith("pieza=")) {
      openPiece(h.slice(6));
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-close]") || t.id === "scrim") { closeSheets(); return; }
    const chip = t.closest(".chip");
    if (chip) {
      state.filtro = chip.dataset.cat;
      history.replaceState(null, "", state.filtro === "todo" ? location.pathname : `#cat=${state.filtro}`);
      renderChips(); renderGrid();
      return;
    }
    const navA = t.closest(".main-nav a");
    if (navA) {
      e.preventDefault();
      state.filtro = navA.getAttribute("href").slice(5);
      history.replaceState(null, "", navA.getAttribute("href"));
      renderChips(); renderGrid();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const piece = t.closest(".piece[data-id], .frame[data-id]");
    if (piece) { openPiece(piece.dataset.id); return; }
    if (t.closest("#cartBtn")) {
      if (state.step === "datos" && !state.cart.length) state.step = "lista";
      renderCart(); openSheet("#cartSheet"); return;
    }
    const line = t.closest("[data-line]");
    if (line) {
      const it = state.cart.find((i) => i.id === line.dataset.line);
      const p = byId(it.id);
      it.cantidad = Math.max(1, Math.min(p.existencias, it.cantidad + Number(line.dataset.d)));
      saveCart(); renderCartCount(); renderCart(); return;
    }
    const rm = t.closest("[data-rm]");
    if (rm) { state.cart = state.cart.filter((i) => i.id !== rm.dataset.rm); saveCart(); renderCartCount(); renderCart(); return; }
    if (t.closest("#toForm")) { state.step = "datos"; renderCart(); setTimeout(() => { if (!/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) $("#fNombre")?.focus(); }, 60); return; }
    if (t.closest("#backCart")) { state.step = "lista"; renderCart(); return; }
    if (t.closest("#sendOrder")) { sendOrder(); return; }
  });
  document.addEventListener("submit", (e) => { if (e.target.id === "orderForm") { e.preventDefault(); sendOrder(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });
  window.addEventListener("hashchange", route);

  setupStage();
  observeDepth();
  load();
})();

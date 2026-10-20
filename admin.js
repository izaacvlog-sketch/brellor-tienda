(() => {
  "use strict";
  const CFG = window.BRELLOR_CONFIG;
  const db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
  const GEM = `<div class="noimg"><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M35 10h30l25 25v30L65 90H35L10 65V35z"/></svg></div>`;
  const ESTADOS = ["pendiente", "pagado", "enviado", "entregado", "cancelado"];
  const BRAND = `<a class="brand" href="./" aria-label="Ver tienda"><img class="brand-mark" src="img/logo-blanco.webp" alt="" width="34" height="41"><span class="brand-word">BRELLOR</span></a>`;

  const S = {
    user: null, tab: "inventario",
    categorias: [], productos: [], pedidos: [], ajustes: {},
    q: "", cat: "todas", estadoFiltro: "activos",
    ed: null, // estado del editor
  };

  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.style.background = bad ? "var(--rose)" : "";
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("on"), bad ? 4200 : 2400);
  }
  const catName = (id) => (S.categorias.find((c) => c.id === id) || {}).nombre || id;
  const fail = (e) => { console.error(e); toast(traducir(e?.message || "Algo salió mal"), true); };
  function traducir(m) {
    if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/Email not confirmed/i.test(m)) return "Falta confirmar el correo. Revisa tu bandeja.";
    if (/row-level security|permission denied/i.test(m)) return "Tu usuario no tiene permiso de administrador.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisa tu internet.";
    return m;
  }

  // =================== AUTH ===================
  async function boot() {
    const { data } = await db.auth.getSession();
    if (data.session) await enter(data.session.user);
    else renderLogin();
  }

  function renderLogin(msg) {
    $("#app").innerHTML = `<div class="login">
      <div class="login-art">
        ${BRAND}
        <h1>Tu catálogo,<br><em>siempre al día.</em></h1>
        <p style="margin:0;color:oklch(0.82 0.02 262);max-width:26em">Sube piezas nuevas, ajusta precios y existencias, y revisa tus pedidos. Lo que guardes aquí se publica en la tienda al instante.</p>
      </div>
      <div class="login-form">
        <form id="loginForm" class="form" novalidate>
          <div class="eyebrow">Administración</div>
          <h2>Iniciar sesión</h2>
          <div class="field"><label for="lEmail">Correo</label><input id="lEmail" type="email" autocomplete="username" required></div>
          <div class="field"><label for="lPass">Contraseña</label><input id="lPass" type="password" autocomplete="current-password" required></div>
          <p class="err" id="lErr" ${msg ? "" : "hidden"}>${esc(msg || "")}</p>
          <button class="btn block" id="lBtn">Entrar</button>
          <p style="margin:0;text-align:center"><button type="button" class="link-btn" id="forgot">Olvidé mi contraseña</button></p>
        </form>
      </div>
    </div>`;
    $("#lEmail").focus();
  }

  async function login(e) {
    e.preventDefault();
    const email = $("#lEmail").value.trim(), password = $("#lPass").value;
    const err = $("#lErr"), btn = $("#lBtn");
    if (!email || !password) { err.textContent = "Escribe tu correo y contraseña."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Entrando…";
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) { err.textContent = traducir(error.message); err.hidden = false; btn.disabled = false; btn.textContent = "Entrar"; return; }
    await enter(data.user);
  }

  async function forgot() {
    const email = $("#lEmail").value.trim();
    if (!email) { const e = $("#lErr"); e.textContent = "Escribe tu correo primero."; e.hidden = false; return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    if (error) return fail(error);
    toast("Te enviamos un correo para cambiar la contraseña.");
  }

  async function enter(user) {
    const { data: ok, error } = await db.rpc("es_admin");
    if (error || !ok) {
      await db.auth.signOut();
      renderLogin(error ? "No se pudo verificar el acceso. ¿Ya se corrió el archivo setup.sql en Supabase?" : "Este correo no tiene permiso de administrador.");
      return;
    }
    S.user = user;
    renderShell();
    await loadAll();
  }

  async function logout() { await db.auth.signOut(); S.user = null; renderLogin(); }

  // Cambio de contraseña desde el enlace del correo
  db.auth.onAuthStateChange(async (event) => {
    if (event === "PASSWORD_RECOVERY") {
      const p = prompt("Escribe tu nueva contraseña (mínimo 8 caracteres):");
      if (p && p.length >= 8) {
        const { error } = await db.auth.updateUser({ password: p });
        error ? fail(error) : toast("Contraseña actualizada.");
      }
    }
  });

  // =================== DATA ===================
  async function loadAll() {
    const [c, p, o, a] = await Promise.all([
      db.from("categorias").select("*").order("orden"),
      db.from("productos").select("*").order("creado", { ascending: false }),
      db.from("pedidos").select("*").order("creado", { ascending: false }).limit(300),
      db.from("ajustes").select("*"),
    ]);
    const e = c.error || p.error || o.error || a.error;
    if (e) return fail(e);
    S.categorias = c.data; S.productos = p.data; S.pedidos = o.data;
    S.ajustes = Object.fromEntries(a.data.map((r) => [r.clave, r.valor]));
    renderTab();
  }

  // =================== SHELL ===================
  function renderShell() {
    $("#app").innerHTML = `
      <header class="a-head"><div class="wrap">
        <a class="brand" href="./" target="_blank" rel="noopener"><img class="brand-mark" src="img/logo-blanco.webp" alt="" width="26" height="31" style="width:26px"><span class="brand-word">BRELLOR</span><small>Panel</small></a>
        <nav class="tabs" role="tablist">
          <button role="tab" data-tab="inventario">Inventario</button>
          <button role="tab" data-tab="pedidos">Pedidos<span class="badge" id="pendBadge" hidden></span></button>
          <button role="tab" data-tab="ajustes">Ajustes</button>
        </nav>
        <div class="right"><a href="./" target="_blank" rel="noopener">Ver tienda ↗</a><button id="logout">Salir</button></div>
      </div></header>
      <main class="a-main"><div class="wrap" id="view"><p class="hint">Cargando…</p></div></main>`;
  }

  function renderTab() {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
    const pend = S.pedidos.filter((p) => p.estado === "pendiente").length;
    const badge = $("#pendBadge");
    if (badge) { badge.hidden = !pend; badge.textContent = pend; }
    ({ inventario: renderInventario, pedidos: renderPedidos, ajustes: renderAjustes })[S.tab]();
  }

  // =================== INVENTARIO ===================
  function renderInventario() {
    const all = S.productos;
    const piezas = all.reduce((s, p) => s + p.existencias, 0);
    const valor = all.reduce((s, p) => s + p.existencias * Number(p.precio), 0);
    const agotados = all.filter((p) => p.existencias === 0).length;
    $("#view").innerHTML = `
      <div class="a-title"><h1>Inventario</h1><button class="btn" id="newBtn">+ Nueva pieza</button></div>
      <dl class="stats">
        <div><dt>Modelos</dt><dd>${all.length}</dd></div>
        <div><dt>Piezas en existencia</dt><dd>${piezas}</dd></div>
        <div><dt>Valor del inventario</dt><dd>${money(valor)}</dd></div>
        <div><dt>Agotados</dt><dd class="${agotados ? "warn" : ""}">${agotados}</dd></div>
      </dl>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Buscar por nombre o material…" value="${esc(S.q)}" aria-label="Buscar">
        <select id="catSel" aria-label="Sección">
          <option value="todas">Todas las secciones</option>
          ${S.categorias.map((c) => `<option value="${esc(c.id)}" ${S.cat === c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}
          <option value="agotados" ${S.cat === "agotados" ? "selected" : ""}>Solo agotados</option>
        </select>
      </div>
      <div class="inv" id="inv"></div>`;
    renderRows();
  }

  function renderRows() {
    const q = S.q.toLowerCase();
    const list = S.productos.filter((p) =>
      (S.cat === "todas" || (S.cat === "agotados" ? p.existencias === 0 : p.categoria === S.cat)) &&
      (!q || `${p.nombre} ${p.material} ${p.descripcion}`.toLowerCase().includes(q)));
    const inv = $("#inv");
    if (!S.productos.length) {
      inv.innerHTML = `<div class="empty" style="border:0"><h3>Aún no hay piezas</h3><p>Da clic en <strong>+ Nueva pieza</strong>, sube sus fotos, ponle precio y cuántas tienes. Al guardar aparece en la tienda.</p></div>`;
      return;
    }
    if (!list.length) { inv.innerHTML = `<div class="empty" style="border:0"><p>No hay piezas con ese filtro.</p></div>`; return; }
    inv.innerHTML = `<div class="inv-row head"><span></span><span>Pieza</span><span>Precio</span><span>Existencias</span><span>En tienda</span><span></span></div>` +
      list.map((p) => `<div class="inv-row" data-id="${esc(p.id)}">
        <div class="th">${p.fotos?.[0] ? `<img src="${esc(p.fotos[0])}" alt="" loading="lazy">` : GEM}</div>
        <div class="nm"><strong>${esc(p.nombre)}</strong><span>${esc(catName(p.categoria))}${p.material ? " · " + esc(p.material) : ""}${p.destacado ? " · ★ Destacado" : ""}</span></div>
        <div class="pr">${money(p.precio)}</div>
        <div class="st"><div class="qty ${p.existencias ? "" : "zero"}"><button data-stock="-1" aria-label="Quitar una">−</button><span>${p.existencias}</span><button data-stock="1" aria-label="Agregar una">+</button></div></div>
        <label class="pub"><span class="switch"><input type="checkbox" data-pub ${p.publicado ? "checked" : ""} aria-label="Publicado en tienda"><span></span></span><span>${p.publicado ? "Visible" : "Oculto"}</span></label>
        <div class="ed"><button class="link-btn" data-edit>Editar</button></div>
      </div>`).join("");
  }

  async function quickStock(id, d) {
    const p = S.productos.find((x) => x.id === id);
    const next = Math.max(0, p.existencias + d);
    if (next === p.existencias) return;
    const prev = p.existencias;
    p.existencias = next; renderInventario(); // optimista
    const { error } = await db.from("productos").update({ existencias: next, actualizado: new Date().toISOString() }).eq("id", id);
    if (error) { p.existencias = prev; renderInventario(); fail(error); }
  }

  async function togglePub(id, on) {
    const p = S.productos.find((x) => x.id === id);
    p.publicado = on; renderRows();
    const { error } = await db.from("productos").update({ publicado: on }).eq("id", id);
    if (error) { p.publicado = !on; renderRows(); return fail(error); }
    toast(on ? "Visible en la tienda" : "Oculto de la tienda");
  }

  // =================== EDITOR ===================
  function openEditor(id) {
    const p = id ? S.productos.find((x) => x.id === id) : null;
    S.ed = {
      id: p?.id || null,
      fotos: (p?.fotos || []).map((url) => ({ url })), // {url} existentes o {file, preview} nuevas
      quitadas: [],
    };
    $("#edTitle").textContent = p ? "Editar pieza" : "Nueva pieza";
    $("#edBody").innerHTML = `<form class="form" id="edForm" novalidate>
      <div class="field"><label>Fotos <span style="text-transform:none;letter-spacing:0;font-weight:400">(la primera es la principal)</span></label><div class="photos" id="photos"></div></div>
      <div class="field"><label for="eNombre">Nombre de la pieza</label><input id="eNombre" name="nombre" required maxlength="120" value="${esc(p?.nombre)}" placeholder="Ej. Cadena cubana 5 mm"></div>
      <div class="two">
        <div class="field"><label for="eCat">Sección</label><select id="eCat" name="categoria">${S.categorias.map((c) => `<option value="${esc(c.id)}" ${p?.categoria === c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></div>
        <div class="field"><label for="eMat">Material</label><input id="eMat" name="material" maxlength="80" value="${esc(p?.material)}" placeholder="Ej. Oro 14k, zirconia"></div>
      </div>
      <div class="two">
        <div class="field"><label for="ePrecio">Precio (MXN)</label><input id="ePrecio" name="precio" type="number" inputmode="decimal" min="0" step="0.01" required value="${p ? esc(p.precio) : ""}" placeholder="0"></div>
        <div class="field"><label for="eStock">Piezas en existencia</label><input id="eStock" name="existencias" type="number" inputmode="numeric" min="0" step="1" required value="${p ? esc(p.existencias) : "1"}"></div>
      </div>
      <div class="field"><label for="eDesc">Descripción</label><textarea id="eDesc" name="descripcion" maxlength="1200" placeholder="Medidas, peso, quilataje, tallas disponibles…">${esc(p?.descripcion)}</textarea></div>
      <div class="checks">
        <label><span class="switch"><input type="checkbox" name="publicado" ${!p || p.publicado ? "checked" : ""}><span></span></span>Visible en la tienda</label>
        <label><span class="switch"><input type="checkbox" name="destacado" ${p?.destacado ? "checked" : ""}><span></span></span>Destacada</label>
      </div>
      <p class="err" id="edErr" hidden></p>
    </form>`;
    $("#edFoot").innerHTML = `<div class="foot-row">
      ${p ? `<button class="link-btn danger" id="delBtn">Eliminar</button>` : ""}
      <button class="btn" id="saveBtn">${p ? "Guardar cambios" : "Publicar pieza"}</button></div>`;
    renderPhotos();
    $("#scrim").classList.add("on");
    const s = $("#editor"); s.classList.add("on"); s.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeEditor() {
    if (S.ed) S.ed.fotos.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    S.ed = null;
    const s = $("#editor"); s.classList.remove("on"); s.setAttribute("aria-hidden", "true");
    $("#scrim").classList.remove("on");
    document.body.style.overflow = "";
  }

  function renderPhotos() {
    const f = S.ed.fotos;
    $("#photos").innerHTML = f.map((x, i) => `<div class="photo">
      <img src="${esc(x.preview || x.url)}" alt="">
      ${i === 0 ? `<span class="main-tag">Principal</span>` : ""}
      <div class="ctl">
        <button type="button" data-mv="-1" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Mover a la izquierda">←</button>
        <button type="button" data-del="${i}" aria-label="Quitar foto">×</button>
        <button type="button" data-mv="1" data-i="${i}" ${i === f.length - 1 ? "disabled" : ""} aria-label="Mover a la derecha">→</button>
      </div></div>`).join("") +
      (f.length < 8 ? `<label class="drop" id="drop"><input type="file" id="fileIn" accept="image/*" multiple><span><b>+</b>Agregar fotos</span></label>` : "");
  }

  function addFiles(files) {
    const room = 8 - S.ed.fotos.length;
    [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, room)
      .forEach((file) => S.ed.fotos.push({ file, preview: URL.createObjectURL(file) }));
    renderPhotos();
  }

  async function compress(file) {
    try {
      const bmp = await createImageBitmap(file);
      const max = 1600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.86));
      if (blob && blob.type === "image/webp") return { blob, ext: "webp", type: "image/webp" };
      const jpg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      return { blob: jpg, ext: "jpg", type: "image/jpeg" };
    } catch {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      return { blob: file, ext, type: file.type || "image/jpeg" };
    }
  }

  const pathFromUrl = (url) => {
    const m = String(url).split(`/object/public/${CFG.BUCKET}/`)[1];
    return m ? decodeURIComponent(m.split("?")[0]) : null;
  };

  async function save() {
    const f = $("#edForm"), err = $("#edErr"), btn = $("#saveBtn");
    const fd = new FormData(f);
    const row = {
      nombre: String(fd.get("nombre") || "").trim(),
      categoria: fd.get("categoria"),
      material: String(fd.get("material") || "").trim(),
      precio: Number(fd.get("precio")),
      existencias: Math.floor(Number(fd.get("existencias"))),
      descripcion: String(fd.get("descripcion") || "").trim(),
      publicado: fd.get("publicado") === "on",
      destacado: fd.get("destacado") === "on",
      actualizado: new Date().toISOString(),
    };
    err.hidden = true;
    const bad = !row.nombre ? "Ponle nombre a la pieza." :
      !(row.precio >= 0) || fd.get("precio") === "" ? "Escribe el precio." :
      !(row.existencias >= 0) || fd.get("existencias") === "" ? "Escribe cuántas piezas hay." : "";
    if (bad) { err.textContent = bad; err.hidden = false; return; }

    btn.disabled = true;
    try {
      const id = S.ed.id || crypto.randomUUID();
      const urls = [];
      let n = 0;
      const nuevas = S.ed.fotos.filter((x) => x.file).length;
      for (const x of S.ed.fotos) {
        if (x.url) { urls.push(x.url); continue; }
        n++; btn.textContent = `Subiendo foto ${n} de ${nuevas}…`;
        const { blob, ext, type } = await compress(x.file);
        const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const up = await db.storage.from(CFG.BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
        if (up.error) throw up.error;
        urls.push(db.storage.from(CFG.BUCKET).getPublicUrl(path).data.publicUrl);
      }
      btn.textContent = "Guardando…";
      row.fotos = urls;
      const res = S.ed.id
        ? await db.from("productos").update(row).eq("id", id).select().single()
        : await db.from("productos").insert({ ...row, id }).select().single();
      if (res.error) throw res.error;
      // borrar del almacenamiento las fotos que se quitaron
      const paths = S.ed.quitadas.map(pathFromUrl).filter(Boolean);
      if (paths.length) db.storage.from(CFG.BUCKET).remove(paths);
      const i = S.productos.findIndex((x) => x.id === id);
      if (i >= 0) S.productos[i] = res.data; else S.productos.unshift(res.data);
      const wasNew = !S.ed.id;
      closeEditor();
      renderInventario();
      toast(wasNew ? (row.publicado ? "Pieza publicada en la tienda" : "Pieza guardada (oculta)") : "Cambios guardados");
    } catch (e) {
      err.textContent = traducir(e.message || "No se pudo guardar"); err.hidden = false;
      btn.disabled = false; btn.textContent = S.ed?.id ? "Guardar cambios" : "Publicar pieza";
    }
  }

  async function removeProduct() {
    const p = S.productos.find((x) => x.id === S.ed.id);
    if (!confirm(`¿Eliminar "${p.nombre}" de forma permanente? También se borran sus fotos.`)) return;
    const { error } = await db.from("productos").delete().eq("id", p.id);
    if (error) return fail(error);
    const paths = (p.fotos || []).map(pathFromUrl).filter(Boolean);
    if (paths.length) db.storage.from(CFG.BUCKET).remove(paths);
    S.productos = S.productos.filter((x) => x.id !== p.id);
    closeEditor(); renderInventario(); toast("Pieza eliminada");
  }

  // =================== PEDIDOS ===================
  function renderPedidos() {
    const list = S.pedidos.filter((o) =>
      S.estadoFiltro === "todos" ? true :
      S.estadoFiltro === "activos" ? !["entregado", "cancelado"].includes(o.estado) : o.estado === S.estadoFiltro);
    const fecha = (d) => new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const wa = (t) => { let d = String(t).replace(/\D/g, ""); if (d.length === 10) d = "52" + d; return `https://wa.me/${d}`; };
    $("#view").innerHTML = `
      <div class="a-title"><h1>Pedidos</h1>
        <select id="estSel" aria-label="Filtrar pedidos" style="border:1px solid var(--paper-300);background:var(--paper-50);padding:10px 12px">
          <option value="activos">Por atender</option><option value="todos">Todos</option>
          ${ESTADOS.map((e) => `<option value="${e}">${e[0].toUpperCase() + e.slice(1)}s</option>`).join("")}
        </select></div>
      <div class="orders">${list.length ? list.map((o) => `<article class="order ${o.estado}" data-id="${esc(o.id)}">
        <div>
          <h3>#${esc(o.folio)} <small>${fecha(o.creado)}</small> <span class="pill ${o.estado}">${o.estado}</span></h3>
          <div class="who">${esc(o.cliente_nombre)} · <a href="${esc(wa(o.cliente_telefono))}" target="_blank" rel="noopener">${esc(o.cliente_telefono)}</a>${o.cliente_ciudad ? " · " + esc(o.cliente_ciudad) : ""}</div>
          <ul>${(o.articulos || []).map((a) => `<li><span>${esc(a.cantidad)} ×</span><span>${esc(a.nombre)}</span><span style="margin-left:auto;color:var(--ink-soft)">${money(a.precio * a.cantidad)}</span></li>`).join("")}</ul>
        </div>
        <div>
          <div class="total">${money(o.total)}</div>
          ${o.estado === "cancelado" ? "" : `<select data-estado aria-label="Estado del pedido">${ESTADOS.map((e) => `<option value="${e}" ${o.estado === e ? "selected" : ""}>${e[0].toUpperCase() + e.slice(1)}</option>`).join("")}</select>`}
        </div>
        ${o.notas ? `<p class="notes">${esc(o.notas)}</p>` : ""}
      </article>`).join("") : `<div class="empty"><h3>Sin pedidos aquí</h3><p>Cuando alguien compre en la tienda, su pedido aparece en esta lista y las existencias se descuentan solas.</p></div>`}</div>`;
    $("#estSel").value = S.estadoFiltro;
  }

  async function setEstado(sel) {
    const id = sel.closest(".order").dataset.id;
    const o = S.pedidos.find((x) => x.id === id);
    const nuevo = sel.value;
    if (nuevo === "cancelado" && !confirm(`¿Cancelar el pedido #${o.folio}? Las piezas regresan al inventario.`)) { sel.value = o.estado; return; }
    const { error } = await db.rpc("cambiar_estado_pedido", { p_id: id, p_estado: nuevo });
    if (error) { sel.value = o.estado; return fail(error); }
    o.estado = nuevo;
    if (nuevo === "cancelado") {
      const p = await db.from("productos").select("*").order("creado", { ascending: false });
      if (!p.error) S.productos = p.data;
    }
    renderTab();
    toast(`Pedido #${o.folio}: ${nuevo}`);
  }

  // =================== AJUSTES ===================
  function renderAjustes() {
    const a = S.ajustes;
    $("#view").innerHTML = `
      <div class="a-title"><h1>Ajustes de la tienda</h1></div>
      <form class="panel form" id="ajForm" novalidate>
        <div class="field"><label for="aWa">WhatsApp de la tienda</label><input id="aWa" name="whatsapp" type="tel" value="${esc(a.whatsapp)}" placeholder="10 dígitos, ej. 9991234567"><p class="hint">A este número llegan los pedidos y las preguntas de los clientes.</p></div>
        <div class="field"><label for="aIg">Instagram</label><input id="aIg" name="instagram" value="${esc(a.instagram)}" placeholder="brellor_mx"></div>
        <div class="field"><label for="aUb">Ubicaciones</label><input id="aUb" name="ubicaciones" value="${esc(a.ubicaciones)}" placeholder="Mérida, Yucatán · Tapachula, Chiapas"><p class="hint">Separa cada ciudad con un punto medio (·).</p></div>
        <div class="field"><label for="aAv">Mensaje al terminar un pedido</label><textarea id="aAv" name="aviso_pago">${esc(a.aviso_pago)}</textarea></div>
        <div><button class="btn" id="ajBtn">Guardar ajustes</button></div>
      </form>`;
  }

  async function saveAjustes(e) {
    e.preventDefault();
    const fd = new FormData($("#ajForm"));
    const rows = [...fd.entries()].map(([clave, valor]) => ({ clave, valor: String(valor).trim() }));
    const { error } = await db.from("ajustes").upsert(rows);
    if (error) return fail(error);
    rows.forEach((r) => (S.ajustes[r.clave] = r.valor));
    toast("Ajustes guardados");
  }

  // =================== EVENTS ===================
  document.addEventListener("submit", (e) => {
    if (e.target.id === "loginForm") return login(e);
    if (e.target.id === "ajForm") return saveAjustes(e);
    if (e.target.id === "edForm") { e.preventDefault(); save(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.id === "forgot") return forgot();
    if (t.id === "logout") return logout();
    const tab = t.closest("[data-tab]");
    if (tab) { S.tab = tab.dataset.tab; return renderTab(); }
    if (t.closest("#newBtn")) return openEditor(null);
    if (t.closest("[data-edit]")) return openEditor(t.closest(".inv-row").dataset.id);
    const st = t.closest("[data-stock]");
    if (st) return quickStock(st.closest(".inv-row").dataset.id, Number(st.dataset.stock));
    if (t.closest("[data-close]") || t.id === "scrim") return closeEditor();
    if (t.closest("#saveBtn")) return save();
    if (t.closest("#delBtn")) return removeProduct();
    const mv = t.closest("[data-mv]");
    if (mv) {
      const i = Number(mv.dataset.i), j = i + Number(mv.dataset.mv), f = S.ed.fotos;
      [f[i], f[j]] = [f[j], f[i]]; return renderPhotos();
    }
    const del = t.closest("[data-del]");
    if (del) {
      const [x] = S.ed.fotos.splice(Number(del.dataset.del), 1);
      if (x.url) S.ed.quitadas.push(x.url); else URL.revokeObjectURL(x.preview);
      return renderPhotos();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fileIn") { addFiles(t.files); t.value = ""; }
    else if (t.matches("[data-pub]")) togglePub(t.closest(".inv-row").dataset.id, t.checked);
    else if (t.id === "catSel") { S.cat = t.value; renderRows(); }
    else if (t.id === "estSel") { S.estadoFiltro = t.value; renderPedidos(); }
    else if (t.matches("[data-estado]")) setEstado(t);
  });
  document.addEventListener("input", (e) => { if (e.target.id === "q") { S.q = e.target.value; renderRows(); } });
  document.addEventListener("dragover", (e) => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
  document.addEventListener("dragleave", (e) => { e.target.closest?.("#drop")?.classList.remove("over"); });
  document.addEventListener("drop", (e) => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.ed) closeEditor(); });

  boot().catch(fail);
})();

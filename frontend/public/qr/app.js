// หน้าสั่งอาหารที่โต๊ะ (ลูกค้า) — คุยกับ backend/src/routes/qr-public.routes.ts ผ่าน /qr/api
// vanilla JS ไฟล์เดียว: CSP ของระบบห้าม inline script และมือถือลูกค้าไม่ควรต้องโหลด bundle ของ ERP
(function () {
  'use strict'
  var $ = function (s, r) { return (r || document).querySelector(s) }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  var baht = function (n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) }
  var POLL_MS = 10000
  var MAX_QTY = 50

  var token = new URLSearchParams(location.search).get('t') || ''
  var store = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem('qr:' + token + ':' + k)) } catch (e) { return null } },
    set: function (k, v) { try { sessionStorage.setItem('qr:' + token + ':' + k, JSON.stringify(v)) } catch (e) { /* โหมดส่วนตัว: ไม่จำตะกร้าก็ยังสั่งได้ */ } },
  }

  var S = {
    data: null,        // ผลจาก /session
    error: null,       // { code, message } ตอนโหลดไม่ได้
    tab: 'menu',
    cart: store.get('cart') || {},   // { menuId: { qty, note } }
    sending: false,
    memberAsked: !!store.get('memberAsked'),  // ถาม pop-up สมาชิกครั้งเดียวต่อรอบโต๊ะ
    attachTried: false,
    ledger: null,
  }
  var saveCart = function () { store.set('cart', S.cart) }

  var ICONS = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    bill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></svg>',
    me: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
  }
  var loyaltyOn = function () { return !!(S.data && S.data.loyalty && S.data.loyalty.enabled) }
  var ITEM_STATUS = {
    PENDING: ['รอครัว', 'wait'], PREPARING: ['กำลังทำ', 'cook'], READY: ['พร้อมเสิร์ฟ', 'ok'], SERVED: ['เสิร์ฟแล้ว', 'ok'],
  }

  // ---------- api ----------
  function api(method, path, body) {
    return fetch('/qr/api' + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(Object.assign({ t: token }, body)) : undefined,
      cache: 'no-store',
    }).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (j) { return { ok: res.ok, status: res.status, body: j } })
    })
  }

  var loading = false
  function load() {
    if (loading) return Promise.resolve()
    loading = true
    return fetch('/qr/api/session?t=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {} }).then(function (j) { return { ok: res.ok, body: j } }) })
      .then(function (r) {
        if (!r.ok) { S.error = { code: r.body.code, message: r.body.message || 'โหลดไม่สำเร็จ' }; S.data = null; return }
        var prev = S.data && S.data.state
        S.error = null
        S.data = r.body.data
        if (S.data.state === 'open') store.set('wasOpen', true)
        if (prev === 'open' && S.data.state !== 'open') { S.cart = {}; saveCart(); closeSheet() }
        pruneCart()
        afterLoad()
      })
      .catch(function () {
        // เน็ตหลุดชั่วคราว: คงหน้าจอเดิมไว้ รอบหน้าโหลดใหม่เอง
        if (!S.data) S.error = { code: 'NETWORK', message: 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }
      })
      .then(function () { loading = false; render() })
  }

  // เครื่องที่เคยผูกเบอร์ไว้ → ให้บิลโต๊ะนี้สะสมแต้มอัตโนมัติ · ยังไม่เคย → ชวนสมัครครั้งเดียวต่อรอบโต๊ะ
  function afterLoad() {
    var d = S.data
    if (!d || d.state !== 'open' || !loyaltyOn()) return
    if (d.member && !d.billMember && !S.attachTried) { S.attachTried = true; attachMember() }
    else if (!d.member && !d.billMember && !S.memberAsked && $('#sheet').hidden) {
      S.memberAsked = true; store.set('memberAsked', true)
      setTimeout(function () { openMemberSheet() }, 400)
    }
  }

  function attachMember() {
    api('POST', '/member', {}).then(function (r) {
      if (!r.ok || !r.body.data.linked) return
      var m = r.body.data.member
      toast(m.status === 'verified'
        ? 'ยินดีต้อนรับกลับ คุณ' + m.name + ' · ' + m.points.toLocaleString('th-TH') + ' แต้ม — บิลนี้สะสมแต้มให้คุณแล้ว'
        : 'บิลนี้สะสมแต้มให้เบอร์ ' + m.phone + ' แล้ว')
      return load()
    }).catch(function () { /* รอบหน้าค่อยลองใหม่ ไม่กวนลูกค้า */ S.attachTried = false })
  }

  // เมนูที่ร้านปิด/หมดระหว่างที่ลูกค้าเลือกอยู่ → เอาออกจากตะกร้า
  function pruneCart() {
    if (!S.data || !S.data.menu) return
    var avail = {}
    S.data.menu.forEach(function (m) { if (m.available) avail[m.id] = 1 })
    var removed = Object.keys(S.cart).filter(function (id) { return !avail[id] })
    removed.forEach(function (id) { delete S.cart[id] })
    if (removed.length) { saveCart(); toast('มีเมนูที่หมดแล้ว เอาออกจากตะกร้าให้แล้ว') }
  }

  // ---------- helpers ----------
  var menuById = function (id) { return (S.data && S.data.menu || []).filter(function (m) { return m.id === id })[0] }
  var cartCount = function () { return Object.keys(S.cart).reduce(function (a, id) { return a + S.cart[id].qty }, 0) }
  var cartSum = function () {
    return Object.keys(S.cart).reduce(function (a, id) { var m = menuById(id); return a + (m ? m.price * S.cart[id].qty : 0) }, 0)
  }
  var initial = function (name) { return String(name || '?').replace(/^[เแโใไ]/, '').charAt(0) }
  // CSP ของระบบอนุญาตรูปจากโดเมนตัวเองเท่านั้น — URL ภายนอกใช้ตัวอักษรแทน
  var safeImage = function (u) { return typeof u === 'string' && /^\/(?!\/)/.test(u) ? u : '' }

  var toastTimer
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show')
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show') }, 2800)
  }

  // ---------- render ----------
  function render() {
    var app = $('#app')
    if (!token) { app.innerHTML = stateScreen('!', '', 'ไม่พบ QR', 'กรุณาสแกน QR ที่โต๊ะอีกครั้ง'); return }
    if (S.error) {
      app.innerHTML = stateScreen('!', '', S.error.code === 'QR_NOT_FOUND' ? 'QR นี้ใช้ไม่ได้แล้ว' : 'ยังสั่งไม่ได้', S.error.message, true)
      return
    }
    if (!S.data) return
    var d = S.data, tableName = d.table && d.table.name ? 'โต๊ะ ' + d.table.name : ''
    if (d.state === 'not_open') {
      app.innerHTML = store.get('wasOpen')
        ? stateScreen('✓', 'ok', 'ชำระเงินเรียบร้อย', 'ขอบคุณที่มาทานที่ ' + (d.shop.name || 'ร้านเรา') + ' แล้วพบกันใหม่นะครับ')
        : stateScreen('!', 'info', tableName + ' ยังไม่เปิด', 'กรุณาแจ้งพนักงานหรือแคชเชียร์ให้เปิดโต๊ะก่อน แล้วกดลองอีกครั้ง', true)
      return
    }
    if (d.state === 'rotate_only') {
      app.innerHTML = stateScreen('!', 'info', 'ใช้ QR ใบที่พนักงานวางให้', 'ร้านนี้เปลี่ยน QR ทุกครั้งที่เปิดโต๊ะ กรุณาสแกน QR บนใบที่พิมพ์มาตอนเปิดโต๊ะ')
      return
    }
    if (d.state === 'closed') {
      app.innerHTML = stateScreen('✓', 'ok', 'ปิดบิล' + (tableName ? tableName : '') + 'แล้ว',
        (d.bill && d.bill.paid ? 'ยอดชำระ ' + baht(d.bill.total) + ' · ' : '') + 'ขอบคุณที่มาทานที่ ' + (d.shop.name || 'ร้านเรา'))
      return
    }
    var keep = window.scrollY
    var prevTab = app.dataset.tab
    if (S.tab === 'me' && !loyaltyOn()) S.tab = 'menu'
    var body = S.tab === 'bill' ? billTab(d) : S.tab === 'me' ? meTab(d) : menuTab(d)
    app.innerHTML = header(d, tableName) + '<main class="body">' + body + '</main>' + bottom()
    app.dataset.tab = S.tab
    document.documentElement.style.setProperty('--head-h', $('.head').offsetHeight + 'px')
    if (prevTab === S.tab) window.scrollTo(0, keep)
  }

  function stateScreen(icon, kind, title, text, retry) {
    return '<div class="state"><div class="ico ' + kind + '" aria-hidden="true">' + icon + '</div><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      (retry ? '<button class="btn primary" data-act="reload">ลองอีกครั้ง</button>' : '') + '</div>'
  }

  function header(d, tableName) {
    var m = d.member, chip = ''
    if (loyaltyOn()) {
      chip = !m ? '<button class="chip join" data-act="member-open">สมัครสมาชิก</button>'
        : m.status === 'verified' ? '<button class="chip pts num" data-act="tab" data-id="me">' + m.points.toLocaleString('th-TH') + ' แต้ม</button>'
        : '<button class="chip wait" data-act="tab" data-id="me">รอยืนยันสมาชิก</button>'
    }
    return '<header class="head"><div class="shop"><b>' + esc(d.shop.name || 'เมนู') + '</b><span>สั่งอาหารจากโต๊ะได้เลย ไม่ต้องลงแอป</span></div>' +
      chip + (tableName ? '<span class="table-chip">' + esc(d.table.name) + '</span>' : '') + '</header>'
  }

  function groups(menu) {
    var order = [], by = {}
    menu.forEach(function (m) {
      var k = m.category_id || '_'
      if (!by[k]) { by[k] = { id: k, name: m.category_name || 'เมนูอื่น ๆ', items: [] }; order.push(k) }
      by[k].items.push(m)
    })
    return order.map(function (k) { return by[k] })
  }

  function stepper(m) {
    if (!m.available) return '<span class="badge out">หมด</span>'
    var q = S.cart[m.id] ? S.cart[m.id].qty : 0
    var name = esc(m.name)
    if (!q) return '<div class="stepper"><button class="add" data-act="inc" data-id="' + esc(m.id) + '" aria-label="เพิ่ม ' + name + '">+</button></div>'
    return '<div class="stepper"><button data-act="dec" data-id="' + esc(m.id) + '" aria-label="ลด ' + name + '">−</button>' +
      '<span class="q num" aria-label="จำนวน">' + q + '</span>' +
      '<button class="add" data-act="inc" data-id="' + esc(m.id) + '" aria-label="เพิ่ม ' + name + '"' + (q >= MAX_QTY ? ' disabled' : '') + '>+</button></div>'
  }

  function menuTab(d) {
    var gs = groups(d.menu || [])
    if (!gs.length) return '<div class="state"><p>ร้านยังไม่ได้เปิดเมนูให้สั่งผ่าน QR</p></div>'
    var h = gs.length > 1 ? '<nav class="cats" id="cats" aria-label="หมวดเมนู">' + gs.map(function (g, i) {
      return '<button data-act="cat" data-id="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(g.name) + '</button>'
    }).join('') + '</nav>' : ''
    gs.forEach(function (g, i) {
      h += '<h2 class="cat-h" id="cat-' + i + '">' + esc(g.name) + '</h2>'
      g.items.forEach(function (m) {
        var img = safeImage(m.image)
        h += '<div class="item' + (m.available ? '' : ' out') + '"><div class="tile" aria-hidden="true">' +
          (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" width="64" height="64">' : esc(initial(m.name))) + '</div>' +
          '<div><div class="item-name">' + esc(m.name) + '</div>' + (m.description ? '<div class="item-desc">' + esc(m.description) + '</div>' : '') +
          '<div class="item-price num">' + baht(m.price) + (m.available ? '' : ' · <span class="muted">หมดวันนี้</span>') + '</div></div>' +
          stepper(m) + '</div>'
      })
    })
    return h
  }

  function billTab(d) {
    var b = d.bill || { items: [] }
    var h = '<div class="pad">'
    if (b.billRequested) h += '<div class="banner" role="status">เรียกเช็คบิลแล้ว พนักงานกำลังมา ระหว่างนี้ยังสั่งเพิ่มได้</div>'

    h += '<span class="h-sm">ตะกร้า (ยังไม่ส่ง)</span>'
    var ids = Object.keys(S.cart)
    if (!ids.length) h += '<div class="card muted">ยังไม่มีรายการ เลือกจากแท็บเมนูได้เลย</div>'
    else {
      h += '<div class="card">'
      ids.forEach(function (id) {
        var m = menuById(id); if (!m) return
        var c = S.cart[id]
        h += '<div class="line"><div><div class="nm">' + esc(m.name) + '</div><div class="small muted num">' + baht(m.price * c.qty) + '</div></div>' + stepper(m) +
          '<input class="note-in" data-note="' + esc(id) + '" maxlength="100" placeholder="หมายเหตุ เช่น ไม่เผ็ด ไม่ใส่ผัก" value="' + esc(c.note || '') + '" aria-label="หมายเหตุ ' + esc(m.name) + '"></div>'
      })
      h += '<div class="row total"><span>รวมรอบนี้</span><span class="num">' + baht(cartSum()) + '</span></div>' +
        '<button class="btn primary block" data-act="send"' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'กำลังส่ง…' : 'ส่งออเดอร์เข้าครัว') + '</button></div>'
    }

    if (b.items && b.items.length) {
      h += '<span class="h-sm">สั่งไปแล้ว</span><div class="card">'
      b.items.forEach(function (it) {
        var st = ITEM_STATUS[it.status] || ITEM_STATUS.PENDING
        h += '<div class="line"><div><div class="nm">' + esc(it.name) + ' × ' + it.qty + '</div>' +
          (it.note ? '<div class="small muted">' + esc(it.note) + '</div>' : '') + '</div>' +
          '<div style="text-align:right"><div class="num">' + baht(it.total) + '</div><span class="badge ' + st[1] + '">' + st[0] + '</span></div></div>'
      })
      h += '<div class="row muted"><span>ค่าอาหาร</span><span class="num">' + baht(b.subtotal) + '</span></div>'
      if (b.service) h += '<div class="row muted"><span>ค่าบริการ</span><span class="num">' + baht(b.service) + '</span></div>'
      if (b.extra) h += '<div class="row muted"><span>ค่าใช้จ่ายอื่น</span><span class="num">' + baht(b.extra) + '</span></div>'
      if (b.discount) h += '<div class="row muted"><span>ส่วนลด</span><span class="num">−' + baht(b.discount) + '</span></div>'
      if (b.tax) h += '<div class="row muted"><span>VAT</span><span class="num">' + baht(b.tax) + '</span></div>'
      h += '<div class="row total"><span>ยอดบิลตอนนี้</span><span class="num">' + baht(b.total) + '</span></div></div>'
      h += earnCard(d, b)
      if (!b.billRequested) h += '<button class="btn mango block" data-act="call-bill">เรียกเช็คบิล</button>'
      h += '<p class="small muted" style="margin:0;text-align:center">ชำระเงินที่แคชเชียร์ · ยอดอาจปรับตามส่วนลดหน้าเคาน์เตอร์</p>'
    }
    return h + '</div>'
  }

  // แต้มคิดจากยอดบิลหลังส่วนลด เข้าบัญชีเมื่อแคชเชียร์รับชำระ (ยอดจริงอาจต่างถ้าเคาน์เตอร์ให้ส่วนลดเพิ่ม)
  function earnCard(d, b) {
    if (!loyaltyOn() || !(b.total > 0)) return ''
    var earn = Math.floor(b.total / d.loyalty.earnRate)
    if (d.billMember && d.billMember.mine) return '<div class="card earn"><div class="row"><span>บิลนี้จะได้</span><span class="num">+' + earn + ' แต้ม</span></div><span class="small">แต้มเข้าบัญชีเมื่อชำระเงินที่แคชเชียร์</span></div>'
    if (d.billMember) return '<p class="small muted" style="margin:0">บิลนี้มีสมาชิกคนอื่นสะสมแต้มอยู่แล้ว</p>'
    return '<div class="card"><span class="h-sm">สมัครตอนนี้ บิลนี้ได้ ' + earn + ' แต้ม</span><span class="small muted">ใช้แค่เบอร์โทร ไม่ต้องลงแอป</span>' +
      '<button class="btn primary" data-act="member-open">สมัครด้วยเบอร์โทร</button></div>'
  }

  function meTab(d) {
    var m = d.member, h = '<div class="pad">'
    if (!m) {
      return h + '<div class="card"><span class="h-sm">ยังไม่ได้เป็นสมาชิก</span><span class="small muted">สมัครด้วยเบอร์โทร สะสมแต้มทุกบิล ทุก ' + baht(d.loyalty.earnRate) +
        ' ได้ 1 แต้ม ครั้งหน้าสแกน QR แล้วระบบจำคุณได้ทันที</span><button class="btn primary" data-act="member-open">สมัครสมาชิก</button></div></div>'
    }
    if (m.status !== 'verified') {
      return h + '<div class="card"><span class="h-sm">สมัครแล้ว · ' + esc(m.phone) + '</span>' +
        '<span class="small muted">สะสมแต้มได้แล้ว แต้มเข้าเมื่อชำระเงิน</span>' +
        '<div class="banner">ตอนจ่ายเงิน บอกแคชเชียร์ว่าสมัครผ่าน QR เพื่อยืนยันตัวตนครั้งเดียว หลังจากนั้นเครื่องนี้จะดูแต้มและแลกแต้มได้</div></div>' +
        '<button class="btn ghost block" data-act="logout">ไม่ใช่เบอร์ของฉัน / ออกจากระบบ</button></div>'
    }
    h += '<div class="card member"><small>' + esc(m.phone) + '</small><div class="big num">' + m.points.toLocaleString('th-TH') + ' แต้ม</div><small>คุณ' + esc(m.name) + '</small></div>'
    h += '<span class="h-sm">ประวัติแต้ม</span><div class="card">'
    if (!S.ledger) { h += '<span class="small muted">กำลังโหลด…</span>'; setTimeout(loadLedger, 0) }
    else if (!S.ledger.length) h += '<span class="small muted">ยังไม่มีรายการ</span>'
    else S.ledger.forEach(function (l) {
      h += '<div class="line"><div><div>' + esc(l.note || (l.points >= 0 ? 'ได้แต้ม' : 'ใช้แต้ม')) + '</div><div class="small muted">' +
        esc(new Date(l.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })) + '</div></div>' +
        '<span class="num ' + (l.points >= 0 ? 'plus' : 'minus') + '">' + (l.points >= 0 ? '+' : '−') + Math.abs(l.points) + '</span></div>'
    })
    h += '</div><label class="check card"><input type="checkbox" data-consent' + (m.marketing ? ' checked' : '') + '> รับข่าวโปรโมชันจากร้าน (ถอนได้ทุกเมื่อ)</label>'
    h += '<button class="btn ghost block" data-act="logout">ออกจากระบบบนเครื่องนี้</button>'
    h += '<button class="btn ghost block" data-act="delete-open" style="color:var(--danger-strong)">ขอลบข้อมูลสมาชิก</button>'
    return h + '</div>'
  }

  function bottom() {
    var n = cartCount()
    var bar = S.tab === 'menu' && n
      ? '<button class="cartbar" data-act="tab" data-id="bill"><span>ตะกร้า ' + n + ' รายการ</span><span class="num">' + baht(cartSum()) + ' →</span></button>' : ''
    var tabs = [['menu', 'เมนู'], ['bill', 'บิล']].concat(loyaltyOn() ? [['me', 'สมาชิก']] : [])
    var nav = '<nav class="nav" style="--tabs:' + tabs.length + '" aria-label="เมนูหลัก">' + tabs.map(function (t) {
      return '<button data-act="tab" data-id="' + t[0] + '"' + (S.tab === t[0] ? ' class="on" aria-current="page"' : '') + '>' + ICONS[t[0]] +
        '<span>' + t[1] + '</span>' + (t[0] === 'bill' && n ? '<span class="dot">' + n + '</span>' : '') + '</button>'
    }).join('') + '</nav>'
    return '<div class="bottom">' + bar + nav + '</div>'
  }

  function closeSheet() { $('#sheet').hidden = true }

  // ---------- sheet (สมัครสมาชิก) — PDPA: ความยินยอม 2 ข้อแยกกัน ไม่ติ๊กไว้ให้ล่วงหน้า ----------
  function openMemberSheet() {
    var shop = S.data && S.data.shop.name ? S.data.shop.name : 'ร้าน'
    $('#sheet-body').innerHTML = '<h2 id="sheet-title">รับแต้มทุกครั้งที่มาทาน</h2>' +
      '<p>สมัครด้วยเบอร์โทร ไม่ต้องลงแอป ทุก ' + baht(S.data.loyalty.earnRate) + ' ได้ 1 แต้ม</p>' +
      '<label for="m-phone">เบอร์มือถือ</label><input type="tel" id="m-phone" inputmode="numeric" maxlength="12" autocomplete="tel" placeholder="08x-xxx-xxxx">' +
      '<label for="m-name">ชื่อเล่น (ไม่บังคับ)</label><input type="text" id="m-name" maxlength="30" autocomplete="nickname" placeholder="ให้ร้านทักคุณด้วยชื่อนี้">' +
      '<label class="check"><input type="checkbox" id="m-c1"> ยินยอมให้' + esc(shop) + 'เก็บเบอร์โทรเพื่อสะสมและแลกแต้ม (จำเป็น)</label>' +
      '<label class="check"><input type="checkbox" id="m-c2"> รับข่าวโปรโมชันจากร้าน (ไม่บังคับ)</label>' +
      '<p class="fine">' + esc(shop) + ' ใช้เบอร์นี้เพื่อสะสม/แลกแต้มเท่านั้น ถอนความยินยอมหรือขอลบข้อมูลได้ที่แท็บสมาชิก</p>' +
      '<div class="err" id="m-err" role="alert"></div>' +
      '<button class="btn primary block" data-act="m-join">สมัครและสะสมแต้ม</button>' +
      '<button class="btn ghost block" data-act="sheet-close">ไว้ทีหลัง สั่งอาหารเลย</button>'
    $('#sheet').hidden = false
    setTimeout(function () { var i = $('#m-phone'); if (i) i.focus({ preventScroll: true }) }, 50)
  }

  function joinMember() {
    var phone = ($('#m-phone').value || '').replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0')
    var err = $('#m-err')
    if (!/^0[689]\d{8}$/.test(phone)) { err.textContent = 'ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09'; return }
    if (!$('#m-c1').checked) { err.textContent = 'ต้องติ๊กยินยอมข้อแรกก่อน ร้านจึงเก็บแต้มให้ได้'; return }
    var btn = $('[data-act="m-join"]'); btn.disabled = true
    api('POST', '/member', { phone: phone, name: $('#m-name').value || '', consentPoints: true, consentMarketing: $('#m-c2').checked })
      .then(function (r) {
        if (!r.ok) { err.textContent = r.body.message || 'สมัครไม่สำเร็จ ลองอีกครั้ง'; btn.disabled = false; return }
        closeSheet()
        toast(r.body.data.linked ? 'สมัครแล้ว บิลนี้สะสมแต้มให้เบอร์ ' + r.body.data.member.phone : 'สมัครแล้ว (บิลนี้มีสมาชิกอีกคนสะสมแต้มอยู่)')
        return load()
      })
      .catch(function () { err.textContent = 'เชื่อมต่อไม่ได้ ลองอีกครั้ง'; btn.disabled = false })
  }

  function openDeleteSheet() {
    $('#sheet-body').innerHTML = '<h2 id="sheet-title">ขอลบข้อมูลสมาชิก?</h2>' +
      '<p>ร้านจะได้รับคำขอและลบข้อมูลของคุณ แต้มที่สะสมไว้จะหายไปด้วย และเครื่องนี้จะออกจากระบบทันที</p>' +
      '<button class="btn block" data-act="delete-ok" style="color:var(--danger-strong)">ยืนยันขอลบข้อมูล</button>' +
      '<button class="btn ghost block" data-act="sheet-close">ยกเลิก</button>'
    $('#sheet').hidden = false
  }

  var ledgerLoading = false
  function loadLedger() {
    if (ledgerLoading) return
    ledgerLoading = true
    S.ledger = null
    fetch('/qr/api/member/ledger?t=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (res) { return res.json() })
      .then(function (j) { S.ledger = j.success ? j.data : [] })
      .catch(function () { S.ledger = [] })
      .then(function () { ledgerLoading = false; if (S.tab === 'me') render() })
  }

  function memberPost(path, body, okMsg) {
    return api('POST', path, body || {}).then(function (r) {
      toast(r.ok ? okMsg : (r.body.message || 'ทำรายการไม่สำเร็จ'))
      return load()
    }).catch(function () { toast('เชื่อมต่อไม่ได้ ลองอีกครั้ง') })
  }

  // ---------- actions ----------
  function send() {
    var ids = Object.keys(S.cart)
    if (!ids.length || S.sending) return
    S.sending = true; render()
    var items = ids.map(function (id) { return { menuId: id, qty: S.cart[id].qty, note: S.cart[id].note || '' } })
    api('POST', '/order', { items: items }).then(function (r) {
      if (r.ok) {
        S.cart = {}; saveCart()
        toast('ส่งเข้าครัวแล้ว' + (r.body.data && r.body.data.round ? ' · รอบที่ ' + r.body.data.round : ''))
        return load()
      }
      if (r.body.code === 'MENU_UNAVAILABLE') {
        (r.body.data && r.body.data.menuIds || []).forEach(function (id) { delete S.cart[id] }); saveCart()
      }
      toast(r.body.message || 'ส่งออเดอร์ไม่สำเร็จ ลองอีกครั้ง')
      return load()
    }).catch(function () {
      toast('ส่งไม่สำเร็จ เน็ตอาจหลุด ตะกร้ายังอยู่ ลองกดส่งอีกครั้ง')
    }).then(function () { S.sending = false; render() })
  }

  function callBill() {
    api('POST', '/call-bill', {}).then(function (r) {
      toast(r.ok ? 'เรียกเช็คบิลแล้ว พนักงานกำลังมา' : (r.body.message || 'เรียกเช็คบิลไม่สำเร็จ'))
      return load()
    }).catch(function () { toast('เรียกเช็คบิลไม่สำเร็จ ลองอีกครั้ง หรือเรียกพนักงาน') })
  }

  function scrollCat(i) {
    var el = $('#cat-' + i); if (!el) return
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    document.querySelectorAll('#cats button').forEach(function (b, k) { b.classList.toggle('on', k === i) })
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return
    var id = b.dataset.id
    switch (b.dataset.act) {
      case 'reload': S.error = null; $('#app').innerHTML = '<div class="state"><div class="spinner" role="status" aria-label="กำลังโหลด"></div></div>'; load(); break
      case 'tab':
        S.tab = id
        if (id === 'me' && S.data && S.data.member && S.data.member.status === 'verified') loadLedger()
        render(); window.scrollTo(0, 0); break
      case 'member-open': openMemberSheet(); break
      case 'm-join': joinMember(); break
      case 'logout': memberPost('/member/logout', {}, 'ออกจากระบบบนเครื่องนี้แล้ว · แต้มยังอยู่ครบกับเบอร์ของคุณ'); break
      case 'delete-open': openDeleteSheet(); break
      case 'delete-ok': closeSheet(); memberPost('/member/delete-request', {}, 'ส่งคำขอลบข้อมูลถึงร้านแล้ว'); break
      case 'cat': scrollCat(+id); break
      case 'inc': {
        var m = menuById(id); if (!m || !m.available) break
        var c = S.cart[id] || { qty: 0, note: '' }
        c.qty = Math.min(MAX_QTY, c.qty + 1); S.cart[id] = c; saveCart(); render(); break
      }
      case 'dec':
        if (!S.cart[id]) break
        S.cart[id].qty--; if (S.cart[id].qty <= 0) delete S.cart[id]
        saveCart(); render(); break
      case 'send': send(); break
      case 'call-bill': callBill(); break
      case 'sheet-close': closeSheet(); break
    }
  })
  document.addEventListener('change', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-consent')) {
      var on = e.target.checked
      memberPost('/member/consent', { marketing: on }, on ? 'รับข่าวโปรโมชันแล้ว' : 'ถอนความยินยอมรับข่าวสารแล้ว')
    }
  })
  // หมายเหตุพิมพ์อยู่ → เก็บค่าโดยไม่ render ทับช่องที่กำลังพิมพ์
  document.addEventListener('input', function (e) {
    var id = e.target.dataset && e.target.dataset.note
    if (id && S.cart[id]) { S.cart[id].note = e.target.value.slice(0, 100); saveCart() }
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet()
    if (e.key === 'Enter' && (e.target.id === 'm-phone' || e.target.id === 'm-name')) joinMember()
  })
  $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet() })

  // poll เฉพาะตอนหน้าจอเปิดอยู่ และไม่ render ทับตอนกำลังพิมพ์หมายเหตุ
  setInterval(function () {
    if (document.visibilityState !== 'visible' || S.sending) return
    if (document.activeElement && document.activeElement.classList.contains('note-in')) return
    load()
  }, POLL_MS)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load() })

  if (token) load(); else render()
})()

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
    del: function (k) { try { sessionStorage.removeItem('qr:' + token + ':' + k) } catch (e) {} },
  }

  function randomOrderKey() {
    var bytes = new Uint8Array(24)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes)
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    }
    var hex = ''
    for (var j = 0; j < bytes.length; j++) {
      hex += ('0' + bytes[j].toString(16)).slice(-2)
    }
    return hex
  }

  function cartFingerprint() {
    var sortedCart = {}
    Object.keys(S.cart).sort().forEach(function (k) {
      sortedCart[k] = { qty: S.cart[k].qty, note: S.cart[k].note || '' }
    })
    return JSON.stringify({ c: sortedCart, g: S.gifts })
  }

  var clearOrderKey = function () { store.del('orderKey') }

  var S = {
    data: null,        // ผลจาก /session
    error: null,       // { code, message } ตอนโหลดไม่ได้
    tab: 'menu',
    cart: store.get('cart') || {},   // { menuId: { qty, note } }
    sending: false,
    memberAsked: !!store.get('memberAsked'),  // ถาม pop-up สมาชิกครั้งเดียวต่อรอบโต๊ะ
    attachTried: false,
    gifts: store.get('gifts') || [],  // รางวัลแลกแต้มที่ใส่ตะกร้า (reward id ซ้ำได้)
    orderItems: store.get('orderItems') || [], // item id ที่เครื่องนี้สั่งไปในรอบนี้ (ไว้ผูกย้อนหลังเมื่อกดยินยอมจำเมนู)
    guestRefused: false,
    confirmForgetGuest: false,
    ledger: null,
  }
  var saveCart = function () { store.set('cart', S.cart); store.set('gifts', S.gifts); clearOrderKey() }

  var GUEST_REFUSE_KEY = 'qr:guestRefusedUntil'
  function guestRefused() {
    if (S.guestRefused) return true
    try {
      return Number(localStorage.getItem(GUEST_REFUSE_KEY) || 0) > Date.now()
    } catch (e) { return false }
  }
  function refuseGuest() {
    S.guestRefused = true
    try {
      localStorage.setItem(GUEST_REFUSE_KEY, String(Date.now() + 90 * 86400000))
    } catch (e) { /* โหมดส่วนตัว: จำเฉพาะในหน้านี้ */ }
  }

  function switchToken(newToken) {
    if (!newToken || newToken === token) return
    var oldCart = S.cart
    var oldGifts = S.gifts
    var oldOrderItems = S.orderItems
    token = newToken
    try {
      history.replaceState(null, '', location.pathname + '?t=' + encodeURIComponent(token))
    } catch (e) {}
    // ponytail: ย้าย session storage key ไปตาม token ใหม่ พร้อมถือตะกร้าต่อ
    S.cart = store.get('cart') || oldCart || {}
    S.gifts = store.get('gifts') || oldGifts || []
    S.orderItems = store.get('orderItems') || oldOrderItems || []
    store.set('orderItems', S.orderItems)
    saveCart()
    S.memberAsked = !!store.get('memberAsked')
    S.attachTried = false
    S.ledger = null
  }

  var ICONS = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    bill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></svg>',
    promo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.4"/></svg>',
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
      return res.json().catch(function () { return {} }).then(function (j) {
        if (res.status === 409 && j && j.code === 'SESSION_REQUIRED' && j.data && j.data.sessionToken) {
          switchToken(j.data.sessionToken)
          load()
        }
        return { ok: res.ok, status: res.status, body: j }
      })
    })
  }

  var loading = false
  var pendingLoad = false
  var pendingResolvers = []

  function load() {
    if (loading) {
      pendingLoad = true
      return new Promise(function (resolve) { pendingResolvers.push(resolve) })
    }
    loading = true
    return doLoad().then(function () {
      loading = false
      render()
      if (pendingLoad) {
        pendingLoad = false
        var resolvers = pendingResolvers
        pendingResolvers = []
        return load().then(function () {
          resolvers.forEach(function (res) { res() })
        })
      }
    })
  }

  function doLoad() {
    return fetch('/qr/api/session?t=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {} }).then(function (j) { return { ok: res.ok, status: res.status, body: j } }) })
      .then(function (r) {
        if (!r.ok) {
          if (r.status === 409 && r.body && r.body.code === 'SESSION_REQUIRED' && r.body.data && r.body.data.sessionToken) {
            switchToken(r.body.data.sessionToken)
            return doLoad()
          }
          S.error = { code: r.body.code, message: r.body.message || 'โหลดไม่สำเร็จ' }; S.data = null; return
        }
        if (r.body.data && (r.body.data.state === 'redirect' || (r.body.data.sessionToken && r.body.data.sessionToken !== token))) {
          var nextToken = r.body.data.sessionToken
          if (nextToken && nextToken !== token) {
            switchToken(nextToken)
            return doLoad()
          }
        }
        var prev = S.data && S.data.state
        S.error = null
        S.data = r.body.data
        if (S.data.state === 'open') store.set('wasOpen', true)
        if (S.data.state === 'closed' || (prev === 'open' && S.data.state !== 'open')) {
          S.cart = {}; S.gifts = []; S.orderItems = []; store.del('orderItems'); saveCart(); closeSheet()
        }
        pruneCart()
        afterLoad()
      })
      .catch(function () {
        // เน็ตหลุดชั่วคราว: คงหน้าจอเดิมไว้ รอบหน้าโหลดใหม่เอง
        if (!S.data) S.error = { code: 'NETWORK', message: 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }
      })
  }

  // เครื่องที่เคยผูกเบอร์ไว้ → ให้บิลโต๊ะนี้สะสมแต้มอัตโนมัติ · ยังไม่เคย → ชวนสมัครครั้งเดียวต่อรอบโต๊ะ
  function afterLoad() {
    var d = S.data
    if (!d || d.state !== 'open') return
    if (!loyaltyOn()) { setTimeout(maybeAd, 800); return }
    if (d.member && !d.billMember && !S.attachTried) { S.attachTried = true; attachMember() }
    else if (!d.member && !d.billMember && !S.memberAsked && $('#sheet').hidden) {
      S.memberAsked = true; store.set('memberAsked', true)
      setTimeout(function () { openMemberSheet() }, 400)
      return
    }
    if ($('#sheet').hidden) setTimeout(maybeAd, 800)
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

  // เมนูที่ร้านปิด/หมด หรือของแถมที่หมด/ไม่มีแล้วระหว่างที่ลูกค้าเลือกอยู่ → เอาออกจากตะกร้า
  function pruneCart() {
    if (!S.data) return
    var menuRemoved = false
    if (S.data.menu) {
      var availMenu = {}
      S.data.menu.forEach(function (m) { if (m.available) availMenu[m.id] = 1 })
      var removedMenu = Object.keys(S.cart).filter(function (id) { return !availMenu[id] })
      removedMenu.forEach(function (id) { delete S.cart[id] })
      if (removedMenu.length) menuRemoved = true
    }
    var giftRemoved = false
    if (S.data.rewards && S.gifts && S.gifts.length) {
      var availRewards = {}
      S.data.rewards.forEach(function (w) { if (w.available) availRewards[w.id] = 1 })
      var keptGifts = S.gifts.filter(function (id) { return availRewards[id] })
      if (keptGifts.length !== S.gifts.length) {
        S.gifts = keptGifts
        giftRemoved = true
      }
    }
    if (menuRemoved || giftRemoved) {
      saveCart()
      if (menuRemoved && giftRemoved) {
        toast('มีเมนูหรือของแถมที่หมดแล้ว เอาออกจากตะกร้าให้แล้ว')
      } else if (menuRemoved) {
        toast('มีเมนูที่หมดแล้ว เอาออกจากตะกร้าให้แล้ว')
      } else {
        toast('มีของแถมที่หมดแล้ว เอาออกจากตะกร้าให้แล้ว')
      }
    }
  }

  // ---------- helpers ----------
  var menuById = function (id) { return (S.data && S.data.menu || []).filter(function (m) { return m.id === id })[0] }
  var cartCount = function () { return Object.keys(S.cart).reduce(function (a, id) { return a + S.cart[id].qty }, 0) + S.gifts.length }
  var rewardById = function (id) { return (S.data && S.data.rewards || []).filter(function (x) { return x.id === id })[0] }
  var giftPoints = function () { return S.gifts.reduce(function (a, id) { var w = rewardById(id); return a + (w ? w.points : 0) }, 0) }
  // แต้มที่ยังแลกได้ = ที่ server บอก (หักที่จองกับบิลอื่นแล้ว) − ที่อยู่ในตะกร้า
  var pointsLeft = function () { var m = S.data && S.data.member; return m && m.status === 'verified' ? (m.available != null ? m.available : m.points) - giftPoints() : 0 }
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
      var closedMsg = (d.bill && d.bill.paid ? 'ยอดชำระ ' + baht(d.bill.total) + ' · ' : '') +
        'ขอบคุณที่มาทานที่ ' + (d.shop.name || 'ร้านเรา') + ' — สแกน QR ที่โต๊ะอีกครั้งเพื่อสั่งรอบใหม่'
      app.innerHTML = stateScreen('✓', 'ok', 'ปิดบิล' + (tableName ? ' ' + tableName : '') + 'แล้ว', closedMsg)
      return
    }
    var keep = window.scrollY
    var prevTab = app.dataset.tab
    if (S.tab === 'me' && !loyaltyOn() && !(d && d.guest)) S.tab = 'menu'
    if (S.tab === 'promo' && !hasPromoTab()) S.tab = 'menu'
    var body = S.tab === 'bill' ? billTab(d) : S.tab === 'me' ? meTab(d) : S.tab === 'promo' ? promoTab(d) : menuTab(d)
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

  function guestReorderCard(d) {
    var last = d.guest && d.guest.lastOrder
    if (!last || !last.length) return ''
    var hasAvail = last.some(function (it) {
      var m = it && menuById(it.menuId)
      return !!(it && it.available && m && m.available)
    })
    var lines = last.map(function (it) {
      return '<div class="line"><div><span class="nm">' + esc(it.name) + ' × ' + (Number(it.qty) || 1) + '</span></div>' +
        (it.available ? '' : '<span class="badge out">หมด</span>') + '</div>'
    }).join('')
    return '<div class="pad" style="padding-bottom:0"><div class="card"><span class="h-sm">ครั้งก่อนคุณสั่ง</span>' +
      lines +
      '<button class="btn primary block" data-act="reorder-all"' + (hasAvail ? '' : ' disabled') + '>สั่งซ้ำทั้งหมด</button></div></div>'
  }

  function menuTab(d) {
    var gs = groups(d.menu || [])
    if (!gs.length) return '<div class="state"><p>ร้านยังไม่ได้เปิดเมนูให้สั่งผ่าน QR</p></div>'
    var h = gs.length > 1 ? '<nav class="cats" id="cats" aria-label="หมวดเมนู">' + gs.map(function (g, i) {
      return '<button data-act="cat" data-id="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(g.name) + '</button>'
    }).join('') + '</nav>' : ''
    h += guestReorderCard(d)
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
    if (!ids.length && !S.gifts.length) h += '<div class="card muted">ยังไม่มีรายการ เลือกจากแท็บเมนูได้เลย</div>'
    else {
      h += '<div class="card">'
      ids.forEach(function (id) {
        var m = menuById(id); if (!m) return
        var c = S.cart[id]
        h += '<div class="line"><div><div class="nm">' + esc(m.name) + '</div><div class="small muted num">' + baht(m.price * c.qty) + '</div></div>' + stepper(m) +
          '<input class="note-in" data-note="' + esc(id) + '" maxlength="100" placeholder="หมายเหตุ เช่น ไม่เผ็ด ไม่ใส่ผัก" value="' + esc(c.note || '') + '" aria-label="หมายเหตุ ' + esc(m.name) + '"></div>'
      })
      S.gifts.forEach(function (gid, i) {
        var w = rewardById(gid); if (!w) return
        h += '<div class="line"><div><div class="nm">🎁 ' + esc(w.name) + '</div><div class="small muted">แลก ' + w.points + ' แต้ม · จองไว้ ตัดจริงเมื่อชำระเงิน</div></div>' +
          '<button class="btn ghost" data-act="ungift" data-id="' + i + '">เอาออก</button></div>'
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
      h += guestConsentCard(d, b)
      h += earnCard(d, b)
      if (!b.billRequested) h += '<button class="btn mango block" data-act="call-bill">เรียกเช็คบิล</button>'
      h += '<p class="small muted" style="margin:0;text-align:center">ชำระเงินที่แคชเชียร์ · ยอดอาจปรับตามส่วนลดหน้าเคาน์เตอร์</p>'
    } else {
      h += guestConsentCard(d, b)
    }
    return h + '</div>'
  }

  function guestConsentCard(d, b) {
    if (d.member || d.guest || guestRefused()) return ''
    if (!S.orderItems.length && !(b.items && b.items.length)) return ''
    return '<div class="card"><span class="h-sm">ให้เครื่องนี้จำเมนูที่คุณสั่งไหม</span>' +
      '<span class="small muted">ครั้งหน้าสแกนแล้วกดสั่งซ้ำได้ทันที เก็บแค่รายการอาหาร ไม่เก็บชื่อหรือเบอร์ ลบได้ทุกเมื่อในแท็บสมาชิก</span>' +
      '<div class="row"><button class="btn primary" style="flex:1" data-act="guest-consent">จำไว้</button>' +
      '<button class="btn ghost" data-act="guest-refuse">ไม่ต้อง</button></div></div>'
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
      if (loyaltyOn()) {
        h += '<div class="card"><span class="h-sm">ยังไม่ได้เป็นสมาชิก</span><span class="small muted">สมัครด้วยเบอร์โทร สะสมแต้มทุกบิล ทุก ' + baht(d.loyalty.earnRate) +
          ' ได้ 1 แต้ม ครั้งหน้าสแกน QR แล้วระบบจำคุณได้ทันที</span><button class="btn primary" data-act="member-open">สมัครสมาชิก</button></div>'
      }
      if (d.guest) {
        h += '<div class="card"><span class="small">ข้อมูลที่เครื่องนี้จำไว้: มาแล้ว ' + Number(d.guest.visits || 0) + ' ครั้ง · สั่งบ่อย: ' + esc(d.guest.favorite || '-') + '</span>' +
          (S.confirmForgetGuest
            ? '<div class="banner">ยืนยันลบข้อมูลที่จำไว้และหยุดจำเครื่องนี้?</div>' +
              '<div class="row"><button class="btn" style="flex:1;color:var(--danger-strong)" data-act="guest-forget-ok">ยืนยันลบข้อมูล</button>' +
              '<button class="btn ghost" data-act="guest-forget-cancel">ยกเลิก</button></div>'
            : '<button class="btn ghost block" data-act="guest-forget-ask" style="color:var(--danger-strong)">ลบข้อมูลและหยุดจำ</button>') +
          '</div>'
      }
      return h + '</div>'
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

  var hasPromoTab = function () { return !!(S.data && ((S.data.promotions || []).length || (S.data.rewards || []).length)) }

  function promoTab(d) {
    var m = d.member, h = '<div class="pad">'
    if ((d.rewards || []).length) {
      if (m && m.status === 'verified') {
        var held = m.points - pointsLeft()
        h += '<div class="card member"><small>แต้มของคุณ' + esc(m.name) + '</small><div class="big num">' + pointsLeft().toLocaleString('th-TH') + ' แต้ม</div>' +
          (held > 0 ? '<small>จองไว้กับของแถม ' + held.toLocaleString('th-TH') + ' แต้ม ตัดจริงเมื่อชำระเงิน</small>' : '<small>ทุก ' + baht(d.loyalty.earnRate) + ' ได้ 1 แต้ม</small>') + '</div>'
      } else if (!m) {
        h += '<div class="card"><span class="h-sm">สมัครสมาชิกเพื่อสะสมและแลกแต้ม</span><button class="btn primary" data-act="member-open">สมัครด้วยเบอร์โทร</button></div>'
      } else {
        h += '<div class="banner">แลกแต้มได้หลังแคชเชียร์ยืนยันสมาชิก — บอกพนักงานว่าสมัครผ่าน QR</div>'
      }
    }
    if ((d.promotions || []).length) {
      h += '<span class="h-sm">โปรโมชัน</span>'
      d.promotions.forEach(function (p) {
        h += '<div class="card"><div class="row"><div><b>' + esc(p.title) + '</b>' + (p.membersOnly ? ' <span class="badge">สมาชิก</span>' : '') +
          (p.description ? '<div class="small muted">' + esc(p.description) + '</div>' : '') +
          (p.endsOn ? '<div class="small muted">ถึง ' + esc(new Date(p.endsOn).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })) + '</div>' : '') + '</div>' +
          (p.menuId ? '<button class="btn primary" style="min-height:40px;padding:8px 14px" data-act="promo-order" data-id="' + esc(p.menuId) + '">สั่งเลย</button>' : '') + '</div></div>'
      })
    }
    if ((d.rewards || []).length) {
      var canRedeem = m && m.status === 'verified' && d.billMember && d.billMember.mine
      h += '<span class="h-sm">แลกแต้ม</span>'
      d.rewards.forEach(function (w) {
        var btn = !w.available ? '<button class="btn" disabled>หมด</button>'
          : !m ? '<button class="btn" data-act="member-open">สมัครก่อน</button>'
          : !canRedeem ? '<button class="btn" disabled>รอยืนยัน</button>'
          : pointsLeft() < w.points ? '<button class="btn" disabled>ขาดอีก ' + (w.points - pointsLeft()) + '</button>'
          : '<button class="btn primary" data-act="gift" data-id="' + esc(w.id) + '">แลก</button>'
        h += '<div class="card"><div class="row"><div><b>🎁 ' + esc(w.name) + '</b><div><span class="badge">' + w.points.toLocaleString('th-TH') + ' แต้ม</span></div></div>' + btn + '</div></div>'
      })
    }
    return h + '</div>'
  }

  // ---------- Pop-up โฆษณา (add-on) — ครั้งเดียวต่อรอบโต๊ะต่อเครื่อง ไม่ซ้อนกับ pop-up สมาชิก ----------
  function maybeAd() {
    var d = S.data
    if (!d || d.state !== 'open' || !d.ad || !$('#sheet').hidden || !$('#ad-layer').hidden) return
    var key = 'ad:' + (d.bill && d.bill.number) + ':' + d.ad.version
    if (store.get(key)) return
    store.set(key, true)
    $('#ad-frame').innerHTML = '<img src="' + esc(d.ad.image) + '" alt="โปรโมชันจากร้าน">'
    $('#ad-layer').hidden = false
    adEvent('shown')
    setTimeout(function () { var x = $('.ad-x'); if (x) x.focus({ preventScroll: true }) }, 30)
  }
  function adEvent(type) { api('POST', '/ad-event', { type: type }).catch(function () { /* สถิติหายได้ ไม่กวนลูกค้า */ }) }
  function closeAd(tapped) {
    if ($('#ad-layer').hidden) return
    $('#ad-layer').hidden = true
    var ad = S.data && S.data.ad
    adEvent(tapped ? 'tap' : 'close')
    if (!tapped || !ad || ad.link === 'none') return
    if (ad.link === 'promo' && hasPromoTab()) { S.tab = 'promo'; render(); window.scrollTo(0, 0) }
    else if (ad.link === 'menu' && ad.menuId && menuById(ad.menuId)) {
      S.tab = 'menu'; render()
      var el = document.querySelector('[data-act="inc"][data-id="' + ad.menuId.replace(/"/g, '') + '"]')
      if (el) el.scrollIntoView({ block: 'center' })
    }
  }

  function bottom() {
    var n = cartCount()
    var bar = S.tab === 'menu' && n
      ? '<button class="cartbar" data-act="tab" data-id="bill"><span>ตะกร้า ' + n + ' รายการ</span><span class="num">' + baht(cartSum()) + ' →</span></button>' : ''
    var showMe = loyaltyOn() || !!(S.data && S.data.guest)
    var tabs = [['menu', 'เมนู']].concat(hasPromoTab() ? [['promo', 'โปรและแลกแต้ม']] : [], [['bill', 'บิล']], showMe ? [['me', 'สมาชิก']] : [])
    var nav = '<nav class="nav" style="--tabs:' + tabs.length + '" aria-label="เมนูหลัก">' + tabs.map(function (t) {
      return '<button data-act="tab" data-id="' + t[0] + '"' + (S.tab === t[0] ? ' class="on" aria-current="page"' : '') + '>' + ICONS[t[0]] +
        '<span>' + t[1] + '</span>' + (t[0] === 'bill' && n ? '<span class="dot">' + n + '</span>' : '') + '</button>'
    }).join('') + '</nav>'
    return '<div class="bottom">' + bar + nav + '</div>'
  }

  function closeSheet() { var was = !$('#sheet').hidden; $('#sheet').hidden = true; if (was) setTimeout(maybeAd, 800) }

  // ---------- sheet (สมัครสมาชิก) — PDPA: ความยินยอม 2 ข้อแยกกัน ไม่ติ๊กไว้ให้ล่วงหน้า ----------
  function openMemberSheet() {
    var shop = S.data && S.data.shop.name ? S.data.shop.name : 'ร้าน'
    var g = S.data && S.data.guest
    var hasRetro = !!(g && Number(g.retroPoints) > 0)
    var title = hasRetro ? 'คุณมาครั้งที่ ' + (Number(g.visits || 0) + 1) + ' แล้ว' : 'รับแต้มทุกครั้งที่มาทาน'
    var sub = hasRetro
      ? 'สมัครวันนี้รับแต้มย้อนหลัง ' + Number(g.retroPoints).toLocaleString('th-TH') + ' แต้มจากครั้งก่อนหน้า พร้อมสะสมแต้มทุก ' + baht(S.data.loyalty.earnRate) + ' ได้ 1 แต้ม'
      : 'สมัครด้วยเบอร์โทร ไม่ต้องลงแอป ทุก ' + baht(S.data.loyalty.earnRate) + ' ได้ 1 แต้ม'
    $('#sheet-body').innerHTML = '<h2 id="sheet-title">' + esc(title) + '</h2>' +
      '<p>' + esc(sub) + '</p>' +
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
        var retro = Number(r.body.data && r.body.data.retroPoints) || 0
        var baseMsg = r.body.data.linked
          ? 'สมัครแล้ว บิลนี้สะสมแต้มให้เบอร์ ' + r.body.data.member.phone
          : 'สมัครแล้ว (บิลนี้มีสมาชิกอีกคนสะสมแต้มอยู่)'
        toast(baseMsg + (retro > 0 ? ' · ได้แต้มย้อนหลัง +' + retro.toLocaleString('th-TH') + ' แต้ม' : ''))
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
    if ((!ids.length && !S.gifts.length) || S.sending) return
    S.sending = true; render()

    var fp = cartFingerprint()
    var saved = store.get('orderKey')
    var key = (saved && saved.fp === fp && saved.key) ? saved.key : randomOrderKey()
    store.set('orderKey', { key: key, fp: fp })

    var items = ids.map(function (id) { return { menuId: id, qty: S.cart[id].qty, note: S.cart[id].note || '' } })
    api('POST', '/order', { items: items, rewards: S.gifts, orderKey: key }).then(function (r) {
      if (r.ok) {
        if (r.body.data && Array.isArray(r.body.data.itemIds)) {
          r.body.data.itemIds.forEach(function (id) {
            if (id && S.orderItems.indexOf(id) < 0) S.orderItems.push(id)
          })
          store.set('orderItems', S.orderItems)
        }
        clearOrderKey()
        S.cart = {}; S.gifts = []; saveCart()
        toast('ส่งเข้าครัวแล้ว' + (r.body.data && r.body.data.round ? ' · รอบที่ ' + r.body.data.round : ''))
        return load()
      }
      if (['REWARD_INVALID', 'MEMBER_NOT_VERIFIED', 'NOT_BILL_MEMBER'].indexOf(r.body.code) >= 0) { S.gifts = []; saveCart() }
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
      case 'gift': {
        var w = rewardById(id); if (!w) break
        if (pointsLeft() < w.points) { toast('แต้มไม่พอ'); break }
        S.gifts.push(id); saveCart(); render(); toast('ใส่ตะกร้าแล้ว แต้มจะถูกจองเมื่อส่งออเดอร์'); break
      }
      case 'ungift': S.gifts.splice(+id, 1); saveCart(); render(); break
      case 'promo-order': {
        var pm = menuById(id); if (!pm || !pm.available) break
        var pc = S.cart[id] || { qty: 0, note: '' }; pc.qty = Math.min(MAX_QTY, pc.qty + 1); S.cart[id] = pc; saveCart(); render()
        toast('ใส่ ' + pm.name + ' ลงตะกร้าแล้ว'); break
      }
      case 'ad-close': closeAd(false); break
      case 'ad-tap': closeAd(true); break
      case 'guest-consent':
        memberPost('/guest', { itemIds: S.orderItems }, 'จำรายการอาหารไว้บนเครื่องนี้แล้ว')
        break
      case 'guest-refuse':
        refuseGuest(); render(); break
      case 'guest-forget-ask':
        S.confirmForgetGuest = true; render(); break
      case 'guest-forget-cancel':
        S.confirmForgetGuest = false; render(); break
      case 'guest-forget-ok':
        S.confirmForgetGuest = false
        S.orderItems = []; store.del('orderItems')
        memberPost('/guest/forget', {}, 'ลบข้อมูลและหยุดจำบนเครื่องนี้แล้ว')
        break
      case 'reorder-all': {
        var last = S.data && S.data.guest && S.data.guest.lastOrder || []
        var added = 0
        last.forEach(function (it) {
          var rm = it && menuById(it.menuId)
          if (!it || !it.available || !rm || !rm.available) return
          var rc = S.cart[rm.id] || { qty: 0, note: '' }
          rc.qty = Math.min(MAX_QTY, rc.qty + (Number(it.qty) || 1))
          S.cart[rm.id] = rc
          added++
        })
        if (added) { saveCart(); render(); toast('เพิ่มเมนูที่เคยสั่งลงตะกร้าแล้ว') }
        else toast('เมนูที่เคยสั่งหมดวันนี้')
        break
      }
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
    if (e.key === 'Escape' && !$('#ad-layer').hidden) closeAd(false)
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

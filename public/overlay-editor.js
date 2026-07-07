// ============================================================================
// Skrip editor gabungan buat halaman hasil AI (dipakai di tool preview /app
// dan di preview Prompt Generator). SATU file ini aja sumbernya, biar gak ada
// kode yang keduplikat/kesilo di banyak tempat.
//
// Aktif kalau window.__ENABLE_EDIT_OVERLAY === true.
// Alurnya: klik konten yang punya [data-edit] -> muncul pilihan
// "Edit Langsung" (manual) atau "Edit Section dengan AI" (kalau
// window.__aiEditEndpoint ke-set).
// ============================================================================

// ---------- Tombol "⚙️ Admin" mengambang: SELALU muncul (preview MAUPUN halaman live/publish) ----------
// Ini beda dari Mode Edit / Edit AI di bawah (yang cuma jalan di preview) — tombol ini
// nyambungin ke panel admin terpusat platform (/admin.html), dipakai pemilik website
// buat toggle section & ganti password sendiri, tanpa akses ke fitur AI.
(function(){
  function injectAdminButton(){
    if (!window.__dataEndpoint || document.getElementById('__platform-admin-btn')) return;
    var btn = document.createElement('a');
    btn.id = '__platform-admin-btn';
    btn.href = '/admin.html?endpoint=' + encodeURIComponent(window.__dataEndpoint);
    btn.textContent = '⚙️';
    btn.title = 'Panel Admin Website';
    btn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:999996;background:#1a1d23;color:#fff;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:16px;box-shadow:0 2px 10px rgba(0,0,0,.3);opacity:.55;transition:opacity .15s;';
    btn.addEventListener('mouseenter', function(){ btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function(){ btn.style.opacity = '.55'; });
    document.body.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAdminButton);
  } else {
    injectAdminButton();
  }
})();

(function(){
  if (!window.__ENABLE_EDIT_OVERLAY) return;

  function getByPath(obj, path){
    return path.split('.').reduce(function(o,k){ return (o == null) ? undefined : o[k]; }, obj);
  }
  function setByPath(obj, path, value){
    var keys = path.split('.');
    var clone = JSON.parse(JSON.stringify(obj));
    var cur = clone;
    for (var i = 0; i < keys.length - 1; i++){ cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = value;
    return clone;
  }

  function closeAllPopovers(){
    ['__edit-choice-menu', '__edit-popover', '__ai-section-popover', '__section-panel'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function clampTop(top){ return Math.min(top, window.innerHeight - 220); }
  function clampLeft(left, width){ return Math.min(Math.max(left, 8), window.innerWidth - width - 8); }

  function fieldLabel(el){
    var path = el.getAttribute('data-edit') || '';
    var parts = path.split('.');
    return parts[parts.length - 1] || path;
  }

  // ---------- Panel: buka SATU section utuh, tampilin semua bagian yang bisa diedit ----------
  function openSectionPanel(sectionEl, sectionName){
    closeAllPopovers();
    var fields = Array.prototype.slice.call(sectionEl.querySelectorAll('[data-edit]'));

    var panel = document.createElement('div');
    panel.id = '__section-panel';
    panel.style.cssText = 'position:fixed;z-index:999999;background:#fff;border:1px solid #ddd;border-radius:14px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:-apple-system,sans-serif;width:300px;max-height:70vh;overflow-y:auto;top:70px;right:20px;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    header.innerHTML = '<div style="font-size:13.5px;font-weight:700;color:#111;text-transform:capitalize;">📦 Section: ' + sectionName + '</div>';
    var closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'border:none;background:none;font-size:15px;cursor:pointer;color:#666;';
    closeX.onclick = function(){ panel.remove(); };
    header.appendChild(closeX);
    panel.appendChild(header);

    if (fields.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'font-size:12px;color:#888;margin-bottom:12px;';
      emptyMsg.textContent = 'Gak ada bagian yang ditandai bisa diedit di section ini.';
      panel.appendChild(emptyMsg);
    } else {
      fields.forEach(function(fieldEl){
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee;gap:8px;';
        var label = document.createElement('span');
        label.style.cssText = 'font-size:12px;color:#333;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        label.textContent = fieldLabel(fieldEl);
        var editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.style.cssText = 'padding:5px 10px;border:1px solid #ccc;background:#f8f8f8;border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0;';
        editBtn.onclick = function(){ closeAllPopovers(); openDirectEditPopover(fieldEl); };
        row.appendChild(label);
        row.appendChild(editBtn);
        panel.appendChild(row);
      });
    }

    if (window.__aiEditEndpoint) {
      var aiBtn = document.createElement('button');
      aiBtn.textContent = '✨ Edit Section Ini dengan AI';
      aiBtn.style.cssText = 'width:100%;margin-top:12px;padding:10px 12px;border:none;background:#7C3AED;color:#fff;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:700;';
      aiBtn.onclick = function(){
        closeAllPopovers();
        openAiSectionPopover(sectionName, sectionEl);
      };
      panel.appendChild(aiBtn);
    }

    document.body.appendChild(panel);
  }

  // ---------- Menu pilihan pas konten diklik ----------
  function openChoiceMenu(el){
    closeAllPopovers();
    var rect = el.getBoundingClientRect();
    var menu = document.createElement('div');
    menu.id = '__edit-choice-menu';
    var top = clampTop(rect.bottom + 6);
    var left = clampLeft(rect.left, 210);
    menu.style.cssText = 'position:fixed;z-index:999997;background:#fff;border:1px solid #ddd;border-radius:10px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-family:-apple-system,sans-serif;display:flex;flex-direction:column;gap:4px;width:210px;top:' + top + 'px;left:' + left + 'px;';

    var directBtn = document.createElement('button');
    directBtn.textContent = '✏️ Edit Langsung';
    directBtn.style.cssText = 'padding:9px 12px;border:none;background:#f3f4f6;border-radius:7px;font-size:12.5px;cursor:pointer;text-align:left;font-weight:600;color:#111;';
    directBtn.onclick = function(e){ e.stopPropagation(); closeAllPopovers(); openDirectEditPopover(el); };
    menu.appendChild(directBtn);

    if (window.__aiEditEndpoint) {
      var aiBtn = document.createElement('button');
      aiBtn.textContent = '✨ Edit Section dengan AI';
      aiBtn.style.cssText = 'padding:9px 12px;border:none;background:#7C3AED;color:#fff;border-radius:7px;font-size:12.5px;cursor:pointer;text-align:left;font-weight:600;';
      aiBtn.onclick = function(e){
        e.stopPropagation();
        closeAllPopovers();
        var sectionName = findSectionName(el);
        if (!sectionName) { alert('Gak nemu section pembungkus elemen ini (pastikan <section> punya id yang sesuai sectionOrder).'); return; }
        openAiSectionPopover(sectionName, el);
      };
      menu.appendChild(aiBtn);
    }

    document.body.appendChild(menu);
    setTimeout(function(){
      document.addEventListener('click', function outsideClick(ev){
        if (menu.parentNode && !menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener('click', outsideClick, true);
        }
      }, true);
    }, 10);
  }

  function findSectionName(el){
    if (!window.__getSiteData) return null;
    var siteData = window.__getSiteData();
    var sectionOrder = (siteData && siteData.sectionOrder) || (siteData && Object.keys(siteData.sections || {})) || [];
    var current = el;
    while (current && current !== document.body) {
      if (current.id && sectionOrder.indexOf(current.id) !== -1) return current.id;
      current = current.parentElement;
    }
    return null;
  }

  // ---------- Edit Langsung (manual, per elemen) ----------
  function openDirectEditPopover(el){
    var path = el.getAttribute('data-edit');
    var type = el.getAttribute('data-edit-type') || 'text';

    if (!window.__getSiteData || !window.__setSiteData) {
      alert('Kode ini belum mendukung edit klik-langsung (belum ada data-edit / __getSiteData).');
      return;
    }

    closeAllPopovers();
    var currentValue = getByPath(window.__getSiteData(), path);
    var rect = el.getBoundingClientRect();

    var pop = document.createElement('div');
    pop.id = '__edit-popover';
    var top = clampTop(rect.bottom + 8);
    var left = clampLeft(rect.left, 280);
    pop.style.cssText = 'position:fixed;z-index:1000000;background:#fff;border:1px solid #ccc;border-radius:10px;padding:14px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-family:-apple-system,sans-serif;width:280px;top:' + top + 'px;left:' + left + 'px;';

    var label = document.createElement('div');
    label.textContent = 'Edit: ' + path;
    label.style.cssText = 'font-size:11px;color:#666;margin-bottom:8px;font-weight:600;word-break:break-all;';
    pop.appendChild(label);

    // Kalau elemen yang diklik itu <a> (biasanya tombol CTA), tampilkan juga kotak buat edit link tujuannya.
    // Nebak nama field link-nya dari pola nama: "...Text" -> "...Link" (misal ctaText -> ctaLink).
    var isLinkElement = el.tagName === 'A';
    var linkPath = isLinkElement ? path.replace(/Text$/i, 'Link') : null;
    var hasDedicatedLinkField = isLinkElement && linkPath !== path;
    var linkInput = null;

    if (hasDedicatedLinkField) {
      var linkLabel = document.createElement('div');
      linkLabel.textContent = '🔗 Link Tujuan';
      linkLabel.style.cssText = 'font-size:11px;color:#666;margin-bottom:4px;font-weight:600;';
      pop.appendChild(linkLabel);

      linkInput = document.createElement('input');
      linkInput.type = 'text';
      const currentLinkValue = getByPath(window.__getSiteData(), linkPath);
      linkInput.value = currentLinkValue || el.getAttribute('href') || '';
      linkInput.placeholder = 'misal: https://wa.me/62812xxxx, #kontak, /halaman-lain';
      linkInput.style.cssText = 'width:100%;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:12.5px;margin-bottom:10px;box-sizing:border-box;color:#111;background:#fff;';
      pop.appendChild(linkInput);

      var textFieldLabel = document.createElement('div');
      textFieldLabel.textContent = '✏️ Teks Tombol';
      textFieldLabel.style.cssText = 'font-size:11px;color:#666;margin-bottom:4px;font-weight:600;';
      pop.appendChild(textFieldLabel);
    }

    var input;
    if (type === 'image') {
      var preview = document.createElement('img');
      preview.src = currentValue || '';
      preview.style.cssText = 'width:100%;max-height:100px;object-fit:cover;border-radius:6px;margin-bottom:8px;background:#eee;';
      pop.appendChild(preview);
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.cssText = 'width:100%;font-size:12px;margin-bottom:8px;';
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
      input.value = currentValue || '';
      input.style.cssText = 'width:100%;min-height:70px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;margin-bottom:10px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = currentValue || '';
      input.style.cssText = 'width:100%;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;margin-bottom:10px;box-sizing:border-box;color:#111;background:#fff;';
    }
    pop.appendChild(input);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Batal';
    cancelBtn.style.cssText = 'padding:7px 12px;border:1px solid #ccc;background:#fff;border-radius:6px;font-size:12.5px;cursor:pointer;';
    cancelBtn.onclick = function(){ pop.remove(); };

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Simpan';
    saveBtn.style.cssText = 'padding:7px 14px;border:none;background:#0f766e;color:#fff;border-radius:6px;font-size:12.5px;cursor:pointer;font-weight:600;';
    saveBtn.onclick = function(){
      if (type === 'image') {
        var file = input.files && input.files[0];
        if (!file) { pop.remove(); return; }
        var reader = new FileReader();
        reader.onloadend = function(){
          window.__setSiteData(function(prev){ return setByPath(prev, path, reader.result); });
          pop.remove();
        };
        reader.readAsDataURL(file);
      } else {
        window.__setSiteData(function(prev){
          var next = setByPath(prev, path, input.value);
          if (hasDedicatedLinkField && linkInput) {
            next = setByPath(next, linkPath, linkInput.value);
          }
          return next;
        });
        pop.remove();
      }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    pop.appendChild(btnRow);
    document.body.appendChild(pop);
    if (input.focus) input.focus();
  }

  // ---------- Edit Section dengan AI ----------
  function openAiSectionPopover(sectionName, anchorEl){
    closeAllPopovers();
    var rect = anchorEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.id = '__ai-section-popover';
    var top = clampTop(rect.bottom + 8);
    var left = clampLeft(rect.left, 290);
    pop.style.cssText = 'position:fixed;z-index:1000000;background:#fff;border:1px solid #ddd;border-radius:12px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-family:-apple-system,sans-serif;width:290px;top:' + top + 'px;left:' + left + 'px;';

    var label = document.createElement('div');
    label.textContent = '✨ Edit section: ' + sectionName;
    label.style.cssText = 'font-size:12.5px;font-weight:700;margin-bottom:8px;color:#222;';
    pop.appendChild(label);

    var textarea = document.createElement('textarea');
    textarea.placeholder = 'Contoh: buat judulnya lebih menarik buat anak muda';
    textarea.style.cssText = 'width:100%;min-height:64px;padding:8px;border:1px solid #ccc;border-radius:7px;font-size:12.5px;margin-bottom:10px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;';
    pop.appendChild(textarea);

    var statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'font-size:11.5px;margin-bottom:8px;display:none;';
    pop.appendChild(statusDiv);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Batal';
    cancelBtn.style.cssText = 'padding:7px 12px;border:1px solid #ccc;background:#fff;border-radius:7px;font-size:12px;cursor:pointer;';
    cancelBtn.onclick = function(){ pop.remove(); };

    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Kirim ke AI';
    sendBtn.style.cssText = 'padding:7px 14px;border:none;background:#7C3AED;color:#fff;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700;';
    sendBtn.onclick = function(){
      var instruction = textarea.value.trim();
      if (!instruction) { alert('Isi dulu instruksinya.'); return; }
      sendBtn.disabled = true; cancelBtn.disabled = true;
      sendBtn.textContent = '⏳ AI mikir...';
      statusDiv.style.display = 'block';
      statusDiv.style.color = '#666';
      statusDiv.textContent = 'Menunggu AI...';

      // Pesan berganti-ganti biar keliatan masih proses, bukan macet
      // (beberapa model AI "reasoning" emang butuh waktu lebih lama, mikir dulu diam-diam)
      var waitMessages = [
        'Menunggu AI...',
        'AI masih mikir, ini wajar kalau pakai model reasoning...',
        'Masih diproses, mohon tunggu sebentar lagi...',
        'Hampir kelar, AI lagi nyusun jawaban...'
      ];
      var waitMsgIndex = 0;
      var waitTimer = setInterval(function(){
        waitMsgIndex = Math.min(waitMsgIndex + 1, waitMessages.length - 1);
        statusDiv.textContent = waitMessages[waitMsgIndex];
      }, 8000);

      var currentSiteData = window.__getSiteData();
      var currentSectionData = currentSiteData.sections[sectionName];

      fetch(window.__aiEditEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentData: currentSectionData, instruction: instruction })
      }).then(function(r){
        return r.text().then(function(rawText){
          var data;
          try {
            data = JSON.parse(rawText);
          } catch (e) {
            // Server/infrastruktur di belakangnya lagi ada gangguan sesaat, balikin pesan yang jelas
            throw new Error('Server lagi ada gangguan sesaat (bukan salah instruksi kamu). Coba lagi beberapa saat lagi.');
          }
          return { status: r.status, ok: r.ok, data: data };
        });
      }).then(function(result){
        clearInterval(waitTimer);
        if (result.status === 402) {
          statusDiv.style.color = '#c00';
          statusDiv.textContent = result.data.error || 'Token AI habis.';
          sendBtn.disabled = false; cancelBtn.disabled = false; sendBtn.textContent = 'Kirim ke AI';
          return;
        }
        if (!result.ok) {
          statusDiv.style.color = '#c00';
          statusDiv.textContent = 'Gagal: ' + (result.data.error || 'error tidak diketahui');
          sendBtn.disabled = false; cancelBtn.disabled = false; sendBtn.textContent = 'Kirim ke AI';
          return;
        }
        window.__setSiteData(function(prev){
          var next = JSON.parse(JSON.stringify(prev));
          next.sections[sectionName] = result.data.data;
          return next;
        });
        statusDiv.style.color = '#0a7a4a';
        statusDiv.textContent = 'Berhasil diupdate ✓';
        if (window.parent) window.parent.postMessage({ type: 'ai-section-edited', sectionName: sectionName }, '*');
        setTimeout(function(){ pop.remove(); }, 1000);
      }).catch(function(e){
        clearInterval(waitTimer);
        statusDiv.style.color = '#c00';
        statusDiv.textContent = 'Gagal: ' + e.message;
        sendBtn.disabled = false; cancelBtn.disabled = false; sendBtn.textContent = 'Kirim ke AI';
      });
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(sendBtn);
    pop.appendChild(btnRow);
    document.body.appendChild(pop);
    textarea.focus();
  }

  // ---------- Pasang highlight + listener klik + tombol per-section ----------
  function attachSectionButtons(){
    if (!window.__getSiteData) return false;
    var siteData = window.__getSiteData();
    var sectionOrder = (siteData && siteData.sectionOrder) || (siteData && Object.keys(siteData.sections || {})) || [];
    var found = false;

    sectionOrder.forEach(function(name){
      var el = document.getElementById(name);
      if (!el || el.dataset.__sectionBtnAttached) return;
      found = true;
      el.dataset.__sectionBtnAttached = '1';

      var computed = window.getComputedStyle(el);
      if (computed.position === 'static') el.style.position = 'relative';

      var btn = document.createElement('button');
      btn.textContent = '📦 Edit Section';
      btn.style.cssText = 'position:absolute;top:10px;left:10px;z-index:99997;background:#1a1d23;color:#fff;border:none;padding:6px 12px;border-radius:20px;font-size:11px;cursor:pointer;font-family:-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;';
      el.appendChild(btn);

      el.addEventListener('mouseenter', function(){ btn.style.opacity = '1'; });
      el.addEventListener('mouseleave', function(){ btn.style.opacity = '0'; });

      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        openSectionPanel(el, name);
      });
    });
    return found;
  }

  function init(){
    var styleTag = document.createElement('style');
    styleTag.textContent = '[data-edit]:hover{ outline:2px dashed #5eead4 !important; outline-offset:2px; cursor:pointer !important; }';
    document.head.appendChild(styleTag);

    document.addEventListener('click', function(e){
      var el = e.target.closest && e.target.closest('[data-edit]');
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      openChoiceMenu(el);
    }, true);

    (function retrySectionButtons(attempt){
      attempt = attempt || 0;
      var ok = attachSectionButtons();
      if (!ok && attempt < 15) {
        setTimeout(function(){ retrySectionButtons(attempt + 1); }, 500);
      } else {
        setInterval(attachSectionButtons, 2000);
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

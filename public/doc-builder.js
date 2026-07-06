// ============================================================================
// File bareng: fungsi buat 'membungkus' kode HTML/React jadi halaman siap-preview
// (dipakai di Studio /app dan Prompt Generator, satu sumber doang, anti-silo)
// ============================================================================

// ---------- ID project (dipakai buat kunci data live di server) ----------
// Dibuat dari isi kode itu sendiri, jadi otomatis konsisten tanpa perlu simpan dulu.
function hashCode(str){
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h;
  }
  return 'p' + Math.abs(h).toString(36);
}

// ---------- Shim untuk Firebase, ikon, chart, dll (semua lokal, tanpa internet) ----------
const RUNNER_SHIMS_SRC = `
window.__firebaseShim = (function(){
  var __store = window.__initialFirestoreStore ? JSON.parse(JSON.stringify(window.__initialFirestoreStore)) : {};
  var __listeners = [];
  var __syncTimer = null;
  function __sync(){
    clearTimeout(__syncTimer);
    __syncTimer = setTimeout(function(){
      try {
        var base = window.__dataEndpointBase || '/api/data/';
        fetch(base + encodeURIComponent(window.__projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(__store)
        }).catch(function(){});
      } catch(e) {}
    }, 250);
  }
  function __path(ref){ return ref.__path; }
  function __docSnap(path){
    var data = __store[path];
    return { exists: function(){ return data !== undefined; }, data: function(){ return data; }, id: path.split('/').pop() };
  }
  function __colSnap(path){
    var docs = Object.keys(__store).filter(function(p){
      return p.indexOf(path + '/') === 0 && p.split('/').length === path.split('/').length + 1;
    }).map(function(p){ return { id: p.split('/').pop(), data: function(){ return __store[p]; } }; });
    return { empty: docs.length === 0, docs: docs, size: docs.length, forEach: function(fn){ docs.forEach(fn); } };
  }
  function __notify(path){
    __listeners.forEach(function(l){
      if (l.type === 'doc' && l.path === path) l.cb(__docSnap(path));
      else if (l.type === 'collection' && path.indexOf(l.path + '/') === 0) l.cb(__colSnap(l.path));
    });
  }
  return {
    initializeApp: function(config){ return { __mock: true, config: config }; },
    getAuth: function(){ return { __mock: true }; },
    signInAnonymously: function(){ return Promise.resolve({ user: { uid: 'preview-user' } }); },
    signInWithCustomToken: function(){ return Promise.resolve({ user: { uid: 'preview-user' } }); },
    onAuthStateChanged: function(auth, cb){ setTimeout(function(){ cb({ uid: 'preview-user' }); }, 0); return function(){}; },
    signOut: function(){ return Promise.resolve(); },
    getFirestore: function(){ return { __mock: true }; },
    collection: function(db){ var segs = Array.prototype.slice.call(arguments, 1); return { __ref: true, type: 'collection', __path: segs.join('/') }; },
    doc: function(refOrDb){
      var segs = Array.prototype.slice.call(arguments, 1);
      var base = (refOrDb && refOrDb.__path) ? refOrDb.__path : '';
      var path;
      if (segs.length === 0) { path = base + '/' + Math.random().toString(36).slice(2, 10); }
      else { path = (base ? base + '/' : '') + segs.join('/'); }
      return { __ref: true, type: 'doc', __path: path };
    },
    setDoc: function(ref, data, opts){
      var path = __path(ref);
      __store[path] = (opts && opts.merge && __store[path]) ? Object.assign({}, __store[path], data) : Object.assign({}, data);
      __notify(path); __notify(path.split('/').slice(0, -1).join('/'));
      __sync();
      return Promise.resolve();
    },
    addDoc: function(ref, data){
      var path = __path(ref) + '/' + Math.random().toString(36).slice(2, 10);
      __store[path] = Object.assign({}, data);
      __notify(path); __notify(__path(ref));
      __sync();
      return Promise.resolve({ id: path.split('/').pop() });
    },
    updateDoc: function(ref, data){
      var path = __path(ref);
      __store[path] = Object.assign({}, __store[path] || {}, data);
      __notify(path); __notify(path.split('/').slice(0, -1).join('/'));
      __sync();
      return Promise.resolve();
    },
    deleteDoc: function(ref){
      var path = __path(ref);
      delete __store[path];
      __notify(path); __notify(path.split('/').slice(0, -1).join('/'));
      __sync();
      return Promise.resolve();
    },
    onSnapshot: function(ref, cb){
      __listeners.push({ type: ref.type, path: ref.__path, cb: cb });
      setTimeout(function(){ cb(ref.type === 'doc' ? __docSnap(ref.__path) : __colSnap(ref.__path)); }, 0);
      return function(){};
    },
    getDocs: function(ref){ return Promise.resolve(ref.type === 'doc' ? __docSnap(ref.__path) : __colSnap(ref.__path)); },
    getDoc: function(ref){ return Promise.resolve(__docSnap(ref.__path)); },
    query: function(ref){ return ref; },
    where: function(){ return {}; },
    orderBy: function(){ return {}; },
    limit: function(){ return {}; },
    serverTimestamp: function(){ return Date.now(); },
    getStorage: function(){ return { __mock: true }; },
    ref: function(storage, path){ return { __mock: true, __path: path }; },
    uploadBytes: function(storageRef, file){
      return new Promise(function(resolve, reject){
        try {
          if (!file || typeof file.arrayBuffer !== 'function' && !(file instanceof Blob)) {
            // bukan File/Blob asli, gak bisa dibaca -> tetep resolve biar kode gak crash
            resolve({ ref: storageRef, metadata: {} });
            return;
          }
          var reader = new FileReader();
          reader.onload = function(){
            storageRef.__dataUrl = reader.result; // simpan hasil upload sebagai teks base64 di ref-nya
            resolve({ ref: storageRef, metadata: {} });
          };
          reader.onerror = function(){ reject(new Error('Gagal membaca file yang diupload')); };
          reader.readAsDataURL(file);
        } catch (e) { reject(e); }
      });
    },
    getDownloadURL: function(storageRef){
      return Promise.resolve(storageRef && storageRef.__dataUrl ? storageRef.__dataUrl : 'https://placehold.co/600x400?text=No+Image');
    }
  };
})();

window.__lucideShim = new Proxy({}, {
  get: function(target, prop){
    if (typeof prop !== 'string' || prop === 'default') return undefined;
    return function(props){
      props = props || {};
      return React.createElement('svg', Object.assign({
        xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round'
      }, props), React.createElement('circle', { cx: 12, cy: 12, r: 9 }));
    };
  }
});

window.__rechartsShim = new Proxy({}, {
  get: function(target, prop){
    return function(props){
      props = props || {};
      return React.createElement('div', { style: { padding: 10, border: '1px dashed #b7b7b7', borderRadius: 8, color: '#8a8a8a', fontSize: 12, textAlign: 'center' } }, props.children || ('[chart: ' + String(prop) + ']'));
    };
  }
});

window.__framerShim = new Proxy({}, {
  get: function(target, prop){
    if (prop === 'motion') {
      return new Proxy({}, {
        get: function(t2, tag){
          return function(props){ props = props || {}; return React.createElement(String(tag), props, props.children); };
        }
      });
    }
    if (prop === 'AnimatePresence') return function(props){ return React.createElement(React.Fragment, null, (props || {}).children); };
    return function(props){ return React.createElement('div', props, (props || {}).children); };
  }
});

window.__genericShim = function(name){
  var fn = function(){
    var args = Array.prototype.slice.call(arguments);
    return args.filter(Boolean).join(' ');
  };
  return new Proxy(fn, {
    get: function(target, prop){
      if (prop === 'default') return fn;
      return function(props){ return React.createElement('div', props, (props || {}).children); };
    }
  });
};
`;

// ---------- Mode Edit: klik-langsung buat orang awam (cuma jalan di preview tool, bukan halaman publik) ----------
// Skrip Mode Edit (manual) + Edit dengan AI sekarang jadi 1 file bareng: /overlay-editor.js
// (dipakai juga sama halaman prompt-generator.html, biar gak ada kode yang keduplikat)

// ---------- Ubah "import ... from '...';" jadi ambil dari shim global (tanpa internet) ----------
function moduleToGlobalExpr(name){
  if (name === 'react') return 'window.React';
  if (name === 'react-dom' || name === 'react-dom/client') return 'window.ReactDOM';
  if (name.indexOf('firebase') === 0) return 'window.__firebaseShim';
  if (name === 'lucide-react') return 'window.__lucideShim';
  if (name === 'recharts') return 'window.__rechartsShim';
  if (name === 'framer-motion') return 'window.__framerShim';
  return "window.__genericShim('" + name.replace(/'/g, "") + "')";
}

function rewriteImports(code){
  return code.replace(/import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/g, function(match, bindings, moduleName){
    const glob = moduleToGlobalExpr(moduleName);
    bindings = bindings.trim();
    let m;
    if ((m = bindings.match(/^\*\s+as\s+(\w+)$/))) {
      return `const ${m[1]} = ${glob};`;
    }
    if ((m = bindings.match(/^(\w+)\s*,\s*\{([^}]*)\}$/))) {
      return `const ${m[1]} = (${glob}).default !== undefined ? (${glob}).default : (${glob}); const {${m[2]}} = ${glob};`;
    }
    if ((m = bindings.match(/^\{([^}]*)\}$/))) {
      return `const {${m[1]}} = ${glob};`;
    }
    if ((m = bindings.match(/^(\w+)$/))) {
      return `const ${m[1]} = (${glob}).default !== undefined ? (${glob}).default : (${glob});`;
    }
    return '';
  });
}

function extractDefaultComponentName(code){
  let m;
  if ((m = code.match(/export\s+default\s+function\s+(\w+)/))) return m[1];
  if ((m = code.match(/export\s+default\s+class\s+(\w+)/))) return m[1];
  if ((m = code.match(/export\s+default\s+(\w+)\s*;/))) return m[1];
  return null;
}

function stripExports(code){
  code = code.replace(/export\s+default\s+function\s+(\w+)/, 'function $1');
  code = code.replace(/export\s+default\s+class\s+(\w+)/, 'class $1');
  code = code.replace(/export\s+default\s+\w+\s*;/g, '');
  code = code.replace(/export\s+\{[^}]*\}\s*;?/g, '');
  code = code.replace(/export\s+const\s/g, 'const ');
  code = code.replace(/export\s+function\s/g, 'function ');
  return code;
}

// ---------- Build & run preview ----------
function errorDoc(message){
  return `<!DOCTYPE html><html><body style="margin:0;background:#1a0000;color:#ff9c9c;font-family:ui-monospace,monospace;font-size:13px;padding:24px;white-space:pre-wrap;">${message.replace(/</g,'&lt;')}</body></html>`;
}

function buildReactDoc(code, options){
  options = options || {};
  let componentName = extractDefaultComponentName(code) || 'App';
  let processed = rewriteImports(code);
  processed = stripExports(processed);

  let transformed;
  try {
    transformed = Babel.transform(processed, { presets: ['react'] }).code;
  } catch (e) {
    return errorDoc('Gagal mem-parsing kode (syntax error):\n' + e.message);
  }

  const mountCode = `
;(function(){
  try {
    var __Comp = (typeof ${componentName} !== 'undefined') ? ${componentName} : (typeof App !== 'undefined' ? App : null);
    if (!__Comp) throw new Error('Tidak ditemukan komponen React untuk dirender. Pastikan ada "export default function NamaKomponen() {...}" di kode.');
    var __root = ReactDOM.createRoot(document.getElementById('root'));
    __root.render(React.createElement(__Comp));
  } catch (e) {
    var el = document.getElementById('error-overlay');
    el.style.display = 'block';
    el.textContent = 'Error saat render:\n' + e.message + (e.stack ? '\n\n' + e.stack : '');
  }
})();`;

  const dataEndpointBase = options.dataEndpointBase || '/api/data/';
  const dataKey = options.dataKey || hashCode(code.trim());
  const enableEditOverlay = true; // manual edit (teks/angka/gambar) aktif di preview MAUPUN halaman live/publish
  const aiEditEndpoint = dataEndpointBase === '/api/data/' ? '/api/edit-section' : null; // null = mati di halaman live/publish
  const combined = RUNNER_SHIMS_SRC + '\n' + transformed + '\n' + mountCode;
  const combinedEscaped = JSON.stringify(combined);

  const bootScript = `
  // Ambil data yang sudah tersimpan di server DULU, baru jalankan komponennya.
  // Ini penting biar data lama tidak ketiban/ketimpa data bawaan kode tiap kali dibuka.
  (function(){
    fetch(window.__dataEndpointBase + encodeURIComponent(window.__projectId))
      .then(function(r){ return r.ok ? r.json() : {}; })
      .catch(function(){ return {}; })
      .then(function(store){
        window.__initialFirestoreStore = store || {};
        var badge = document.getElementById('loading-badge');
        if (badge) badge.remove();
        var s = document.createElement('script');
        s.textContent = ${combinedEscaped};
        document.body.appendChild(s);
      });
  })();`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"><\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
  #error-overlay{
    display:none;position:fixed;inset:0;background:#1a0000;color:#ff9c9c;
    font-family:ui-monospace,monospace;font-size:13px;padding:24px;white-space:pre-wrap;
    overflow:auto;z-index:9999;line-height:1.6;
  }
  #loading-badge{
    position:fixed;bottom:10px;right:10px;background:#111;color:#8b93a1;font-size:11px;
    padding:4px 8px;border-radius:5px;font-family:ui-monospace,monospace;z-index:9998;
  }
</style>
</head>
<body>
<div id="root"></div>
<div id="error-overlay"></div>
<div id="loading-badge">Memuat data...</div>
<script>
  window.__app_id = 'preview-app';
  window.__firebase_config = '{}';
  window.__projectId = ${JSON.stringify(dataKey)};
  window.__dataEndpointBase = ${JSON.stringify(dataEndpointBase)};
  window.__ENABLE_EDIT_OVERLAY = ${JSON.stringify(enableEditOverlay)};
  window.__aiEditEndpoint = ${JSON.stringify(aiEditEndpoint)};
  window.onerror = function(msg, src, line, col, err){
    var el = document.getElementById('error-overlay');
    el.style.display = 'block';
    el.textContent = 'Runtime error:\n' + msg + (err && err.stack ? '\n\n' + err.stack : '');
    return true;
  };
  window.addEventListener('unhandledrejection', function(e){
    var el = document.getElementById('error-overlay');
    el.style.display = 'block';
    el.textContent = 'Unhandled error:\n' + (e.reason && e.reason.stack ? e.reason.stack : e.reason);
  });
${bootScript}
<\/script>
<script src="/overlay-editor.js"><\/script>
</body>
</html>`;
}


function buildHtmlDoc(code, options){
  options = options || {};
  const dataEndpointBase = options.dataEndpointBase || '/api/data/';
  const dataKey = options.dataKey || hashCode(code.trim());
  const enableEditOverlay = true; // manual edit (teks/angka/gambar) aktif di preview MAUPUN halaman live/publish
  const aiEditEndpoint = dataEndpointBase === '/api/data/' ? '/api/edit-section' : null; // null = mati di halaman live/publish
  const bridgeTag = `<script>
    window.__projectId = ${JSON.stringify(dataKey)};
    window.__dataEndpointBase = ${JSON.stringify(dataEndpointBase)};
    window.__dataEndpoint = window.__dataEndpointBase + encodeURIComponent(window.__projectId);
    window.__ENABLE_EDIT_OVERLAY = ${JSON.stringify(enableEditOverlay)};
    window.__aiEditEndpoint = ${JSON.stringify(aiEditEndpoint)};
  <\/script>
  <script src="/overlay-editor.js"><\/script>`;

  const hasTailwind = /tailwindcss/i.test(code) || /cdn\.tailwindcss/i.test(code);
  const tailwindTag = hasTailwind ? '' : '<script src="https://cdn.tailwindcss.com"><\/script>';
  const looksFullDoc = /<html[\s>]/i.test(code);
  if (looksFullDoc) {
    return code.replace(/<head[^>]*>/i, (m) => m + bridgeTag + tailwindTag);
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" />${bridgeTag}${tailwindTag}</head><body>${code}</body></html>`;
}

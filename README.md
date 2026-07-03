# Live Preview Studio — Versi SaaS

Versi ini sudah ada:
- Login & daftar akun per tim
- Data tiap tim (kode & data preview) terpisah total, gak kecampur
- Paket Gratis (maksimal 3 project) & Pro (tanpa batas) pakai pembayaran Midtrans

Sudah saya tes langsung (daftar akun, simpan project, kena limit paket gratis, isolasi data antar tim) — semua jalan normal.

## 1. Install

```
npm install
```

## 2. Setting kunci rahasia & Midtrans

Copy file `.env.example` jadi `.env`:
```
cp .env.example .env
```

Buka file `.env`, isi:
- `SESSION_SECRET` — ketik teks acak sendiri, minimal 20 karakter (buat keamanan login)
- `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` — ambil dari akun Midtrans kamu:
  1. Daftar/masuk ke https://dashboard.midtrans.com
  2. Buka menu **Settings > Access Keys**
  3. Copy **Server Key** dan **Client Key** (pakai yang "Sandbox" dulu buat coba-coba, nanti ganti ke "Production" kalau udah siap jualan beneran)

## 3. Jalankan

```
npm start
```

Buka `http://localhost:3000` di browser. Otomatis diarahkan ke halaman daftar/login.

## 4. Kalau mau pindah dari mode testing ke mode jualan beneran

Ada 2 tempat yang perlu diganti:

1. Di file `.env`: `MIDTRANS_IS_PRODUCTION=true`
2. Di file `public/billing.html`, cari baris ini:
   ```html
   <script src="https://app.sandbox.midtrans.com/snap/snap.js"></script>
   ```
   Ganti jadi:
   ```html
   <script src="https://app.midtrans.com/snap/snap.js"></script>
   ```
   (hapus kata "sandbox"-nya)

Terus di `.env`, ganti `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` pakai yang versi Production (bukan Sandbox lagi).

## 5. Biar webhook pembayaran jalan otomatis

Midtrans perlu tau ke mana harus ngasih tau kalau ada pembayaran masuk. Di dashboard Midtrans:
1. Buka **Settings > Configuration**
2. Isi **Payment Notification URL** dengan: `https://domainkamu.com/api/billing/webhook`

Kalau ini gak di-set, pembayaran tetap bisa masuk tapi status "Pro" pengguna gak otomatis aktif.

## 6. Deploy ke VPS

Sama seperti sebelumnya:
```
npm install -g pm2
pm2 start server.js --name live-preview-saas
pm2 save
pm2 startup
```

Terus pasang Nginx reverse proxy (lihat contoh config di project sebelumnya) supaya bisa diakses pakai domain + HTTPS. **HTTPS wajib** buat Midtrans production (bukan sandbox).

## Struktur data (masih pakai file JSON, belum Postgres)

```
data/
  users.json     -> daftar user + password (di-hash, aman)
  orgs.json      -> daftar tim + status paket (gratis/pro)
  snippets.json  -> kode yang disimpan, ditandai punya tim mana
  store.json     -> data live preview, dikelompokkan per tim > per project
```

Ini cukup buat awal (puluhan-ratusan tim). Kalau nanti user udah ratusan/ribuan dan mulai berat, tinggal pindahin ke PostgreSQL — strukturnya sudah rapi jadi gampang dimigrasi nanti.

## Batasan paket Gratis

Sekarang cuma dibatasi **jumlah project tersimpan (maksimal 3)**. Kalau mau nambah batasan lain (misal fitur tertentu dikunci), bilang aja, saya tambahin.

## Catatan penting

- Ini baru langganan **1 bulan manual** (bukan auto-recurring/re-charge otomatis tiap bulan). Kalau mau bikin otomatis re-charge tiap bulan, Midtrans punya fitur khusus "Subscription" yang beda dari Snap — bisa ditambahin belakangan kalau produknya udah jalan.
- Ganti `SESSION_SECRET` sebelum dipakai beneran — jangan pakai contoh yang ada di `.env.example`.

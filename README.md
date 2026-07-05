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

## Database: PostgreSQL

Aplikasi ini jalan di Railway. Cara nyalain database-nya:

1. Buka project kamu di Railway
2. Klik **+ New** → **Database** → **PostgreSQL**
3. Railway otomatis bikin database dan otomatis isi `DATABASE_URL` buat aplikasi ini — gak perlu setting manual apa pun
4. Redeploy (biasanya Railway restart otomatis)

Begitu aplikasi nyala, dia otomatis bikin semua tabel yang dibutuhin sendiri (users, orgs, snippets, project_data, publishes, public_data).

Kalau mau tes di komputer sendiri dulu, isi `DATABASE_URL` di file `.env`:
```
DATABASE_URL=postgres://postgres:password@localhost:5432/live_preview
```

## Fitur Publish (jadi website beneran)

Setelah project di-Run dan tampilannya udah pas, klik tombol **🚀 Publish** di preview:
1. Isi **slug** — ini jadi alamatnya, misal `exist-detailing` jadi `https://domainkamu.com/p/exist-detailing`
2. (Opsional) isi **custom domain** kalau punya domain sendiri buat project itu

### Biar custom domain aktif

1. Beli/punya domain (misal `existdetailing.com`)
2. Di pengaturan DNS domain itu, tambahkan record:
   - Tipe **A** mengarah ke IP VPS kamu, ATAU
   - Tipe **CNAME** mengarah ke domain utama tempat aplikasi ini jalan
3. Kalau mau HTTPS otomatis buat domain-domain custom ini, sebaiknya taruh **Caddy** di depan aplikasi ini (bukan Nginx biasa) — Caddy bisa otomatis bikinin sertifikat HTTPS buat domain apa aja yang diarahkan ke dia, tanpa setting manual. Nanti tinggal bilang kalau mau saya bantu buatin config Caddy-nya.

### Catatan soal publish

- Kode React yang dipublish itu **cuma tampilan (snapshot)** dari data terakhir pas kamu klik Publish. Kalau nanti kamu ubah data lagi lewat panel admin di preview, halaman yang sudah dipublish **gak otomatis ikut berubah** — perlu klik Publish ulang.
- 1 slug cuma bisa dipakai 1 tim. Kalau slug udah dipakai tim lain, akan ditolak otomatis.
- Halaman yang sudah dipublish bisa dibuka siapa aja tanpa perlu login (memang tujuannya buat publik).

## Fitur Generate Otomatis (AI langsung bikin kode)

Di halaman Prompt Generator, sekarang ada tombol **🤖 Generate Otomatis** di samping "Generate Prompt". Bedanya:
- **Generate Prompt** → kamu copy manual ke Gemini/Claude sendiri
- **Generate Otomatis** → AI langsung bikin kodenya dari server, hasilnya langsung kebuka di tool preview

### Setup yang dibutuhkan

1. Buat akun di https://console.anthropic.com kalau belum ada
2. Buka menu **API Keys** → **Create Key**
3. Copy key-nya (mulai dengan `sk-ant-...`)
4. Di Railway, buka service aplikasi kamu → tab **Variables** → tambahkan:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
5. Redeploy

### Biaya

Ini bukan gratis dari Anthropic — tiap kali generate, server kamu bayar ke Anthropic sesuai jumlah token yang dipakai (biasanya beberapa ratus sampai beberapa ribu Rupiah per halaman, tergantung kompleksitas). Karena itu ada batasan:
- **Paket gratis**: 3 kali generate otomatis (total, bukan per bulan)
- **Paket Pro**: tanpa batas

Kalau mau ganti model AI yang dipakai, tambahkan env var `ANTHROPIC_MODEL` di Railway (defaultnya `claude-sonnet-5`).

## Batasan paket Gratis

Sekarang cuma dibatasi **jumlah project tersimpan (maksimal 3)**. Kalau mau nambah batasan lain (misal fitur tertentu dikunci), bilang aja, saya tambahin.

## Catatan penting

- Ini baru langganan **1 bulan manual** (bukan auto-recurring/re-charge otomatis tiap bulan). Kalau mau bikin otomatis re-charge tiap bulan, Midtrans punya fitur khusus "Subscription" yang beda dari Snap — bisa ditambahin belakangan kalau produknya udah jalan.
- Ganti `SESSION_SECRET` sebelum dipakai beneran — jangan pakai contoh yang ada di `.env.example`.

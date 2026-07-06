# Dokumentasi Live Preview Studio

*Panduan lengkap cara pakai platform ini, ditulis sesimpel mungkin.*

---

## Daftar Isi

1. [Apa Itu Live Preview Studio](#1-apa-itu-live-preview-studio)
2. [Struktur Akun](#2-struktur-akun)
3. [Dashboard](#3-dashboard)
4. [Studio (Alat Utama)](#4-studio-alat-utama)
5. [Prompt Generator (Bikin Halaman Pakai AI)](#5-prompt-generator-bikin-halaman-pakai-ai)
6. [Panel Admin Situs (Buat Pemilik Website)](#6-panel-admin-situs-buat-pemilik-website)
7. [Panel Superadmin (Buat Pemilik Platform)](#7-panel-superadmin-buat-pemilik-platform)
8. [Paket dan Token](#8-paket-dan-token)
9. [Domain Kustom](#9-domain-kustom)
10. [Contoh Alur Kerja dari Awal sampai Selesai](#10-contoh-alur-kerja-dari-awal-sampai-selesai)
11. [Istilah-Istilah Penting](#11-istilah-istilah-penting)
12. [Pertanyaan yang Sering Muncul](#12-pertanyaan-yang-sering-muncul)

---

## 1. Apa Itu Live Preview Studio

Live Preview Studio itu alat buat **bikin halaman website** dengan cepat, bisa ditulis manual atau dibikinin sama AI. Cocok banget buat kamu yang jualan jasa bikin website — tinggal isi form, AI yang bikin kodenya, kamu tinggal edit dikit, terus publish.

Beberapa hal yang bikin platform ini beda dari yang lain:

- **AI-nya udah dilatih pakai gaya jualan Alex Hormozi**, jadi tulisan di websitenya lebih persuasif, bukan cuma cantik doang
- **Bisa diedit langsung tanpa buka kode** — klik teks, ganti, selesai
- **Data pengunjung yang masukin form/dll beneran tersimpan**, gak ilang pas refresh
- **Bisa pasang domain sendiri** (punya kamu, bukan subdomain platform)

---

## 2. Struktur Akun

Biar gampang, bayangin kayak lemari dengan beberapa tingkat:

```
Tim (akun kamu)
 └── Workspace (biasanya 1 workspace = 1 klien)
      └── Halaman (bisa banyak halaman per workspace)
           └── Publish (kalau halamannya udah di-online-in)
```

### Tim
Ini akun utama kamu. 1 tim bisa punya banyak **Anggota** (kalau kamu kerja bareng orang lain).

### Workspace
Disaranin: **1 Workspace = 1 klien**. Jadi kalau kamu punya 5 klien, bikin 5 workspace, biar gak ketuker-tuker.

### Anggota
Tiap workspace bisa diisi orang lain (misal klien kamu sendiri, biar bisa ikut liat progresnya). Diundang lewat tombol **"👥 Anggota"** di Studio, cukup isi email + password.

### Halaman
Di dalam 1 workspace, kamu bisa bikin banyak halaman (draft-draft, atau halaman final).

### Publish
Kalau halamannya udah oke, di-publish supaya bisa diakses publik lewat link (`namadomain.com/p/nama-slug`) atau domain sendiri.

---

## 3. Dashboard

Ini halaman pertama yang kebuka setelah kamu login (`/dashboard.html`).

Isinya:
- **Info akun kamu**: paket yang dipakai (Gratis/Pro), sisa token AI, jenis membership (Owner/Anggota), nama tim
- **Kartu tiap Workspace**: nama workspace, jumlah halaman yang udah publish vs masih draft
- Klik kartu-nya buat langsung masuk ke Studio buat workspace itu
- Ada juga tombol cepat "📰 Generate Articles" di tiap kartu

---

## 4. Studio (Alat Utama)

Ini "ruang kerja" utamanya, buka lewat `/app`. Tampilannya kayak code editor (ada mode terang/gelap juga, tinggal klik 🌙/☀️ di pojok kanan atas).

### Bagian-bagiannya
- **Sidebar kiri**: pilih Workspace, daftar halaman di workspace itu, tombol tambah Workspace/Anggota/Domain Kustom
- **Kotak kode**: tempat nempel/nulis kode (bisa React atau HTML biasa)
- **Preview**: hasil tampilannya langsung kelihatan di kanan

### Tombol-tombol penting
| Tombol | Fungsinya |
|---|---|
| Run | Jalanin kode yang di kotak kiri, tampil di preview |
| Simpan | Simpan project. Kalau udah pernah disimpan, tinggal update (gak nanya nama lagi) |
| 🚀 Publish | Bikin halaman ini online. Kalau udah pernah publish, tombolnya berubah jadi "🔄 Update Publikasi" |
| Reset data | Hapus semua data yang udah diisi pengunjung di preview (balik ke kondisi awal) |

### Edit Langsung di Preview
Di Studio, arahkan mouse ke bagian mana pun di preview:
- **Hover section** → muncul tombol "📦 Edit Section" → buka panel isinya semua bagian yang bisa diubah
- **Klik langsung ke teks/gambar** → muncul pilihan **"✏️ Edit Langsung"** (ganti manual) atau **"✨ Edit dengan AI"** (kasih instruksi, AI yang ubahin)

> Catatan penting: fitur edit ini (baik manual maupun AI) **cuma jalan di Studio/preview**. Begitu halamannya udah live/publish, editnya harus lewat Panel Admin (lihat bagian 6).

---

## 5. Prompt Generator (Bikin Halaman Pakai AI)

Buka lewat menu **"🧠 Prompt Generator"**. Ini tempat isi form, nanti otomatis jadi instruksi buat AI, terus AI yang bikinin halamannya.

### Yang perlu diisi
- **Format Output**: HTML Lengkap (siap publish sendiri) atau React (komponen doang, dibungkus otomatis)
- **Nama Bisnis**, **Jenis Bisnis**, **Target Audiens**
- **Informasi Tambahan** (opsional): hal khusus yang perlu AI tau (sejarah, keunggulan, promo)
- **Batasan/Larangan** (opsional): hal yang AI JANGAN lakukan (misal jangan sebut kompetitor)
- **Referensi** (opsional): link website contoh, atau upload gambar/poster yang mau dijadiin acuan gaya
- **Section yang mau ada**: hero, tentang, layanan, harga, testimoni, dll — tinggal klik nyalain/matiin
- **Gaya Visual**: 6 pilihan (Glassmorphism, Neumorphism, Neobrutalism, Bento Grid, Dark Mode Elegan, Modern Minimalis), atau biarin AI yang pilih
- **Layout**: 5 pilihan susunan halaman, atau biarin AI yang pilih
- **Warna**: pilih dari palet, pakai color picker sendiri, atau biarin AI yang pilih
- **Fitur Tambahan**: WhatsApp mengambang, Google Maps beneran, form kontak, dll

### Tombol Draft
Sebelum generate, bisa klik **"💾 Simpan Draft"** buat nyimpen semua isian form (biar gak perlu isi ulang kalau mau coba variasi lain). Nanti tinggal klik **"📂 Muat Draft"**.

### Setelah Generate
Hasilnya langsung tampil di preview (bukan cuma teks kode). Dari situ bisa:
- Edit per section (manual atau AI), sama kayak di Studio
- Isi nama project + pilih Workspace
- Klik **"💾 Simpan ke Workspace"**

### Kalau Hasilnya Kepotong
Kadang AI berhenti nulis di tengah jalan (kehabisan jatah token). Coba:
1. Kurangi jumlah section/fitur yang dipilih dulu
2. Generate ulang
3. Ganti model AI di Panel Superadmin (beberapa model "mikir dulu" diam-diam sebelum nulis, jadi boros token)

---

## 6. Panel Admin Situs (Buat Pemilik Website)

Ini panel khusus buat **pemilik website** (klien kamu), bukan buat kamu sebagai pembuatnya. Bedanya:

| | Studio | Panel Admin Situs |
|---|---|---|
| Buat siapa | Kamu (pembuat website) | Klien/pemilik website |
| Bisa edit pakai AI? | Ya | Tidak |
| Bisa edit manual? | Ya | Ya, lewat panel ini |
| Butuh login platform? | Ya (akun Live Preview Studio) | Tidak, cukup login situsnya sendiri |

### Cara Aksesnya
Setiap website yang dibikin otomatis punya tombol kecil **⚙️** mengambang di pojok kiri bawah. Klik itu, langsung ke panel admin situs itu.

### Login
Pakai username & password yang di-set pas generate. Kalau lupa atau situsnya belum pernah nyimpen data login sendiri, coba:
- Username: `admin`
- Password: **kosongin**

Habis masuk, langsung ganti username & password di panel biar aman.

### Isi Panel Admin
- **Toggle Section**: nyalain/matiin tampilnya tiap bagian halaman
- **Edit Data (mode lanjutan)**: kotak teks JSON per section, buat jaga-jaga
- **Ganti Username & Password**

> Catatan: klik-langsung edit di halaman depan (buat pengunjung biasa) **sengaja dimatiin**. Semua perubahan konten harus lewat Panel Admin ini, biar gak sembarang orang bisa ngedit.

---

## 7. Panel Superadmin (Buat Pemilik Platform)

Ini panel **cuma buat kamu** (pemilik platform), buka lewat `/superadmin.html`. Aksesnya diatur pakai email — cuma email yang didaftarin di `SUPERADMIN_EMAILS` (env var Railway) yang bisa masuk.

### Isinya
- **Ringkasan angka**: total tim, tim Pro, user, workspace, halaman, publish, generate AI, total token terpakai, estimasi biaya
- **📦 Pengaturan Paket**: atur batasan tiap paket (Gratis/Pro) — jumlah workspace, halaman per workspace, member per workspace, kuota token
- **⚙️ Pengaturan AI**: pilih provider (Anthropic langsung atau Sumopod), ganti model, atur API key
- **Tabel semua tim**: bisa cari, lihat saldo token tiap tim, dan **Top Up** token manual kalau ada yang minta tambahan

---

## 8. Paket dan Token

Setiap tim punya **saldo token** (bukan lagi hitungan "berapa kali boleh generate"). Token ini kepake tiap kali:
- Generate halaman baru
- Edit section pakai AI

### Kalau Token Habis
Muncul pesan buat top up (hubungi admin platform) atau upgrade ke Pro (token gak terbatas).

### Kenapa Sistemnya Gini
Karena tiap generate makan biaya beda-beda (situs simpel vs situs kompleks beda jauh token-nya), sistem saldo lebih adil dibanding "jatah X kali doang".

---

## 9. Domain Kustom

Tiap **Workspace** bisa dipasangin 1 domain sendiri (misal `namaklien.com`, bukan cuma subdomain platform).

### Cara Setting (Ringkasnya)
1. Buka tombol **"🌐 Domain Kustom"** di Studio
2. Isi domainnya, klik Simpan
3. Ikutin panduan Cloudflare yang muncul (gratis): ganti nameserver, tambah record CNAME, nyalain proxy (awan oranye), set SSL ke "Full"

### Target CNAME-nya Selalu Sama
Gak peduli berapa pun banyaknya domain/klien, **Target CNAME-nya selalu sama** (domain Railway platform kamu). Yang beda cuma domain punya klien-nya doang.

### Bagikan Panduan ke Klien
Ada tombol **"📤 Bagikan Panduan ke Klien"** — otomatis bikin link panduan setting domain yang udah keisi data domain klien itu, tinggal kirim lewat WhatsApp/email.

---

## 10. Contoh Alur Kerja dari Awal sampai Selesai

Misal ada orderan bikin website buat **"Warung Kopi Senja"**:

1. Buka **Dashboard**, klik **"+ Workspace Baru"**, kasih nama "Warung Kopi Senja"
2. Klik kartu workspace itu buat masuk **Studio**
3. Buka **Prompt Generator**, isi form: nama bisnis, jenis (kedai kopi), target audiens, pilih section (hero, tentang, menu, lokasi, kontak)
4. Klik **Generate Otomatis**, tunggu progress bar sampai selesai
5. Cek hasilnya di preview — kalau ada yang mau diubah, klik section-nya, pilih Edit Langsung atau Edit dengan AI
6. Kalau udah oke, isi nama project, pilih Workspace "Warung Kopi Senja", klik **Simpan ke Workspace**
7. Buka lagi di **Studio**, klik **🚀 Publish**, isi slug (misal `warung-kopi-senja`)
8. Kalau klien punya domain sendiri, buka **🌐 Domain Kustom**, ikutin panduan setting-nya, bagikan link panduan ke klien
9. Kirim link websitenya + info login Panel Admin (⚙️) ke klien, biar mereka bisa ubah-ubah konten sendiri nanti

---

## 11. Istilah-Istilah Penting

| Istilah | Artinya |
|---|---|
| **Tim / Org** | Akun utama kamu di platform ini |
| **Workspace** | Ruang kerja per klien |
| **Snippet / Halaman** | 1 halaman website yang tersimpan |
| **Publish** | Proses bikin halaman jadi online/bisa diakses publik |
| **Slug** | Bagian belakang link (`/p/slug-ini`) |
| **Draft** | Halaman yang tersimpan tapi belum di-publish |
| **Token** | "Bensin" buat AI, kepake tiap generate/edit pakai AI |
| **Section** | 1 bagian halaman (hero, tentang, harga, dll) |
| **Data-edit** | Tanda di dalam kode yang bikin suatu bagian bisa diklik-edit |
| **Panel Admin Situs** | Panel buat pemilik website ngatur kontennya sendiri |
| **Panel Superadmin** | Panel buat pemilik platform (kamu) |

---

## 12. Pertanyaan yang Sering Muncul

**Q: Hasil generate AI kepotong terus, kenapa?**
A: Biasanya karena section/fitur yang dipilih kebanyakan, atau modelnya termasuk "model reasoning" yang boros token buat mikir dulu. Coba kurangi section, atau ganti model AI di Panel Superadmin.

**Q: Kok gak bisa edit langsung di halaman yang udah live?**
A: Itu emang sengaja dimatiin buat keamanan. Edit konten di halaman live cuma bisa lewat Panel Admin (klik ⚙️, login dulu).

**Q: Klien lupa password panel admin situsnya, gimana?**
A: Suruh coba login pakai username `admin` dan password dikosongin. Kalau situsnya emang belum pernah nyimpen data login sendiri, itu bakal berhasil. Habis itu langsung ganti di panel.

**Q: 1 domain bisa dipasang di lebih dari 1 workspace?**
A: Enggak, 1 domain cuma bisa dipasang di 1 workspace aja.

**Q: Token abis, gimana caranya nambah?**
A: Hubungi pemilik platform buat top up manual, atau upgrade ke paket Pro (token gak terbatas).

**Q: Bedanya "Simpan" sama "Publish" apa?**
A: "Simpan" itu nyimpen ke daftar halaman kamu (masih private, cuma kamu yang liat). "Publish" itu bikin halamannya bisa diakses publik lewat link.

---

*Dokumentasi ini dibuat otomatis berdasarkan fitur-fitur yang udah dibangun di platform Live Preview Studio.*

# Panduan klikweb.id — Buat Programmer / Tim

*Panduan buat kamu yang kerja bikin website buat klien lewat platform ini.*

---

## Daftar Isi

1. [Struktur Akun](#1-struktur-akun)
2. [Cara Masuk & Akses Studio](#2-cara-masuk--akses-studio)
3. [Dashboard](#3-dashboard)
4. [Prompt Generator — Bikin Website Pakai AI](#4-prompt-generator--bikin-website-pakai-ai)
5. [Studio — Edit Manual & Publish](#5-studio--edit-manual--publish)
6. [Format Link Website & Panel Admin](#6-format-link-website--panel-admin)
7. [Cara Serah Terima ke Klien](#7-cara-serah-terima-ke-klien)
8. [Domain Kustom Buat Klien](#8-domain-kustom-buat-klien)
9. [Troubleshooting Umum](#9-troubleshooting-umum)

---

## 1. Struktur Akun

```
Tim (akun kamu)
 └── Workspace (1 workspace = 1 klien)
      └── Halaman (bisa banyak halaman per klien)
           └── Publish (kalau halamannya udah di-online-in)
```

Disaranin: **1 Workspace = 1 klien**. Kalau ada 5 klien, bikin 5 workspace.

---

## 2. Cara Masuk & Akses Studio

- Login lewat `/login.html` pakai akun yang udah didaftarin
- **Penting:** akses ke Studio (`/app`) sekarang **dibatasi cuma buat tim**. Kalau email kamu belum didaftarin sama admin platform (lewat env var `ALLOWED_STUDIO_EMAILS` di Railway), kamu bakal ditolak masuk dan diarahin ke halaman "Akses Terbatas"
- Kalau ini kejadian, hubungi pemilik platform buat ditambahin ke daftar itu
- Buat bikin akun tim baru (bukan lewat pendaftaran publik), pakai link internal: **`/amelt`**

---

## 3. Dashboard

Halaman pertama setelah login (`/dashboard.html`). Isinya:
- Sidebar kiri: menu ke Studio, Upgrade
- Kartu statistik: paket, sisa token AI, jenis membership, jumlah workspace
- Daftar workspace kamu, klik buat langsung masuk Studio

---

## 4. Prompt Generator — Bikin Website Pakai AI

Buka dari Studio atau Dashboard (tombol "📰 Generate Articles" di kartu workspace).

### Cara Cepat: Ketik Bebas
Ada kotak **"💬 Ketik Bebas Aja"** di paling atas form. Tinggal ketik apa yang kamu mau, contoh:
> "Bikin website warung kopi saya namanya Kopi Senja, target anak muda, section hero/menu/lokasi/kontak WA"

Kalau kotak ini diisi, semua field detail di bawah dilewatin — AI langsung generate dari situ.

### Cara Detail: Isi Form Satu-Satu
Kalau mau atur lebih presisi, kosongin kotak "Ketik Bebas" dan isi:
- **Format Output**: HTML Lengkap atau React
- Nama bisnis, jenis bisnis, target audiens
- Informasi tambahan / batasan (opsional)
- Referensi (link contoh atau upload gambar, opsional)
- Section yang mau ada
- Gaya visual, layout, warna (bisa pilih sendiri atau biarin AI yang mutusin)
- Fitur tambahan (WA mengambang, Google Maps, form kontak, dll)

### Setelah Generate
- Preview langsung tampil, bisa diedit (manual atau AI) per section atau sekaligus
- Muncul kotak **"🔑 Login Panel Admin"** — CATAT username & password ini, nanti dikasih ke klien. Klik "Copy Info Login" buat langsung salin
- Isi nama project + pilih Workspace, klik **"💾 Simpan ke Workspace"**

### Kalau Hasil Kepotong
Biasanya soal model AI "reasoning" yang boros token buat mikir dulu. Coba: kurangi section, generate ulang, atau hubungi admin platform buat ganti model AI-nya.

---

## 5. Studio — Edit Manual & Publish

`/app` — tempat kerja utama. Bisa nempel kode manual (React/HTML) atau lanjutin dari Prompt Generator.

### Edit di Preview
- **Hover section** → tombol "📦 Edit Section" → buka panel semua bagian yang bisa diedit
- **Klik langsung** ke teks/gambar/tombol → pilih "Edit Langsung" (manual) atau "Edit dengan AI"
- Tombol CTA (link) bisa diedit teks **dan** link tujuannya sekaligus
- Tombol **"🪄 Edit Seluruh Halaman"** (pojok kanan bawah) — buat perubahan yang nyentuh banyak section sekaligus (misal ganti semua warna)

> Semua fitur edit ini (manual & AI) **cuma jalan di preview**. Begitu publish, editnya harus lewat Panel Admin klien.

### Publish
Klik **"🚀 Publish"**, isi slug (nama di link). Kalau udah pernah publish, tombolnya jadi "🔄 Update Publikasi" (1 klik, gak perlu isi ulang).

---

## 6. Format Link Website & Panel Admin

| Jenis | Format |
|---|---|
| Halaman live | `klikweb.id/nama-slug` |
| Panel Admin (buat klien) | `klikweb.id/nama-slug/admin` |

Panel Admin ini **gak ada tombol otomatis** di halaman live-nya (sengaja dihapus biar situsnya bersih) — jadi kamu **wajib kasih link ini manual** ke klien.

---

## 7. Cara Serah Terima ke Klien

Checklist tiap serah terima website:
1. ✅ Link website: `klikweb.id/nama-slug`
2. ✅ Link Panel Admin: `klikweb.id/nama-slug/admin`
3. ✅ Username & password admin (dari kotak "🔑 Login Panel Admin" pas generate)
4. ✅ (Kalau ada) info domain kustom yang lagi disetting

Kasih tau klien: mereka bisa toggle section, edit teks/angka/gambar, dan ganti username/password sendiri lewat Panel Admin itu — **tanpa fitur AI** (AI cuma buat kamu di Studio).

---

## 8. Domain Kustom Buat Klien

1. Buka **"🌐 Domain Kustom"** di sidebar Studio
2. Isi domain klien, Simpan
3. Klik **"📤 Bagikan Panduan ke Klien"** — otomatis copy link panduan setting DNS yang udah keisi data domainnya, tinggal kirim ke klien
4. Target CNAME-nya **selalu sama** buat semua domain (domain Railway platform kita), cuma nama domainnya yang beda-beda

---

## 9. Troubleshooting Umum

**Hasil generate kepotong** → kurangi section, generate ulang, atau hubungi admin platform buat naikin batas token AI-nya (apalagi buat model reasoning)

**"Unexpected token" error** → biasanya gangguan sesaat di infrastruktur, coba lagi beberapa saat

**Thumbnail gak muncul pas link dibagikan** → cek `seo.image` di data situs bukan base64 (harus URL asli). Platform otomatis cari gambar cadangan kalau yang utama base64/rusak

**Klien lupa password admin** → suruh coba `admin` / password kosong (fallback kalau situsnya belum pernah nyimpen data login sendiri)

**Gak bisa akses Studio** → cek email kamu udah ditambahin ke `ALLOWED_STUDIO_EMAILS` di Railway

---

*Panduan ini dibuat otomatis berdasarkan fitur-fitur yang udah dibangun di platform klikweb.id.*

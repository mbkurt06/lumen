# iPhone'da Lumen — yayınlamadan yerel HTTPS

Lumen'i internete yayınlamak gerekmez. Bu yöntem, ilk kurulumu Mac'in aynı Wi-Fi ağından yapar.

1. Mac'te `brew install mkcert` çalıştırın (Homebrew kurulu olmalı).
2. Proje kökünde `bash scripts/start-iphone-local.sh` çalıştırın.
3. Komutun gösterdiği **HTTP** adresine iPhone Safari'den gidip `lumen-local-ca.crt` sertifikasını indirin. iOS'ta **Ayarlar > Profil İndirildi > Yükle**, sonra **Ayarlar > Genel > Hakkında > Sertifika Güven Ayarları > Tam Güven** seçin.
4. Safari'de komutun yazdığı **HTTPS** adresine (ör. `https://192.168.1.15:3443`) gidin. Güvenli bağlantı kurulmalıdır.
5. Lumen'de oturum açın, **Ayarlar > Şimdi senkronize et** ile statik ve kişisel verileri indirin. Sayfayı yenileyin ve uygulama içindeki ekranları bir kez açın.
6. Safari'nin paylaşım menüsünden **Ana Ekrana Ekle** seçin ve kurulu uygulamayı en az bir kez çevrimiçiyken açın.
7. Wi-Fi ve mobil veriyi kapatıp ana ekran uygulamasını kapatın/yeniden açın. Offline açılmalıdır; bağlantı geri gelince değişiklikler senkronize edilir.

**Önemli:**
- `http://192.168...` güvenli köken değildir; Service Worker çalışmaz. Mutlaka **HTTPS** adresini kullanın.
- iPhone'da HTTPS sertifika güvenini onaylamak gerekir. Sertifikayı yalnızca **kendi Mac'inizden** yükleyin.
- Mac'te sertifika oluşturmak için **`mkcert -install`** yerel CA kurar. Özel anahtarlar `.local-https/` içindedir ve Git'e eklenmez.
- Yerel IP değişirse sertifika yeni IP için üretilmeli, iPhone ilk kurulumu tekrar yapmalıdır.
- Offline kullanılan veri, iPhone'un Safari/PWA saklama alanında bulunur. Safari/site verilerini silmeyin.
- Videolar, Google Calendar'ın canlı verileri ve internet tabanlı üçüncü taraf kaynaklar offline çalışmaz.
- Safari'nin depolama temizliği veya tamamlanmamış indirme durumunda offline erişim garanti edilemez. İlk açılıştan sonra **gerçek cihaz testi** zorunludur.
- `npm run dev` yerine bu betiğin çalıştırdığı production build kullanılır.

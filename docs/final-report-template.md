# Final Rapor Taslagi

## 1. Proje Basligi

Smart Museum Digital Twin: Hybrid IoT Monitoring and Control Using MQTT and CoAP

## 2. Projenin Amaci

Bu projenin amaci, muze ve arsiv ortamlarindaki IoT sensorlerinden gelen verileri MQTT ile gercek zamanli toplamak, CoAP ile hafif sorgu/kontrol islemleri yapmak ve her muze bolgesi icin guncel bir digital twin kaydi tutmaktir.

Sistem sicaklik, nem, isik maruziyeti, hareket/giris aktivitesi ve batarya verilerini izler. Dashboard bu verileri, aktif koruma risklerini ve actuator senkronizasyon durumunu gosterir.

## 3. Problem Tanimi

Muze ve arsivlerde eserlerin korunmasi icin ortam kosullarinin takip edilmesi gerekir. Yuksek sicaklik, asiri/dusuk nem, fazla isik maruziyeti, beklenmeyen hareket ve sensor bataryasinin bitmesi koruma acisindan risk olusturabilir.

Bu proje, bu problemi kucuk ve calisan bir IoT demosu ile gostermek icin tasarlanmistir.

## 4. Sistem Mimarisi

```text
Virtual/Physical Museum Sensor
        |
        | MQTT telemetry/status
        v
Local MQTT Broker + Digital Twin Service
        |
        | WebSocket/HTTP
        v
Dashboard

CoAP Client
        |
        | GET /devices, GET /summary, POST /devices/{id}/control
        v
CoAP Server -> MQTT command -> Device
```

## 5. Kullanilan Teknolojiler

1. Node.js
2. JavaScript
3. MQTT
4. CoAP
5. Express.js
6. Socket.IO
7. Three.js
8. HTML/CSS/JavaScript dashboard
9. Opsiyonel ESP32 + Arduino IDE

## 6. Demo Cihazlari

Varsayilan demo dort sanal muze sensoru baslatir:

```text
gallery-1    Normal sergi salonu
archive-1    Nem riski olan arsiv alani
exhibit-1    Isik/sicaklik riski olan eser alani
entrance-1   Hareket/giris sensoru
```

## 7. Digital Twin Modeli

Her bolge icin tutulan temel bilgiler:

1. `deviceId`
2. `name`
3. `type`
4. `connection.online`
5. `connection.lastMessageAt`
6. `telemetry`
7. `desired.led`
8. `reported.led`
9. `sync.state`
10. `decisionSupport.score`
11. `decisionSupport.riskLevel`
12. `decisionSupport.recommendedAction`
13. `decisionSupport.standards`
14. `alerts`
15. `history`

Dashboard'da `led` alani **Protection Actuator** olarak sunulur. Bu actuator gercek bir sistemde uyari isigi, fan, nem alma cihazi veya koruyucu isik kontrolu olarak dusunulebilir.

Actuator durumunda iki alan ayrilir:

```text
desired.led   Kullanici/server tarafinin istedigi hedef durum
reported.led  Cihazin gercekten uyguladigini bildirdigi son durum
```

Eger sensor offline ise veya bataryasi bitmisse yeni actuator komutu reddedilir. Boylece bataryasi biten bir cihaz icin dashboard yanlis sekilde "actuator calisti" izlenimi vermez.

## 8. Karar Destek Mekanizmasi

Sistemde backend tarafinda rule-based conservation decision support motoru bulunur. Bu motor her digital twin icin sensor verilerini secili koruma profiline gore degerlendirir ve `decisionSupport` alanini olusturur.

Karar destek ciktisi:

1. Risk skoru (`0-100`)
2. Risk seviyesi (`Low`, `Moderate`, `High`, `Critical`)
3. Onerilen aksiyon
4. Karara sebep olan faktorler
5. Kullanilan koruma profili ve esik degerleri

Kullanilan basitlestirilmis profiller:

```text
Mixed museum collection:      15-25C, 45-55% RH, light <=150 lx
Archive and paper storage:    10-25C, 30-50% RH, light <=150 lx
Sensitive organic exhibit:    15-25C, 45-55% RH, light <=50 lx
Entrance/access monitoring:   ortam takibi + hareket/giris sinyali
```

Bu araliklar demo icin basitlestirilmis olmakla birlikte Canadian Conservation Institute kaynaklarina dayandirilmistir:

```text
Incorrect relative humidity
https://www.canada.ca/en/conservation-institute/services/agents-deterioration/humidity.html

Care of Mounted Specimens and Pelts
https://www.canada.ca/en/conservation-institute/services/conservation-preservation-publications/canadian-conservation-institute-notes/care-mounted-specimens-pelts.html

Basic Care of Books
https://www.canada.ca/en/conservation-institute/services/conservation-preservation-publications/canadian-conservation-institute-notes/basic-care-books.html
```

## 9. MQTT Kullanimi

Cihazlar telemetry ve status mesajlarini MQTT topic'lerine gonderir:

```text
iot/devices/{deviceId}/telemetry
iot/devices/{deviceId}/status
```

Server cihazlara komut gondermek icin su topic'i kullanir:

```text
iot/devices/{deviceId}/commands
```

## 10. CoAP Kullanimi

CoAP hafif sorgu ve kontrol icin kullanilir:

```text
GET  /devices
GET  /summary
GET  /devices/{deviceId}
POST /devices/{deviceId}/control
```

CoAP komutu ornek:

```powershell
node src/coap-client.js control gallery-1 led on
```

Cihaz offline ise kontrol komutu basarili kabul edilmez. HTTP tarafinda `409 Conflict`, CoAP tarafinda `4.09 Conflict` doner.

## 11. Karar Kurallari ve Alarm Tipleri

Sistem tek bir global demo esigi yerine secili koruma profiline gore karar verir.

```text
Mixed collection:       15-25C, 45-55% RH, light <=150 lx
Archive/paper storage:  10-25C, 30-50% RH, light <=150 lx
Sensitive exhibit:      15-25C, 45-55% RH, light <=50 lx
Low battery:            20%
Offline timeout:        12 seconds
```

Karar faktorleri ve alarm tipleri:

```text
HIGH_TEMPERATURE
LOW_TEMPERATURE
HIGH_HUMIDITY
LOW_HUMIDITY
DAMP_MOULD_RISK
HIGH_LIGHT_EXPOSURE
MOTION_DETECTED
LOW_BATTERY
BATTERY_CRITICAL
DEVICE_OFFLINE
STATE_SYNC_PENDING
```

Her faktor risk skoruna agirlikli katkida bulunur. Dashboard'da skor, seviye, karar sebebi ve onerilen aksiyon gosterilir.

## 12. Dashboard

Dashboard su bolumleri icerir:

1. Total Zones, Online Sensors, Offline Sensors, Active Risks kartlari
2. Muze bolgesi listesi
3. Secili bolgenin digital twin bilgileri
4. Three.js tabanli 3D Smart Museum Command Center
5. Sicaklik/nem gecmis grafigi
6. Aktif koruma riskleri
7. Protection Actuator kontrolu
8. Ham digital twin JSON blogu

## 13. Test Senaryolari

1. Server baslatilir: `npm.cmd start`
2. Final hikaye modu baslatilir: `npm.cmd run devices:museum-story`
3. Dashboard acilir: `http://localhost:3000`
4. 3D sahnede dort muze bolgesi ve sensor node'lari gorulur.
5. MQTT ile telemetry akisi izlenir.
6. CoAP ile cihaz listesi ve summary sorgulanir.
7. Dashboard veya CoAP ile actuator kontrolu yapilir.
8. Risk alarmlari dashboard'da gosterilir.
9. `archive-1` sensorunun bataryasi azaldikca LOW_BATTERY alarmi gosterilir.
10. Batarya bittiginde `archive-1` offline olur ve 3D sahnede gri/offline olarak gosterilir.

Final hikaye modunda `archive-1` bataryasi yaklasik 75 saniyede biter. Bu sure, dashboard'un incelenmesi, digital twin JSON'un gosterilmesi ve actuator davranisinin anlatilmasi icin bilerek hizli batarya demosundan daha uzun tutulmustur.

## 14. RPL Hakkinda Not

RPL, dusuk guclu IPv6 mesh aglarda kullanilan bir routing protokoludur. Bu proje RPL kullanmaz; cunku secilen proje kapsami MQTT, CoAP, cihaz izleme/kontrol ve digital twin uzerinedir.

RPL, Contiki/Cooja veya gercek mesh ag simulasyonu eklenirse gelecek calisma olarak dusunulebilir.

## 15. Sonuc

Bu proje MQTT, CoAP ve digital twin kavramlarini muze/arsiv koruma senaryosu uzerinde birlestirir. Sistem sanal cihazlarla calistirilabilir, dashboard ile canli izlenebilir ve opsiyonel olarak ESP32 gibi fiziksel cihazlara genisletilebilir.

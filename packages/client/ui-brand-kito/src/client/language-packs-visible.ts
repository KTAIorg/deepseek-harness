/** Copy for the settings page, sidebar, and status line. Column order matches the shell pack. */

const IDS = ['hi', 'vi', 'th', 'id', 'my', 'fil', 'km', 'si', 'ne', 'lus', 'am', 'om', 'ar'] as const

type Row = readonly [string, string, string, string, string, string, string, string, string, string, string, string, string]

function assemble(namespaces: Record<string, Record<string, Row>>): Record<string, Record<string, Record<string, string>>> {
  const packs: Record<string, Record<string, Record<string, string>>> = {}
  IDS.forEach((id, index) => {
    const pack: Record<string, Record<string, string>> = {}
    for (const [namespace, rows] of Object.entries(namespaces)) {
      const dict: Record<string, string> = {}
      for (const [key, values] of Object.entries(rows)) {
        const value = values[index]
        if (value !== undefined) dict[key] = value
      }
      pack[namespace] = dict
    }
    packs[id] = pack
  })
  return packs
}

/** Extra dictionaries merged onto the shell pack. Placeholders stay intact. */
export const VISIBLE_PACKS = assemble({
  common: {
    'workspace.defaultName': ['डिफ़ॉल्ट कार्यक्षेत्र', 'Không gian làm việc mặc định', 'พื้นที่ทำงานเริ่มต้น', 'Ruang kerja bawaan', 'ပုံသေအလုပ်နေရာ', 'Default na workspace', 'កន្លែងធ្វើការលំនាំដើម', 'පෙරනිමි වැඩබිම', 'पूर्वनिर्धारित कार्यक्षेत्र', 'Workspace default', 'ነባሪ የስራ ቦታ', 'Bakka hojii durtii', 'مساحة العمل الافتراضية'],
  },
  settings: {
    openDocument: ['कॉन्फ़िगरेशन फ़ाइल खोलें', 'Mở tệp cấu hình', 'เปิดไฟล์การตั้งค่า', 'Buka berkas konfigurasi', 'ပြင်ဆင်မှုဖိုင်ဖွင့်မည်', 'Buksan ang configuration file', 'បើកឯកសារកំណត់', 'වින්‍යාස ගොනුව විවෘත කරන්න', 'कन्फिगरेसन फाइल खोल्नुहोस्', 'Configuration file hawng', 'የውቅር ፋይል ክፈት', 'Faayila qindaa’inaa bani', 'افتح ملف الإعداد'],
    'developerTools.title': ['कोड दृश्य दिखाएँ', 'Hiện khung làm việc với mã', 'แสดงมุมมองโค้ด', 'Tampilkan tampilan kode', 'ကုဒ်မြင်ကွင်းပြမည်', 'Ipakita ang coding view', 'បង្ហាញទិដ្ឋភាពកូដ', 'කේත දසුන පෙන්වන්න', 'कोड दृश्य देखाउनुहोस्', 'Code enna lang', 'የኮድ እይታ አሳይ', 'Ilaalcha koodii agarsiisi', 'أظهر عرض الكود'],
    'developerTools.description': ['ट्रैजेक्टरी, कोड अंतर और सभी Agent प्रीसेट दिखाता है', 'Hiện quỹ đạo, khác biệt mã và mọi preset Agent', 'แสดงเส้นทาง ความต่างของโค้ด และพรีเซ็ต Agent ทั้งหมด', 'Menampilkan trajektori, perbedaan kode, dan semua preset Agent', 'လမ်းကြောင်း၊ ကုဒ်ကွာခြားချက်နှင့် Agent ပရီဆက်အားလုံးကို ပြသည်', 'Ipinapakita ang trajectory, mga diff ng code, at lahat ng Agent preset', 'បង្ហាញគន្លង ភាពខុសគ្នានៃកូដ និងគំរូ Agent ទាំងអស់', 'ගමන් මග, කේත වෙනස්කම් සහ සියලු Agent පෙරසැකසුම් පෙන්වයි', 'ट्र्याजेक्टोरी, कोड फरक र सबै Agent प्रिसेट देखाउँछ', 'Trajectory, code diff leh Agent preset zawng zawng a tilang', 'የጉዞ መስመር፣ የኮድ ልዩነት እና ሁሉንም የAgent ቅድመ-ቅንብሮች ያሳያል', 'Karaan, garaagarummaa koodii fi qophaa’ina Agent hunda agarsiisa', 'يعرض المسار وفروق الكود وكل أوضاع Agent'],
    'general.currentVersion': ['वर्तमान संस्करण: {version}', 'Phiên bản hiện tại: {version}', 'เวอร์ชันปัจจุบัน: {version}', 'Versi saat ini: {version}', 'လက်ရှိဗားရှင်း：{version}', 'Kasalukuyang bersyon: {version}', 'កំណែបច្ចុប្បន្ន៖ {version}', 'වත්මන් අනුවාදය: {version}', 'हालको संस्करण: {version}', 'Version tunah: {version}', 'የአሁኑ ስሪት፡ {version}', 'Gosa ammaa: {version}', 'الإصدار الحالي: {version}'],
  },
  chat: {
    'view.chat': ['चैट', 'Trò chuyện', 'แชท', 'Obrolan', 'စကားပြော', 'Usapan', 'ជជែក', 'කතාබහ', 'कुराकानी', 'Inkawm', 'ውይይት', 'Haasawa', 'الدردشة'],
    'settings.performance.title': ['प्रदर्शन और उपयोग', 'Hiệu năng và mức dùng', 'ประสิทธิภาพและการใช้งาน', 'Performa dan pemakaian', 'စွမ်းဆောင်ရည်နှင့် အသုံးပြုမှု', 'Pagganap at paggamit', 'ដំណើរការ និងការប្រើ', 'කාර්ය සාධනය සහ භාවිතය', 'प्रदर्शन र प्रयोग', 'Thil tih dan leh hman dan', 'አፈጻጸም እና አጠቃቀም', 'Raawwii fi fayyadama', 'الأداء والاستخدام'],
    'settings.performance.description': ['कितनी प्रदर्शन और उपयोग जानकारी दिखे, यह चुनें', 'Chọn mức thông tin hiệu năng và mức dùng sẽ hiện', 'เลือกปริมาณข้อมูลประสิทธิภาพและการใช้งานที่จะแสดง', 'Pilih seberapa banyak informasi performa dan pemakaian yang ditampilkan', 'စွမ်းဆောင်ရည်နှင့် အသုံးပြုမှုအချက်အလက် မည်မျှပြမည်ကို ရွေးပါ', 'Piliin kung gaano karaming impormasyon ng pagganap at paggamit ang ipapakita', 'ជ្រើសបរិមាណព័ត៌មានដំណើរការ និងការប្រើដែលត្រូវបង្ហាញ', 'කාර්ය සාධන සහ භාවිත තොරතුරු කොපමණ පෙන්විය යුතුද තෝරන්න', 'कति प्रदर्शन र प्रयोग जानकारी देखाउने छान्नुहोस्', 'Thil tih dan leh hman dan report engzat nge i lang duh tih thlang', 'ምን ያህል የአፈጻጸም እና የአጠቃቀም መረጃ እንደሚታይ ይምረጡ', 'Odeeffannoo raawwii fi fayyadamaa hangam agarsiisamu filadhu', 'اختر مقدار معلومات الأداء والاستخدام التي تظهر'],
    'settings.performance.compact': ['संक्षिप्त', 'Gọn', 'ย่อ', 'Ringkas', 'အကျဉ်း', 'Maikli', 'សង្ខេប', 'සංක්ෂිප්ත', 'छोटो', 'Tawi', 'አጭር', 'Gabaabaa', 'موجز'],
    'settings.performance.detailed': ['विस्तृत', 'Chi tiết', 'ละเอียด', 'Rinci', 'အသေးစိတ်', 'Detalyado', 'លម្អិត', 'විස්තරාත්මක', 'विस्तृत', 'Kim', 'ዝርዝር', 'Bal’aa', 'مفصّل'],
    'settings.links.title': ['चैट लिंक यहाँ खोलें', 'Mở liên kết trong cuộc trò chuyện', 'เปิดลิงก์ในแชทที่', 'Buka tautan obrolan di', 'စကားပြောလင့်ခ်ကို ဖွင့်မည့်နေရာ', 'Buksan ang mga link sa usapan sa', 'បើកតំណក្នុងការជជែកនៅ', 'කතාබස් සබැඳි විවෘත කරන්නේ', 'कुराकानी लिंक यहाँ खोल्नुहोस्', 'Inkawm link hawng tur', 'የውይይት አገናኞችን እዚህ ክፈት', 'Hidhata haasawa bani', 'افتح روابط الدردشة في'],
    'settings.links.description': ['वेब लिंक कहाँ खुलें, चुनें', 'Chọn nơi mở liên kết web', 'เลือกที่เปิดลิงก์เว็บ', 'Pilih tempat membuka tautan web', 'ဝက်ဘ်လင့်ခ်ဖွင့်မည့်နေရာကို ရွေးပါ', 'Piliin kung saan bubuksan ang mga web link', 'ជ្រើសកន្លែងបើកតំណវេប', 'වෙබ් සබැඳි විවෘත කරන්නේ කොහේදැයි තෝරන්න', 'वेब लिंक कहाँ खोल्ने छान्नुहोस्', 'Web link khawiha nge hawng tur tih thlang', 'የድረ ገጽ አገናኞች የት እንደሚከፈቱ ይምረጡ', 'Hidhata weebii eessa akka banamu filadhu', 'اختر أين تُفتح روابط الويب'],
    'settings.links.sidebar': ['ऐप का साइडबार', 'Thanh bên trong ứng dụng', 'แถบข้างในแอป', 'Bilah sisi dalam aplikasi', 'အက်ပ်အတွင်း ဘေးဘား', 'Sidebar sa app', 'របារចំហៀងក្នុងកម្មវិធី', 'යෙදුම තුළ පැති තීරුව', 'एपभित्रको साइडबार', 'App sidebar', 'የመተግበሪያው የጎን አሞሌ', 'Barjaa cinaa appii', 'الشريط الجانبي داخل التطبيق'],
    'settings.links.newTab': ['डिफ़ॉल्ट ब्राउज़र', 'Trình duyệt mặc định', 'เบราว์เซอร์เริ่มต้น', 'Peramban bawaan', 'ပုံသေဘရောက်ဇာ', 'Default na browser', 'កម្មវិធីរុករកលំនាំដើម', 'පෙරනිමි බ්‍රවුසරය', 'पूर्वनिर्धारित ब्राउजर', 'Browser default', 'ነባሪ አሳሽ', 'Sakataa durtii', 'المتصفح الافتراضي'],
    'settings.collapse.title': ['काम का विवरण कब समेटें', 'Khi nào thu gọn chi tiết công việc', 'เมื่อใดจะยุบรายละเอียดงาน', 'Kapan menciutkan detail pekerjaan', 'အလုပ်အသေးစိတ်ကို မည်သည့်အချိန်ချုံ့မည်', 'Kailan i-collapse ang detalye ng trabaho', 'ពេលបង្រួមព័ត៌មានការងារ', 'වැඩ විස්තර හකුළන්නේ කවදාද', 'कामको विवरण कहिले खुम्च्याउने', 'Hna kimchang engtikah nge kharh', 'የስራ ዝርዝር መቼ ይሰበሰብ', 'Ibsa hojii yoom akka qabamu', 'متى تُطوى تفاصيل العمل'],
    'settings.collapse.description': ['काम का विवरण अपने आप कब समेटे, चुनें', 'Chọn thời điểm tự thu gọn chi tiết công việc', 'เลือกว่าจะยุบรายละเอียดงานอัตโนมัติเมื่อใด', 'Pilih kapan detail pekerjaan diciutkan otomatis', 'အလုပ်အသေးစိတ်ကို အလိုအလျောက် မည်သည့်အချိန်ချုံ့မည်ကို ရွေးပါ', 'Piliin kung kailan awtomatikong i-collapse ang detalye ng trabaho', 'ជ្រើសពេលបង្រួមព័ត៌មានការងារដោយស្វ័យប្រវត្តិ', 'වැඩ විස්තර ස්වයංක්‍රීයව හකුළන්නේ කවදාද තෝරන්න', 'कामको विवरण आफैं कहिले खुम्च्याउने छान्नुहोस्', 'Hna kimchang a mahni theih kharh tur hun thlang', 'የስራ ዝርዝር በራስ ሰር መቼ እንደሚሰበሰብ ይምረጡ', 'Ibsa hojii ofumaan yoom akka qabamu filadhu', 'اختر متى تُطوى تفاصيل العمل تلقائياً'],
    'settings.collapse.completion': ['पूरा होने पर', 'Khi hoàn thành', 'เมื่อเสร็จสิ้น', 'Saat selesai', 'ပြီးဆုံးသောအခါ', 'Kapag tapos na', 'ពេលបញ្ចប់', 'නිම වූ විට', 'सकिएपछि', 'A zo hunah', 'ሲጠናቀቅ', 'Yommuu xumuramu', 'عند الاكتمال'],
    'settings.collapse.nextInput': ['अगले संदेश पर', 'Khi có tin nhắn tiếp', 'เมื่อมีข้อความถัดไป', 'Saat pesan berikutnya', 'နောက်မက်ဆေ့ရောက်သောအခါ', 'Sa susunod na mensahe', 'ពេលសារបន្ទាប់', 'ඊළඟ පණිවිඩයේදී', 'अर्को सन्देशमा', 'Message a dawtah', 'በሚቀጥለው መልዕክት', 'Ergaa itti aanutti', 'عند الرسالة التالية'],
    'stats.counts': ['{turns} बार {steps} कदम', '{turns} lượt {steps} bước', '{turns} รอบ {steps} ขั้น', '{turns} giliran {steps} langkah', '{turns} အလှည့် {steps} အဆင့်', '{turns} liko {steps} hakbang', '{turns} វេន {steps} ជំហាន', '{turns} වාර {steps} පියවර', '{turns} पालो {steps} कदम', '{turns} turn {steps} kal', '{turns} ዙር {steps} እርምጃ', '{turns} marsaa {steps} tarkaanfii', '{turns} جولات {steps} خطوات'],
    'stats.cacheHit': ['कैश हिट {percent}%', 'Trúng bộ nhớ đệm {percent}%', 'แคชโดน {percent}%', 'Cache hit {percent}%', 'ကက်ရှ်ထိမှန် {percent}%', 'Cache hit {percent}%', 'ឃ្លាំងសម្ងាត់ត្រូវ {percent}%', 'කෑෂ් ගැලපීම {percent}%', 'क्यास हिट {percent}%', 'Cache a kim {percent}%', 'መሸጎጫ ወጣ {percent}%', 'Kuufannoo {percent}%', 'إصابة التخزين المؤقت {percent}%'],
  },
  conversation: {
    'settings.enter.title': ['व्यस्त होने पर भेजने का तरीका', 'Cách gửi khi đang bận', 'พฤติกรรมส่งเมื่อไม่ว่าง', 'Perilaku kirim saat sibuk', 'အလုပ်များနေစဉ် ပို့ပုံ', 'Pagpapadala habang abala', 'ឥរិយាបថផ្ញើពេលរវល់', 'කාර්යබහුල විට යැවීම', 'व्यस्त हुँदा पठाउने तरिका', 'A buai laia thawn dan', 'በተጠመደ ጊዜ የመላኪያ ባህሪ', 'Amala ergaa yeroo hojiin jiru', 'سلوك الإرسال أثناء الانشغال'],
    'settings.enter.description': ['एजेंट चलते समय Enter और भेजें बटन क्या करें। Cmd/Ctrl+Enter दूसरा तरीका इस्तेमाल करता है', 'Enter và nút Gửi làm gì khi tác nhân đang chạy. Cmd/Ctrl+Enter dùng cách còn lại', 'กำหนดว่า Enter และปุ่มส่งทำอะไรขณะเอเจนต์ทำงาน Cmd/Ctrl+Enter ใช้อีกแบบ', 'Apa yang dilakukan Enter dan tombol Kirim saat agen berjalan. Cmd/Ctrl+Enter memakai perilaku lain', 'အေးဂျင့်အလုပ်လုပ်နေစဉ် Enter နှင့် ပို့ခလုတ်က ဘာလုပ်မည်။ Cmd/Ctrl+Enter က အခြားပုံစံကို သုံးသည်', 'Ano ang ginagawa ng Enter at ng Send habang tumatakbo ang ahente. Cmd/Ctrl+Enter ang isa pang kilos', 'អ្វីដែល Enter និងប៊ូតុងផ្ញើធ្វើពេលភ្នាក់ងារកំពុងដំណើរការ។ Cmd/Ctrl+Enter ប្រើឥរិយាបថម្ខាងទៀត', 'නියෝජිතයා ක්‍රියාත්මක වන විට Enter සහ යැවීමේ බොත්තම කරන්නේ කුමක්ද. Cmd/Ctrl+Enter අනෙක් හැසිරීම යොදයි', 'एजेन्ट चल्दा Enter र पठाउने बटनले के गर्छ। Cmd/Ctrl+Enter ले अर्को तरिका प्रयोग गर्छ', 'Agent a tithmeh laiin Enter leh Send in eng nge a tih. Cmd/Ctrl+Enter in dan dang a hmang', 'ወኪሉ እየሰራ ሳለ Enter እና የመላኪያ ቁልፍ ምን እንደሚያደርጉ። Cmd/Ctrl+Enter ሌላውን ባህሪ ይጠቀማል', 'Enter fi qabduu ergaa yeroo bakkeettiin hojjetu maal godhu. Cmd/Ctrl+Enter amala biraa fayyadama', 'ما يفعله Enter وزر الإرسال أثناء عمل الوكيل. Cmd/Ctrl+Enter يستخدم السلوك الآخر'],
    'settings.enter.queue': ['कतार', 'Xếp hàng', 'เข้าคิว', 'Antre', 'တန်းစီ', 'Pila', 'ដាក់ជួរ', 'පෝලිම', 'लाइन', 'Khawl', 'ወረፋ', 'Tartii', 'الطابور'],
    'settings.enter.steer': ['बीच में भेजें', 'Chen gửi', 'ส่งแทรก', 'Sela', 'ကြားဖြတ်ပို့', 'Singit', 'បញ្ចូលភ្លាម', 'අතරමැද යවන්න', 'बीचमा पठाउने', 'Kan lut', 'ገብቶ ላክ', 'Gidduu seeni', 'إرسال فوري'],
  },
  shortcuts: {
    settings: ['कीबोर्ड शॉर्टकट', 'Phím tắt', 'แป้นพิมพ์ลัด', 'Pintasan keyboard', 'ကီးဘုတ်ဖြတ်လမ်း', 'Mga keyboard shortcut', 'ផ្លូវកាត់ក្ដារចុច', 'යතුරුපුවරු කෙටිමං', 'किबोर्ड सर्टकट', 'Keyboard shortcut', 'የቁልፍ አቋራጮች', 'Qaxxaamura kiiboordii', 'اختصارات لوحة المفاتيح'],
    view: ['शॉर्टकट संपादित करें', 'Sửa phím tắt', 'แก้ไขแป้นลัด', 'Edit pintasan', 'ဖြတ်လမ်းပြင်မည်', 'I-edit ang shortcut', 'កែផ្លូវកាត់', 'කෙටිමං සංස්කරණය', 'सर्टकट सम्पादन', 'Shortcut siamṭhat', 'አቋራጭ አርትዕ', 'Qaxxaamura gulaali', 'تعديل الاختصارات'],
    description: ['उपलब्ध शॉर्टकट और इनपुट क्रियाएँ देखें और बदलें', 'Xem và sửa phím tắt cùng thao tác nhập', 'ดูและแก้ไขแป้นลัดและการป้อนที่ใช้ได้', 'Lihat dan edit pintasan serta tindakan masukan', 'ရနိုင်သောဖြတ်လမ်းနှင့် ထည့်သွင်းလုပ်ဆောင်ချက်များကို ကြည့်ပြီး ပြင်ပါ', 'Tingnan at i-edit ang mga shortcut at kilos sa input', 'មើលនិងកែផ្លូវកាត់ និងសកម្មភាពបញ្ចូល', 'ලද හැකි කෙටිමං සහ ආදාන ක්‍රියා බලා සංස්කරණය කරන්න', 'उपलब्ध सर्टकट र इनपुट कार्य हेर्नुहोस् र सच्याउनुहोस्', 'Shortcut leh input hman theih en la siamṭhat', 'የሚገኙ አቋራጮችን እና የግቤት እርምጃዎችን ይመልከቱ እና ያርትዑ', 'Qaxxaamura fi gocha galchii ilaaliitii gulaali', 'اعرض اختصارات الإدخال وعدّلها'],
  },
  'settings.plugins': {
    nav: ['अंतर्निहित प्लगइन', 'Plugin tích hợp', 'ปลั๊กอินในตัว', 'Plugin bawaan', 'ပါဝင်ပြီးပလပ်အင်', 'Mga built-in na plugin', 'កម្មវិធីជំនួយភ្ជាប់ស្រាប់', 'ඇතුළත් ප්ලගින', 'निर्मित प्लगइन', 'Plugin telh sa', 'አብሮ የተሰሩ ተሰኪዎች', 'Pilaagii keessaa', 'الإضافات المدمجة'],
    title: ['अंतर्निहित प्लगइन', 'Plugin tích hợp', 'ปลั๊กอินในตัว', 'Plugin bawaan', 'ပါဝင်ပြီးပလပ်အင်', 'Mga built-in na plugin', 'កម្មវិធីជំនួយភ្ជាប់ស្រាប់', 'ඇතුළත් ප්ලගින', 'निर्मित प्लगइन', 'Plugin telh sa', 'አብሮ የተሰሩ ተሰኪዎች', 'Pilaagii keessaa', 'الإضافات المدمجة'],
  },
  'settings.models': {
    nav: ['मॉडल', 'Mô hình', 'โมเดล', 'Model', 'မော်ဒယ်', 'Mga model', 'ម៉ូដែល', 'ආකෘති', 'मोडेल', 'Model', 'ሞዴሎች', 'Moodeelota', 'النماذج'],
    title: ['मॉडल', 'Mô hình', 'โมเดล', 'Model', 'မော်ဒယ်', 'Mga model', 'ម៉ូដែល', 'ආකෘති', 'मोडेल', 'Model', 'ሞዴሎች', 'Moodeelota', 'النماذج'],
  },
  'settings.agentPreset': {
    nav: ['Agent प्रीसेट', 'Preset Agent', 'พรีเซ็ต Agent', 'Preset agen', 'Agent ပရီဆက်', 'Mga preset ng Agent', 'គំរូ Agent', 'Agent පෙරසැකසුම්', 'Agent प्रिसेट', 'Agent preset', 'የAgent ቅድመ-ቅንብሮች', 'Qophaa’ina Agent', 'أوضاع Agent'],
    presetStandardName: ['मानक मोड', 'Chế độ chuẩn', 'โหมดมาตรฐาน', 'Mode standar', 'ပုံမှန်မုဒ်', 'Standard na mode', 'របៀបស្តង់ដារ', 'සම්මත ප්‍රකාරය', 'मानक मोड', 'Mode pum', 'መደበኛ ሁነታ', 'Haala idilee', 'الوضع القياسي'],
  },
  pluginManager: {
    panel: ['प्लगइन', 'Plugin', 'ปลั๊กอิน', 'Plugin', 'ပလပ်အင်', 'Mga plugin', 'កម្មវិធីជំនួយ', 'ප්ලගින', 'प्लगइन', 'Plugin', 'ተሰኪዎች', 'Pilaagii', 'الإضافات'],
    title: ['प्लगइन', 'Plugin', 'ปลั๊กอิน', 'Plugin', 'ပလပ်အင်', 'Mga plugin', 'កម្មវិធីជំនួយ', 'ප්ලගින', 'प्लगइन', 'Plugin', 'ተሰኪዎች', 'Pilaagii', 'الإضافات'],
  },
  'schedule.manager': {
    panel: ['स्वचालन कार्य', 'Tác vụ tự động', 'งานอัตโนมัติ', 'Tugas otomatis', 'အလိုအလျောက်အလုပ်များ', 'Mga gawaing awtomatiko', 'កិច្ចការស្វ័យប្រវត្តិ', 'ස්වයංක්‍රීය කාර්ය', 'स्वचालित काम', 'Hna a mahni theih', 'ራስሰር ስራዎች', 'Hojii ofumaa', 'المهام التلقائية'],
    title: ['स्वचालन कार्य', 'Tác vụ tự động', 'งานอัตโนมัติ', 'Tugas otomatis', 'အလိုအလျောက်အလုပ်များ', 'Mga gawaing awtomatiko', 'កិច្ចការស្វ័យប្រវត្តិ', 'ස්වයංක්‍රීය කාර්ය', 'स्वचालित काम', 'Hna a mahni theih', 'ራስሰር ስራዎች', 'Hojii ofumaa', 'المهام التلقائية'],
  },
  workspace: {
    'section.workspaces': ['कार्यक्षेत्र', 'Không gian làm việc', 'พื้นที่ทำงาน', 'Ruang kerja', 'အလုပ်နေရာများ', 'Mga workspace', 'កន្លែងធ្វើការ', 'වැඩබිම්', 'कार्यक्षेत्र', 'Workspace', 'የስራ ቦታዎች', 'Bakkeewwan hojii', 'مساحات العمل'],
  },
  'permission.access': {
    'preset.readOnly': ['केवल देखें', 'Chỉ xem', 'ดูอย่างเดียว', 'Hanya lihat', 'ကြည့်ရန်သာ', 'Basahin lang', 'មើលតែប៉ុណ្ណោះ', 'කියවීම පමණි', 'हेर्न मात्र', 'En chauh', 'ማንበብ ብቻ', 'Dubbisuu qofa', 'للقراءة فقط'],
    'preset.workspaceWrite': ['कार्यक्षेत्र में लिखें', 'Ghi trong không gian làm việc', 'เขียนในพื้นที่ทำงาน', 'Tulis di ruang kerja', 'အလုပ်နေရာတွင် ရေးမည်', 'Sumulat sa workspace', 'សរសេរក្នុងកន្លែងធ្វើការ', 'වැඩබිම තුළ ලියන්න', 'कार्यक्षेत्रमा लेख्ने', 'Workspace ah ziak', 'በስራ ቦታው ውስጥ ጻፍ', 'Bakka hojii keessatti barreessi', 'الكتابة داخل مساحة العمل'],
    'preset.fullAccess': ['पूर्ण पहुँच', 'Toàn quyền', 'สิทธิ์เต็ม', 'Akses penuh', 'အပြည့်အဝခွင့်', 'Buong access', 'សិទ្ធិពេញ', 'පූර්ණ ප්‍රවේශය', 'पूर्ण पहुँच', 'Phalna kim', 'ሙሉ መዳረሻ', 'Seensa guutuu', 'وصول كامل'],
    'auto.label': ['स्वतः समीक्षा', 'Tự động xét', 'ตรวจอัตโนมัติ', 'Tinjau otomatis', 'အလိုအလျောက်စစ်ဆေး', 'Awtomatikong pagsusuri', 'ពិនិត្យស្វ័យប្រវត្តិ', 'ස්වයං සමාලෝචනය', 'स्वतः समीक्षा', 'A mahni en', 'ራስሰር ግምገማ', 'Sakatta’a ofumaa', 'مراجعة تلقائية'],
  },
  trajectory: {
    'view.trajectory': ['ट्रैजेक्टरी', 'Quỹ đạo', 'เส้นทาง', 'Trajektori', 'လမ်းကြောင်း', 'Trajectory', 'គន្លង', 'ගමන් මග', 'ट्र्याजेक्टोरी', 'Trajectory', 'የጉዞ መስመር', 'Karaan', 'المسار'],
  },
  'session-log-deepseek': {
    title: ['आधिकारिक मॉडल API पर Session Log अपलोड करें', 'Tải Session Log lên khi dùng API mô hình chính thức', 'อัปโหลด Session Log เมื่อใช้ API โมเดลทางการ', 'Unggah Session Log saat memakai API model resmi', 'တရားဝင်မော်ဒယ် API သုံးစဉ် Session Log တင်မည်', 'I-upload ang Session Log kapag ginagamit ang opisyal na model API', 'ផ្ទុក Session Log ឡើងពេលប្រើ API ម៉ូដែលផ្លូវការ', 'නිල ආකෘති API භාවිත කරන විට Session Log උඩුගත කරන්න', 'आधिकारिक मोडेल API प्रयोग गर्दा Session Log अपलोड गर्नुहोस््', 'Model API official hman laiin Session Log upload', 'ኦፊሴላዊ የሞዴል API ሲጠቀሙ Session Log ይስቀሉ', 'API moodeelaa seeraa yeroo fayyadamtu Session Log ol kaasaa', 'ارفع Session Log عند استخدام واجهة النموذج الرسمية'],
    description: ['DeepSeek मॉडल और उत्पादों को बेहतर बनाने में मदद करें', 'Giúp cải thiện mô hình và sản phẩm DeepSeek', 'ช่วยปรับปรุงโมเดลและผลิตภัณฑ์ DeepSeek', 'Bantu tingkatkan model dan produk DeepSeek', 'DeepSeek မော်ဒယ်နှင့် ထုတ်ကုန်များကို တိုးတက်အောင် ကူညီပါ', 'Tumulong na pagbutihin ang mga model at produkto ng DeepSeek', 'ជួយកែលម្អម៉ូដែល និងផលិតផល DeepSeek', 'DeepSeek ආකෘති සහ නිෂ්පාදන වැඩිදියුණු කිරීමට උදව් කරන්න', 'DeepSeek मोडेल र उत्पादन सुधार्न मद्दत गर्नुहोස', 'DeepSeek model leh product tihchak nan tanpui', 'የDeepSeek ሞዴሎችን እና ምርቶችን ለማሻሻል ያግዙ', 'Moodeela fi oomisha DeepSeek fooyyessuuf gargaari', 'ساعد على تحسين نماذج DeepSeek ومنتجاتها'],
  },
})

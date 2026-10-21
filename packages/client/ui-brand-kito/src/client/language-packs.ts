/** Interface copy for every language in the Kito picker. Placeholders stay intact. */
import { VISIBLE_PACKS } from './language-packs-visible.ts'

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

function mergePacks(
  base: Record<string, Record<string, Record<string, string>>>,
  extra: Record<string, Record<string, Record<string, string>>>,
): Record<string, Record<string, Record<string, string>>> {
  const merged: Record<string, Record<string, Record<string, string>>> = {}
  for (const locale of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    const target: Record<string, Record<string, string>> = { ...base[locale] }
    for (const [namespace, dict] of Object.entries(extra[locale] ?? {})) {
      target[namespace] = { ...target[namespace], ...dict }
    }
    merged[locale] = target
  }
  return merged
}

/** Locale id, then namespace, then dictionary. */
export const LANGUAGE_PACKS = mergePacks(assemble({
  common: {
    ok: ['ठीक है', 'Đồng ý', 'ตกลง', 'OK', 'အိုကေ', 'Sige', 'យល់ព្រម', 'හරි', 'ठीक छ', 'A tha', 'እሺ', 'Tole', 'حسناً'],
    cancel: ['रद्द करें', 'Hủy', 'ยกเลิก', 'Batal', 'ပယ်ဖျက်မည်', 'Kanselahin', 'បោះបង់', 'අවලංගු කරන්න', 'रद्द गर्नुहोस्', 'Tih kir', 'ሰርዝ', 'Haqiisi', 'إلغاء'],
    close: ['बंद करें', 'Đóng', 'ปิด', 'Tutup', 'ပိတ်မည်', 'Isara', 'បិទ', 'වසන්න', 'बन्द गर्नुहोस्', 'Khar', 'ዝጋ', 'Cufi', 'إغلاق'],
    copy: ['कॉपी', 'Sao chép', 'คัดลอก', 'Salin', 'ကူးယူမည်', 'Kopyahin', 'ចម្លង', 'පිටපත් කරන්න', 'प्रतिलिपि', 'Copy', 'ቅዳ', 'Koppii', 'نسخ'],
    copied: ['कॉपी हो गया', 'Đã sao chép', 'คัดลอกแล้ว', 'Tersalin', 'ကူးယူပြီး', 'Nakopya na', 'បានចម្លង', 'පිටපත් විය', 'प्रतिलिपि भयो', 'Copy a ni', 'ተቀድቷል', 'Koppii ta’e', 'تم النسخ'],
    more: ['और', 'Thêm', 'เพิ่มเติม', 'Lainnya', 'နောက်ထပ်', 'Higit pa', 'បន្ថែម', 'තවත්', 'थप', 'A dang', 'ተጨማሪ', 'Dabalata', 'المزيد'],
    search: ['खोजें', 'Tìm kiếm', 'ค้นหา', 'Cari', 'ရှာမည်', 'Maghanap', 'ស្វែងរក', 'සොයන්න', 'खोज्नुहोस्', 'Zawng', 'ፈልግ', 'Barbaadi', 'بحث'],
    save: ['सहेजें', 'Lưu', 'บันทึก', 'Simpan', 'သိမ်းမည်', 'I-save', 'រក្សាទុក', 'සුරකින්න', 'बचत गर्नुहोस्', 'Khum', 'አስቀምጥ', 'Kuusi', 'حفظ'],
    delete: ['हटाएँ', 'Xóa', 'ลบ', 'Hapus', 'ဖျက်မည်', 'Tanggalin', 'លុប', 'මකන්න', 'मेट्नुहोस्', 'Paih bo', 'ሰርዝ', 'Haqiisi', 'حذف'],
    edit: ['संपादित करें', 'Sửa', 'แก้ไข', 'Edit', 'ပြင်မည်', 'I-edit', 'កែ', 'සංස්කරණය', 'सम्पादन', 'Siamṭhat', 'አርትዕ', 'Gulaali', 'تعديل'],
    loading: ['लोड हो रहा है…', 'Đang tải…', 'กำลังโหลด…', 'Memuat…', 'ဖွင့်နေသည်…', 'Naglo-load…', 'កំពុងផ្ទុក…', 'පූරණය වෙමින්…', 'लोड हुँदै…', 'Load mek…', 'በመጫን ላይ…', 'Fe’aa jira…', 'جارٍ التحميل…'],
    retry: ['फिर कोशिश करें', 'Thử lại', 'ลองอีกครั้ง', 'Coba lagi', 'ပြန်ကြိုးစားမည်', 'Subukan muli', 'ព្យាយាមម្ដងទៀត', 'නැවත උත්සාහ කරන්න', 'फेरि प्रयास', 'Nakin tum', 'እንደገና ሞክር', 'Irra deebi’i', 'أعد المحاولة'],
    back: ['वापस', 'Quay lại', 'กลับ', 'Kembali', 'နောက်သို့', 'Bumalik', 'ត្រឡប់', 'ආපසු', 'पछाडि', 'Kir let', 'ተመለስ', 'Duuba', 'رجوع'],
    submit: ['जमा करें', 'Gửi', 'ส่ง', 'Kirim', 'တင်သွင်းမည်', 'Isumite', 'ដាក់ស្នើ', 'ඉදිරිපත් කරන්න', 'पेश गर्नुहोस्', 'Thehlut', 'አስገባ', 'Galchi', 'إرسال'],
    next: ['आगे', 'Tiếp', 'ถัดไป', 'Berikutnya', 'နောက်တစ်ခု', 'Susunod', 'បន្ទាប់', 'ඊළඟ', 'अर्को', 'A dawt', 'ቀጣይ', 'Itti aanu', 'التالي'],
    previous: ['पीछे', 'Trước', 'ก่อนหน้า', 'Sebelumnya', 'ယခင်', 'Nakaraan', 'មុន', 'පෙර', 'अघिल्लो', 'A hmaa', 'ቀዳሚ', 'Duraa', 'السابق'],
    expand: ['खोलें', 'Mở rộng', 'ขยาย', 'Bentangkan', 'ချဲ့မည်', 'Palawakin', 'ពង្រីក', 'විහිදුවන්න', 'खोल्नुहोस्', 'Zauh', 'ዘርጋ', 'Bali’isi', 'توسيع'],
    collapse: ['समेटें', 'Thu gọn', 'ย่อ', 'Ciutkan', 'ချုံ့မည်', 'I-collapse', 'បង្រួម', 'හකුළන්න', 'खुम्च्याउनुहोस्', 'Tlun', 'ሰብስብ', 'Qabachiisi', 'طي'],
  },
  'kito.account': {
    account: ['खाता', 'Tài khoản', 'บัญชี', 'Akun', 'အကောင့်', 'Account', 'គណនី', 'ගිණුම', 'खाता', 'Account', 'መለያ', 'Herrega', 'الحساب'],
    loading: ['खाता पढ़ा जा रहा है', 'Đang đọc tài khoản', 'กำลังอ่านบัญชี', 'Membaca akun', 'အကောင့်ဖတ်နေသည်', 'Binabasa ang account', 'កំពុងអានគណនី', 'ගිණුම කියවමින්', 'खाता पढ्दै', 'Account chhiar mek', 'መለያ በማንበብ ላይ', 'Herrega dubbisaa jira', 'جارٍ قراءة الحساب'],
    signedIn: ['साइन इन हो गया', 'Đã đăng nhập', 'เข้าสู่ระบบแล้ว', 'Sudah masuk', 'ဝင်ပြီး', 'Naka-sign in', 'បានចូល', 'පිවිස ඇත', 'लगइन भयो', 'Lut a ni', 'ገብቷል', 'Seente', 'تم تسجيل الدخول'],
    signedOut: ['साइन इन नहीं है', 'Chưa đăng nhập', 'ยังไม่เข้าสู่ระบบ', 'Belum masuk', 'မဝင်ရသေး', 'Hindi naka-sign in', 'មិនទាន់ចូល', 'පිවිස නැත', 'लगइन छैन', 'Lut lo', 'አልገባም', 'Hin seenne', 'غير مسجّل'],
    signIn: ['Telegram से साइन इन', 'Đăng nhập bằng Telegram', 'เข้าสู่ระบบด้วย Telegram', 'Masuk dengan Telegram', 'Telegram ဖြင့်ဝင်မည်', 'Mag-sign in gamit ang Telegram', 'ចូលដោយ Telegram', 'Telegram මගින් පිවිසෙන්න', 'Telegram बाट लगइन', 'Telegram hmangin lut', 'በ Telegram ግባ', 'Telegram’n seeni', 'تسجيل الدخول بتيليغرام'],
    signInHint: ['साइन इन करने पर Telegram नाम दिखेगा', 'Đăng nhập để hiện tên Telegram', 'เข้าสู่ระบบเพื่อแสดงชื่อ Telegram', 'Masuk untuk menampilkan nama Telegram', 'Telegram အမည်ပြရန် ဝင်ပါ', 'Mag-sign in para lumabas ang pangalan sa Telegram', 'ចូលដើម្បីបង្ហាញឈ្មោះ Telegram', 'Telegram නම පෙන්වීමට පිවිසෙන්න', 'Telegram नाम देखाउन लगइन गर्नुहोस्', 'Telegram hming lang tir nan lut rawh', 'የ Telegram ስም ለማሳየት ግባ', 'Maqaa Telegram agarsiisuuf seeni', 'سجّل الدخول لإظهار اسم تيليغرام'],
    topupHint: ['रिचार्ज उसी Kito शेष में जाता है', 'Nạp vào cùng số dư Kito', 'เติมเข้ายอด Kito เดียวกัน', 'Isi ke saldo Kito yang sama', 'Kito လက်ကျန်တစ်ခုတည်းသို့ ဖြည့်သည်', 'Papasok sa parehong balanse ng Kito', 'បញ្ចូលទៅសមតុល្យ Kito ដូចគ្នា', 'එම Kito ශේෂයටම යයි', 'उही Kito बाँकीमा जान्छ', 'Kito balance khatah a dah', 'ወደ ተመሳሳዩ የ Kito ቀሪ ይገባል', 'Gara haftee Kito wal fakkaataa seena', 'يُضاف إلى رصيد Kito نفسه'],
    telegram: ['Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram', 'Telegram'],
    signOut: ['बाहर निकलें', 'Đăng xuất', 'ออกจากระบบ', 'Keluar', 'ထွက်မည်', 'Mag-sign out', 'ចាកចេញ', 'පිටවන්න', 'बाहिरिनुहोस्', 'Chhuak', 'ውጣ', 'Ba’i', 'تسجيل الخروج'],
    topup: ['रिचार्ज', 'Nạp tiền', 'เติมเงิน', 'Isi saldo', 'ငွေဖြည့်မည်', 'Mag-top up', 'បញ្ចូលទឹកប្រាក់', 'මුදල් පුරවන්න', 'रकम भर्नुहोस्', 'Paisa dah', 'ሙላ', 'Guuti', 'شحن'],
    topups: ['रिचार्ज इतिहास', 'Lịch sử nạp', 'ประวัติเติมเงิน', 'Riwayat isi saldo', 'ငွေဖြည့်မှတ်တမ်း', 'Kasaysayan ng top up', 'ប្រវត្តិបញ្ចូលប្រាក់', 'මුදල් පිරවීමේ වාර්තා', 'रिचार्ज इतिहास', 'Paisa dah chhinchhiah', 'የመሙያ መዝገብ', 'Seenaa guutii', 'سجل الشحن'],
    usage: ['खर्च रिकॉर्ड', 'Lịch sử dùng', 'บันทึกการใช้', 'Riwayat pemakaian', 'အသုံးစရိတ်မှတ်တမ်း', 'Talaan ng paggamit', 'កំណត់ត្រាការប្រើ', 'පරිභෝජන වාර්තා', 'खर्च रेकर्ड', 'Hman zat chhinchhiah', 'የፍጆታ መዝገብ', 'Galmee fayyadamaa', 'سجل الاستهلاك'],
    tokens: ['Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token', 'Token'],
    balance: ['शेष (USD)', 'Số dư (USD)', 'ยอดคงเหลือ (USD)', 'Saldo (USD)', 'လက်ကျန် (USD)', 'Balanse (USD)', 'សមតុល្យ (USD)', 'ශේෂය (USD)', 'बाँकी (USD)', 'Balance (USD)', 'ቀሪ (USD)', 'Haftee (USD)', 'الرصيد (USD)'],
    nickname: ['नाम', 'Biệt danh', 'ชื่อ', 'Nama', 'အမည်', 'Pangalan', 'ឈ្មោះ', 'නම', 'नाम', 'Hming', 'ስም', 'Maqaa', 'الاسم'],
    accountNo: ['KT खाता', 'Tài khoản KT', 'บัญชี KT', 'Akun KT', 'KT အကောင့်', 'KT account', 'គណនី KT', 'KT ගිණුම', 'KT खाता', 'KT account', 'KT መለያ', 'Herrega KT', 'حساب KT'],
    copy: ['कॉपी', 'Sao chép', 'คัดลอก', 'Salin', 'ကူးယူမည်', 'Kopyahin', 'ចម្លង', 'පිටපත් කරන්න', 'प्रतिलिपि', 'Copy', 'ቅዳ', 'Koppii', 'نسخ'],
    copied: ['कॉपी हो गया', 'Đã sao chép', 'คัดลอกแล้ว', 'Tersalin', 'ကူးယူပြီး', 'Nakopya na', 'បានចម្លង', 'පිටපත් විය', 'प्रतिलिपि भयो', 'Copy a ni', 'ተቀድቷል', 'Koppii ta’e', 'تم النسخ'],
    language: ['भाषा', 'Ngôn ngữ', 'ภาษา', 'Bahasa', 'ဘာသာစကား', 'Wika', 'ភាសា', 'භාෂාව', 'भाषा', 'Ṭawng', 'ቋንቋ', 'Afaan', 'اللغة'],
  },
  model: {
    'command.label': ['मॉडल', 'Mô hình', 'โมเดล', 'Model', 'မော်ဒယ်', 'Model', 'ម៉ូដែល', 'ආකෘතිය', 'मोडेल', 'Model', 'ሞዴል', 'Moodeela', 'النموذج'],
    'trigger.fallback': ['मॉडल चुनें', 'Chọn mô hình', 'เลือกโมเดล', 'Pilih model', 'မော်ဒယ်ရွေးပါ', 'Pumili ng model', 'ជ្រើសម៉ូដែល', 'ආකෘතිය තෝරන්න', 'मोडेल छान्नुहोस्', 'Model thlang', 'ሞዴል ምረጥ', 'Moodeela filadhu', 'اختر نموذجاً'],
    'trigger.loading': ['मॉडल लोड हो रहे हैं…', 'Đang tải mô hình…', 'กำลังโหลดโมเดล…', 'Memuat model…', 'မော်ဒယ်ဖွင့်နေသည်…', 'Naglo-load ng model…', 'កំពុងផ្ទុកម៉ូដែល…', 'ආකෘති පූරණය වෙමින්…', 'मोडेल लोड हुँदै…', 'Model load mek…', 'ሞዴሎች በመጫን ላይ…', 'Moodeelota fe’aa jira…', 'جارٍ تحميل النماذج…'],
    'trigger.selectAria': ['मॉडल चुनें', 'Chọn mô hình', 'เลือกโมเดล', 'Pilih model', 'မော်ဒယ်ရွေးပါ', 'Pumili ng model', 'ជ្រើសម៉ូដែល', 'ආකෘතිය තෝරන්න', 'मोडेल छान्नुहोस्', 'Model thlang', 'ሞዴል ምረጥ', 'Moodeela filadhu', 'اختر نموذجاً'],
    'trigger.aria': ['मॉडल चुनें, अभी {model}', 'Chọn mô hình, hiện tại {model}', 'เลือกโมเดล ปัจจุบัน {model}', 'Pilih model, saat ini {model}', 'မော်ဒယ်ရွေးပါ၊ ယခု {model}', 'Pumili ng model, kasalukuyan {model}', 'ជ្រើសម៉ូដែល បច្ចុប្បន្ន {model}', 'ආකෘතිය තෝරන්න, දැන් {model}', 'मोडेल छान्नुहोस्, अहिले {model}', 'Model thlang, tunah {model}', 'ሞዴል ምረጥ፣ አሁን {model}', 'Moodeela filadhu, amma {model}', 'اختر النموذج، الحالي {model}'],
    'menu.model': ['मॉडल', 'Mô hình', 'โมเดล', 'Model', 'မော်ဒယ်', 'Model', 'ម៉ូដែល', 'ආකෘතිය', 'मोडेल', 'Model', 'ሞዴል', 'Moodeela', 'النموذج'],
    'menu.effort': ['सोच का स्तर', 'Mức suy luận', 'ระดับการใช้เหตุผล', 'Tingkat penalaran', 'ဆင်ခြင်အဆင့်', 'Antas ng pangangatwiran', 'កម្រិតវែកញែក', 'තර්ක මට්ටම', 'तर्क स्तर', 'Ngaihtuahna', 'የማመዛዘን ደረጃ', 'Sadarkaa yaada', 'مستوى التفكير'],
    'search.placeholder': ['मॉडल खोजें…', 'Tìm mô hình…', 'ค้นหาโมเดล…', 'Cari model…', 'မော်ဒယ်ရှာမည်…', 'Maghanap ng model…', 'ស្វែងរកម៉ូដែល…', 'ආකෘතිය සොයන්න…', 'मोडेल खोज्नुहोस्…', 'Model zawng…', 'ሞዴል ፈልግ…', 'Moodeela barbaadi…', 'ابحث عن نموذج…'],
    'search.empty': ['कोई मॉडल मेल नहीं खाता।', 'Không có mô hình khớp.', 'ไม่พบโมเดลที่ตรงกัน', 'Tidak ada model yang cocok.', 'ကိုက်ညီသောမော်ဒယ်မရှိ', 'Walang tumugmang model.', 'គ្មានម៉ូដែលត្រូវគ្នា', 'ගැළපෙන ආකෘතියක් නැත.', 'मिलेको मोडेल छैन।', 'Model a awm lo.', 'የሚዛመድ ሞዴል የለም።', 'Moodeelli hin simne.', 'لا يوجد نموذج مطابق.'],
    'empty.models': ['कोई मॉडल उपलब्ध नहीं', 'Không có mô hình', 'ไม่มีโมเดลที่ใช้ได้', 'Tidak ada model', 'သုံးနိုင်သောမော်ဒယ်မရှိ', 'Walang available na model', 'គ្មានម៉ូដែល', 'ලද හැකි ආකෘතියක් නැත', 'उपलब्ध मोडेल छैन', 'Model a awm lo', 'የሚገኝ ሞዴል የለም', 'Moodeelli hin jiru', 'لا توجد نماذج'],
    'empty.efforts': ['इस मॉडल में सोच का स्तर नहीं है।', 'Mô hình này không có mức suy luận.', 'โมเดลนี้ไม่มีระดับการใช้เหตุผล', 'Model ini tidak punya tingkat penalaran.', 'ဤမော်ဒယ်တွင် ဆင်ခြင်အဆင့်မရှိ', 'Walang antas ng pangangatwiran ang model na ito.', 'ម៉ូដែលនេះគ្មានកម្រិតវែកញែក', 'මෙම ආකෘතියට තර්ක මට්ටම් නැත.', 'यो मोडेलमा तर्क स्तर छैन।', 'He model ah ngaihtuahna a awm lo.', 'ይህ ሞዴል የማመዛዘን ደረጃ የለውም።', 'Moodeelli kun sadarkaa yaadaa hin qabu.', 'هذا النموذج بلا مستوى تفكير.'],
    'action.reload': ['फिर लोड करें', 'Tải lại', 'โหลดใหม่', 'Muat ulang', 'ပြန်ဖွင့်မည်', 'I-reload', 'ផ្ទុកឡើងវិញ', 'නැවත පූරණය', 'फेरि लोड', 'Load nawn', 'እንደገና ጫን', 'Irra deebi’ii fe’i', 'إعادة التحميل'],
    'status.loading': ['मॉडल सूची ताज़ा हो रही है…', 'Đang làm mới danh sách mô hình…', 'กำลังรีเฟรชรายการโมเดล…', 'Menyegarkan daftar model…', 'မော်ဒယ်စာရင်းပြန်ဖွင့်နေသည်…', 'Nire-refresh ang listahan ng model…', 'កំពុងផ្ទុកបញ្ជីម៉ូដែលឡើងវិញ…', 'ආකෘති ලැයිස්තුව යාවත්කාලීන වෙමින්…', 'मोडेल सूची ताजा हुँदै…', 'Model list refresh mek…', 'የሞዴል ዝርዝር በመታደስ ላይ…', 'Tarree moodeelaa haaromsaa jira…', 'جارٍ تحديث قائمة النماذج…'],
  },
  sidebar: {
    'session.new': ['नया सत्र', 'Phiên mới', 'เซสชันใหม่', 'Sesi baru', 'စကားပြောအသစ်', 'Bagong sesyon', 'សម័យថ្មី', 'නව සැසිය', 'नयाँ सत्र', 'Session thar', 'አዲስ ክፍለ ጊዜ', 'Turtii haaraa', 'جلسة جديدة'],
    'session.new.label': ['नया सत्र', 'Phiên mới', 'เซสชันใหม่', 'Sesi baru', 'စကားပြောအသစ်', 'Bagong sesyon', 'សម័យថ្មី', 'නව සැසිය', 'नयाँ सत्र', 'Session thar', 'አዲስ ክፍለ ጊዜ', 'Turtii haaraa', 'جلسة جديدة'],
    'toggle.open': ['साइडबार खोलें', 'Mở thanh bên', 'เปิดแถบข้าง', 'Buka bilah sisi', 'ဘေးဘားဖွင့်မည်', 'Buksan ang sidebar', 'បើករបារចំហៀង', 'පැති තීරුව විවෘත කරන්න', 'साइडबार खोल्नुहोस्', 'Sidebar hawng', 'የጎን አሞሌ ክፈት', 'Barjaa cinaa bani', 'افتح الشريط الجانبي'],
    'toggle.collapse': ['साइडबार समेटें', 'Thu gọn thanh bên', 'ย่อแถบข้าง', 'Ciutkan bilah sisi', 'ဘေးဘားချုံ့မည်', 'I-collapse ang sidebar', 'បង្រួមរបារចំហៀង', 'පැති තීරුව හකුළන්න', 'साइडबार खुम्च्याउनुहोस्', 'Sidebar khar', 'የጎን አሞሌ ሰብስብ', 'Barjaa cinaa cufi', 'اطوِ الشريط الجانبي'],
    'panels.label': ['पैनल', 'Bảng điều khiển', 'แผง', 'Panel', 'ပန်နယ်', 'Mga panel', 'ផ្ទាំង', 'පැනල', 'प्यानल', 'Panel', 'ፓነሎች', 'Paaneelii', 'اللوحات'],
  },
  sidebarFiles: {
    'type.label': ['फ़ाइलें', 'Tệp', 'ไฟล์', 'File', 'ဖိုင်', 'Mga file', 'ឯកសារ', 'ගොනු', 'फाइल', 'File', 'ፋይሎች', 'Faayilota', 'الملفات'],
    'guide.title': ['वर्कस्पेस फ़ाइलें', 'Tệp không gian làm việc', 'ไฟล์พื้นที่ทำงาน', 'File ruang kerja', 'အလုပ်နေရာဖိုင်များ', 'Mga file ng workspace', 'ឯកសារកន្លែងធ្វើការ', 'වැඩබිම් ගොනු', 'कार्यक्षेत्र फाइल', 'Workspace file', 'የስራ ቦታ ፋይሎች', 'Faayilota bakka hojii', 'ملفات مساحة العمل'],
    loading: ['पढ़ा जा रहा है…', 'Đang đọc…', 'กำลังอ่าน…', 'Membaca…', 'ဖတ်နေသည်…', 'Binabasa…', 'កំពុងអាន…', 'කියවමින්…', 'पढ्दै…', 'Chhiar mek…', 'በማንበብ ላይ…', 'Dubbisaa jira…', 'جارٍ القراءة…'],
    empty: ['खाली फ़ोल्डर', 'Thư mục trống', 'โฟลเดอร์ว่าง', 'Folder kosong', 'ဖိုလ်ဒါအလွတ်', 'Walang laman ang folder', 'ថតទទេ', 'හිස් ෆෝල්ඩරය', 'खाली फोल्डर', 'Folder ruak', 'ባዶ አቃፊ', 'Galmee duwwaa', 'مجلد فارغ'],
  },
  settings: {
    trigger: ['सेटिंग', 'Cài đặt', 'การตั้งค่า', 'Pengaturan', 'ဆက်တင်', 'Mga setting', 'ការកំណត់', 'සැකසුම්', 'सेटिङ', 'Setting', 'ቅንብሮች', 'Qindaa’ina', 'الإعدادات'],
    title: ['सेटिंग', 'Cài đặt', 'การตั้งค่า', 'Pengaturan', 'ဆက်တင်', 'Mga setting', 'ការកំណត់', 'සැකසුම්', 'सेटिङ', 'Setting', 'ቅንብሮች', 'Qindaa’ina', 'الإعدادات'],
    close: ['बंद करें', 'Đóng', 'ปิด', 'Tutup', 'ပိတ်မည်', 'Isara', 'បិទ', 'වසන්න', 'बन्द गर्नुहोस्', 'Khar', 'ዝጋ', 'Cufi', 'إغلاق'],
    'general.nav': ['सामान्य', 'Chung', 'ทั่วไป', 'Umum', 'အထွေထွေ', 'Pangkalahatan', 'ទូទៅ', 'සාමාන්‍ය', 'सामान्य', 'Tlangpui', 'አጠቃላይ', 'Waliigala', 'عام'],
  },
  'settings.account': {
    more: ['और', 'Thêm', 'เพิ่มเติม', 'Lainnya', 'နောက်ထပ်', 'Higit pa', 'បន្ថែម', 'තවත්', 'थप', 'A dang', 'ተጨማሪ', 'Dabalata', 'المزيد'],
    settings: ['सेटिंग', 'Cài đặt', 'การตั้งค่า', 'Pengaturan', 'ဆက်တင်', 'Mga setting', 'ការកំណត់', 'සැකසුම්', 'सेटिङ', 'Setting', 'ቅንብሮች', 'Qindaa’ina', 'الإعدادات'],
    signIn: ['साइन इन', 'Đăng nhập', 'เข้าสู่ระบบ', 'Masuk', 'ဝင်မည်', 'Mag-sign in', 'ចូល', 'පිවිසෙන්න', 'लगइन', 'Lut', 'ግባ', 'Seeni', 'تسجيل الدخول'],
    signOut: ['साइन आउट', 'Đăng xuất', 'ออกจากระบบ', 'Keluar', 'ထွက်မည်', 'Mag-sign out', 'ចាកចេញ', 'පිටවන්න', 'बाहिरिनुहोस्', 'Chhuak', 'ውጣ', 'Ba’i', 'تسجيل الخروج'],
    menu: ['खाता मेनू', 'Menu tài khoản', 'เมนูบัญชี', 'Menu akun', 'အကောင့်မီနူး', 'Menu ng account', 'ម៉ឺនុយគណនី', 'ගිණුම් මෙනුව', 'खाता मेनु', 'Account menu', 'የመለያ ምናሌ', 'Baafata herregaa', 'قائمة الحساب'],
    contactUs: ['प्रतिक्रिया', 'Phản hồi', 'ข้อเสนอแนะ', 'Masukan', 'အကြံပြုချက်', 'Puna', 'មតិ', 'ප්‍රතිචාර', 'प्रतिक्रिया', 'Sawisel', 'አስተያየት', 'Yaada', 'ملاحظات'],
  },
  conversation: {
    'placeholder.default': ['संदेश भेजें या काम बनाएँ, / कमांड, @ फ़ाइल या बातचीत', 'Gửi tin nhắn hoặc tạo việc, / lệnh, @ tệp hoặc hội thoại', 'ส่งข้อความหรือสร้างงาน, / คำสั่ง, @ ไฟล์หรือบทสนทนา', 'Kirim pesan atau buat tugas, / perintah, @ file atau percakapan', 'မက်ဆေ့ပို့ပါ သို့မဟုတ် အလုပ်ဖန်တီးပါ၊ / အမိန့်၊ @ ဖိုင် သို့မဟုတ် စကားပြော', 'Magpadala ng mensahe o gumawa ng gawain, / utos, @ file o usapan', 'ផ្ញើសារ ឬបង្កើតកិច្ចការ, / ពាក្យបញ្ជា, @ ឯកសារ ឬការសន្ទនា', 'පණිවිඩයක් යවන්න හෝ කාර්යයක් සාදන්න, / විධානය, @ ගොනුව හෝ සංවාදය', 'सन्देश पठाउनुहोस् वा काम बनाउनुहोस्, / आदेश, @ फाइल वा कुराकानी', 'Message thawn emaw hna siam, / thupek, @ file emaw inkawm', 'መልዕክት ላክ ወይም ስራ ፍጠር፣ / ትዕዛዝ፣ @ ፋይል ወይም ውይይት', 'Ergaa ergi ykn hojii uumi, / ajaja, @ faayila ykn haasawa', 'أرسل رسالة أو أنشئ مهمة، / أمر، @ ملف أو محادثة'],
    'placeholder.hero': ['बताएँ कि आप क्या बनाना चाहते हैं, / कमांड, @ फ़ाइल या बातचीत', 'Mô tả điều bạn muốn xây dựng, / lệnh, @ tệp hoặc hội thoại', 'บอกสิ่งที่อยากสร้าง, / คำสั่ง, @ ไฟล์หรือบทสนทนา', 'Jelaskan yang ingin Anda buat, / perintah, @ file atau percakapan', 'တည်ဆောက်လိုသည်ကို ရေးပါ၊ / အမိန့်၊ @ ဖိုင် သို့မဟုတ် စကားပြော', 'Ilarawan ang gusto mong gawin, / utos, @ file o usapan', 'ពណ៌នាអ្វីដែលអ្នកចង់សាងសង់, / ពាក្យបញ្ជា, @ ឯកសារ ឬការសន្ទនា', 'ඔබට සෑදීමට අවශ්‍ය දේ විස්තර කරන්න, / විධානය, @ ගොනුව හෝ සංවාදය', 'के बनाउन चाहनुहुन्छ लेख्नुहोस्, / आदेश, @ फाइल वा कुराकानी', 'I siam duh chu ziak, / thupek, @ file emaw inkawm', 'መገንባት የምትፈልገውን ግለጽ፣ / ትዕዛዝ፣ @ ፋይል ወይም ውይይት', 'Waan ijaaruu barbaaddu ibsi, / ajaja, @ faayila ykn haasawa', 'صف ما تريد بناءه، / أمر، @ ملف أو محادثة'],
    'placeholder.workspace': ['शुरू करने के लिए वर्कस्पेस चुनें', 'Chọn không gian làm việc để bắt đầu', 'เลือกพื้นที่ทำงานเพื่อเริ่ม', 'Pilih ruang kerja untuk mulai', 'စတင်ရန် အလုပ်နေရာရွေးပါ', 'Pumili ng workspace para magsimula', 'ជ្រើសកន្លែងធ្វើការដើម្បីចាប់ផ្តើម', 'ආරම්භ කිරීමට වැඩබිමක් තෝරන්න', 'सुरु गर्न कार्यक्षेत्र छान्नुहोस्', 'Tan tir nan workspace thlang', 'ለመጀመር የስራ ቦታ ምረጥ', 'Jalqabuuf bakka hojii filadhu', 'اختر مساحة عمل للبدء'],
    'placeholder.unavailable': ['सत्र उपलब्ध नहीं', 'Phiên không khả dụng', 'เซสชันไม่พร้อมใช้', 'Sesi tidak tersedia', 'စကားပြောမရနိုင်', 'Hindi available ang sesyon', 'សម័យមិនអាចប្រើ', 'සැසිය ලද නොහැක', 'सत्र उपलब्ध छैन', 'Session a awm lo', 'ክፍለ ጊዜው አይገኝም', 'Turtiin hin jiru', 'الجلسة غير متاحة'],
    'input.send': ['संदेश भेजें', 'Gửi tin nhắn', 'ส่งข้อความ', 'Kirim pesan', 'မက်ဆေ့ပို့မည်', 'Ipadala ang mensahe', 'ផ្ញើសារ', 'පණිවිඩය යවන්න', 'सन्देश पठाउनुहोस्', 'Message thawn', 'መልዕክት ላክ', 'Ergaa ergi', 'أرسل الرسالة'],
    'input.stop': ['जनरेशन रोकें', 'Dừng tạo', 'หยุดการสร้าง', 'Hentikan pembuatan', 'ထုတ်လုပ်မှုရပ်မည်', 'Ihinto ang paggawa', 'បញ្ឈប់ការបង្កើត', 'ජනනය නවත්වන්න', 'उत्पादन रोक्नुहोस्', 'Siam mek chu ting', 'ማመንጨት አቁም', 'Uumuu dhaabi', 'أوقف التوليد'],
    'input.file': ['फ़ाइल', 'Tệp', 'ไฟล์', 'File', 'ဖိုင်', 'File', 'ឯកសារ', 'ගොනුව', 'फाइल', 'File', 'ፋይል', 'Faayila', 'ملف'],
    'hero.headline': ['अनदेखी जगह की खोज', 'Khám phá miền chưa tới', 'สำรวจดินแดนที่ยังไม่ถึง', 'Jelajahi yang belum terjangkau', 'မရောက်ဖူးသေးသောနေရာကို ရှာပါ', 'Tuklasin ang hindi pa nararating', 'ស្វែងរកទីកន្លែងដែលមិនទាន់ដល់', 'නොපැමිණි තැන සොයන්න', 'नपुगेको ठाउँ खोज्नुहोस्', 'Hmun la thlen lo zawng', 'ያልደረስንበትን ቦታ ፈልግ', 'Bakka hin ga’amne barbaadi', 'استكشف ما لم يُبلغ بعد'],
    'hero.preview': ['पूर्वावलोकन', 'Bản xem trước', 'รุ่นตัวอย่าง', 'Pratinjau', 'အစမ်းကြည့်', 'Preview', 'មើលជាមុន', 'පෙරදසුන', 'पूर्वावलोकन', 'Enchhin', 'ቅድመ እይታ', 'Durargii', 'معاينة'],
    'hero.chooseWorkspace': ['वर्कस्पेस चुनें', 'Chọn không gian làm việc', 'เลือกพื้นที่ทำงาน', 'Pilih ruang kerja', 'အလုပ်နေရာရွေးပါ', 'Pumili ng workspace', 'ជ្រើសកន្លែងធ្វើការ', 'වැඩබිම තෝරන්න', 'कार्यक्षेत्र छान्नुहोस्', 'Workspace thlang', 'የስራ ቦታ ምረጥ', 'Bakka hojii filadhu', 'اختر مساحة العمل'],
  },
  chat: {
    'message.stepProcess.thinking': ['अनुरोध समझ रहा है', 'Đang phân tích yêu cầu', 'กำลังวิเคราะห์คำขอ', 'Menganalisis permintaan', 'တောင်းဆိုချက်ကို ဆန်းစစ်နေသည်', 'Sinusuri ang kahilingan', 'កំពុងវិភាគសំណើ', 'ඉල්ලීම විශ්ලේෂණය කරමින්', 'अनुरोध विश्लेषण गर्दै', 'Dilna siam mek', 'ጥያቄውን በመተንተን ላይ', 'Gaaffii xiinxalaa jira', 'يحلل الطلب'],
    'message.stepProcess.read': ['फ़ाइलें पढ़ रहा है', 'Đang đọc tệp', 'กำลังอ่านไฟล์', 'Membaca file', 'ဖိုင်ဖတ်နေသည်', 'Binabasa ang mga file', 'កំពុងអានឯកសារ', 'ගොනු කියවමින්', 'फाइल पढ्दै', 'File chhiar mek', 'ፋይሎችን በማንበብ ላይ', 'Faayilota dubbisaa jira', 'يقرأ الملفات'],
    'message.stepProcess.write': ['फ़ाइलें लिख रहा है', 'Đang ghi tệp', 'กำลังเขียนไฟล์', 'Menulis file', 'ဖိုင်ရေးနေသည်', 'Nagsusulat ng mga file', 'កំពុងសរសេរឯកសារ', 'ගොනු ලියමින්', 'फाइल लेख्दै', 'File ziak mek', 'ፋይሎችን በመጻፍ ላይ', 'Faayilota barreessaa jira', 'يكتب الملفات'],
    'message.stepProcess.search': ['कोड खोज रहा है', 'Đang tìm mã', 'กำลังค้นหาโค้ด', 'Mencari kode', 'ကုဒ်ရှာနေသည်', 'Naghahanap ng code', 'កំពុងស្វែងរកកូដ', 'කේතය සොයමින්', 'कोड खोज्दै', 'Code zawng mek', 'ኮድ በመፈለግ ላይ', 'Koodii barbaadaa jira', 'يبحث في الكود'],
    'message.stepProcess.edit': ['फ़ाइलें संपादित कर रहा है', 'Đang sửa tệp', 'กำลังแก้ไขไฟล์', 'Mengedit file', 'ဖိုင်ပြင်နေသည်', 'Nag-e-edit ng mga file', 'កំពុងកែឯកសារ', 'ගොනු සංස්කරණය කරමින්', 'फाइल सम्पादन गर्दै', 'File siamṭhat mek', 'ፋይሎችን በማረም ላይ', 'Faayilota gulaalaa jira', 'يعدّل الملفات'],
    'message.stepProcess.commands': ['कमांड चला रहा है', 'Đang chạy lệnh', 'กำลังรันคำสั่ง', 'Menjalankan perintah', 'အမိန့်လုပ်နေသည်', 'Nagpapatakbo ng mga utos', 'កំពុងដំណើរការពាក្យបញ្ជា', 'විධාන ක්‍රියාත්මක කරමින්', 'आदेश चलाइरहेको', 'Thupek tithmeh mek', 'ትዕዛዞችን በማስኬድ ላይ', 'Ajaja hojjechaa jira', 'يشغّل الأوامر'],
    'message.stepProcess.webSearch': ['वेब खोज रहा है', 'Đang tìm trên web', 'กำลังค้นหาเว็บ', 'Mencari di web', 'ဝက်ဘ်ရှာနေသည်', 'Naghahanap sa web', 'កំពុងស្វែងរកវេប', 'වෙබ් සොයමින්', 'वेब खोज्दै', 'Web zawng mek', 'ድረ ገጽ በመፈለግ ላይ', 'Weebii barbaadaa jira', 'يبحث في الويب'],
    'message.stepProcess.questions': ['आपकी कार्रवाई का इंतज़ार', 'Đang chờ bạn', 'กำลังรอการดำเนินการของคุณ', 'Menunggu tindakan Anda', 'သင့်လုပ်ဆောင်ချက်ကို စောင့်နေသည်', 'Hinihintay ang aksyon mo', 'កំពុងរង់ចាំសកម្មភាពរបស់អ្នក', 'ඔබේ ක්‍රියාව බලාපොරොත්තුවෙන්', 'तपाईंको काम पर्खिँदै', 'I tih a nghak', 'እርምጃህን በመጠባበቅ ላይ', 'Gocha kee eegaa jira', 'بانتظار إجراءك'],
    'message.stepProcess.done.thinking': ['विश्लेषण पूरा', 'Đã phân tích xong', 'วิเคราะห์เสร็จแล้ว', 'Analisis selesai', 'ဆန်းစစ်ပြီး', 'Tapos na ang pagsusuri', 'បានវិភាគរួច', 'විශ්ලේෂණය අවසන්', 'विश्लेषण सकियो', 'Siam a zo', 'ትንታኔ ተጠናቋል', 'Xiinxalli xumurame', 'اكتمل التحليل'],
    'message.stepProcess.done.read': ['फ़ाइलें पढ़ लीं', 'Đã đọc tệp', 'อ่านไฟล์แล้ว', 'Membaca file selesai', 'ဖိုင်ဖတ်ပြီး', 'Nabasa na ang mga file', 'បានអានឯកសារ', 'ගොනු කියවා ඇත', 'फाइल पढियो', 'File chhiar a zo', 'ፋይሎች ተነብበዋል', 'Faayilota dubbifame', 'قُرئت الملفات'],
    'message.stepProcess.done.edit': ['फ़ाइलें बदलीं', 'Đã sửa tệp', 'แก้ไขไฟล์แล้ว', 'File diedit', 'ဖိုင်ပြင်ပြီး', 'Na-edit na ang mga file', 'បានកែឯកសារ', 'ගොනු සංස්කරණය විය', 'फाइल सम्पादन भयो', 'File siamṭhat a zo', 'ፋይሎች ተስተካክለዋል', 'Faayilota gulaalame', 'عُدّلت الملفات'],
    'message.stepProcess.joinTwo': ['{first} और {second}', '{first} và {second}', '{first} และ {second}', '{first} dan {second}', '{first} နှင့် {second}', '{first} at {second}', '{first} និង {second}', '{first} සහ {second}', '{first} र {second}', '{first} leh {second}', '{first} እና {second}', '{first} fi {second}', '{first} و{second}'],
    'message.stepProcess.comma': [', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', ', '],
    'message.stepProcess.more': ['{title} आदि', '{title} và các mục khác', '{title} และอื่นๆ', '{title} dan lainnya', '{title} စသည်', '{title} at iba pa', '{title} និងផ្សេងទៀត', '{title} ආදිය', '{title} आदि', '{title} leh a dang', '{title} ወዘተ', '{title} fi kan biraa', '{title} وغيرها'],
  },
}), VISIBLE_PACKS)

// These comma characters break the TypeScript lexer when written in source.
for (const [locale, comma] of [['my', 0x104a], ['ar', 0x060c]] as const) {
  const chat = LANGUAGE_PACKS[locale]?.chat
  if (chat !== undefined) chat['message.stepProcess.comma'] = `${String.fromCodePoint(comma)} `
}

// cspell:ignoreRegExp /[\u0370-\u03FF\u0400-\u04FF\u0590-\u06FF\u0900-\u0E7F\u1000-\u109F\uAC00-\uD7AF]+/g
// cspell:ignoreRegExp /"[A-Z][a-z]+([- ][A-Z][a-z]+)*"/g
// cspell:ignore Byeol Krung Maha Myint Nakhon Rehov Thep Ermou Odos José João Khreshchatyk Mirpur Müller Rahul Shar Tahrir Teug Tverskaia Łukasz Ｊｏｈｎ
import { describe, expect, it } from "vitest";

import { latin, transliterateAddress, transliterateName } from "../../utils/transliterate";

describe("transliterate", () => {
  describe("latin", () => {
    it.each([
      ["John O'Brien-Smith", true],
      ["José Müller", true],
      ["Łukasz", false],
      ["محمد", false],
      ["", true],
    ])("checks %s", (text, expected) => {
      expect(latin(text)).toBe(expected);
    });
  });

  describe("name", () => {
    it.each([
      { text: "José", country: "AR", expected: undefined },
      { text: "  ", country: "AR", expected: undefined },
      { text: "😀", country: "US", expected: undefined },
      { text: "Łukasz", country: "PL", expected: "Lukasz" },
      { text: "小明", country: "CN", expected: "Xiaoming" },
      { text: "吕", country: "CN", surname: true, expected: "Lyu" },
      { text: "曾", country: "CN", surname: true, expected: "Zeng" },
      { text: "阿卜杜拉·艾力", country: "CN", expected: "Abudula Aili" },
      { text: "小　明", country: "CN", expected: "Xiao Ming" },
      { text: "山田さくら", country: "JP", expected: "Shantiansakura" },
      { text: "김", country: "KR", surname: true, expected: "Kim" },
      { text: "남궁", country: "KR", surname: true, expected: "Namgung" },
      { text: "민수", country: "KR", expected: "Minsu" },
      { text: "Щукин Юрий", country: "RU", expected: "Shchukin Iurii" },
      { text: "Юрій", country: "UA", expected: "Yurii" },
      { text: "Ελένη", country: "GR", expected: "Eleni" },
      { text: "محمد", country: "EG", expected: "Mohamed" },
      { text: "محمد", country: "SA", expected: "Mohammed" },
      { text: "محمد", country: "JO", expected: "Mohammad" },
      { text: "مصطفى", country: "JO", expected: "Mustafa" },
      { text: "حسين", country: "MA", expected: "Hocine" },
      { text: "أحمد", country: "AE", expected: "Ahmed" },
      { text: "مُحَمَّد", country: "EG", expected: "Mohamed" },
      { text: "عبد الرحمن", country: "EG", expected: "Abdelrahman" },
      { text: "عبدالعزيز", country: "SA", expected: "Abdulaziz" },
      { text: "عبد الله", country: "SA", expected: "Abdullah" },
      { text: "عبدالله", country: "EG", expected: "Abdallah" },
      { text: "عبد الصمد", country: "SA", expected: "Abdulsamad" },
      { text: "عبد", country: "SA", expected: "Abad" },
      { text: "أبو بكر", country: "SA", expected: "Abu Bakr" },
      { text: "ابوالعلا", country: "EG", expected: "Abou El-Ala" },
      { text: "الشمري", country: "SA", surname: true, expected: "Al-Shamri" },
      { text: "المصري", country: "EG", surname: true, expected: "El-Masry" },
      { text: "التونسي", country: "TN", surname: true, expected: "El-Tounsi" },
      { text: "الم", country: "SA", expected: "Alam" },
      { text: "فاطمة", country: "EG", expected: "Fatma" },
      { text: "جميل", country: "EG", expected: "Gamil" },
      { text: "جميل", country: "SA", expected: "Jamil" },
      { text: "سمر", country: "JO", expected: "Samar" },
      { text: "شهد", country: "SA", expected: "Shahad" },
      { text: "وداد", country: "SA", expected: "Wadad" },
      { text: "داود", country: "SA", expected: "Dawd" },
      { text: "نعمان", country: "SA", expected: "Naaman" },
      { text: "سعود", country: "SA", expected: "Saud" },
      { text: "منصورة", country: "LY", expected: "Mansoura" },
      { text: "يسرى", country: "EG", expected: "Yasra" },
      { text: "هاني", country: "SA", expected: "Hani" },
      { text: "زكي", country: "EG", expected: "Zaky" },
      { text: "زكي", country: "SA", expected: "Zaki" },
      { text: "رؤوف", country: "EG", expected: "Raouf" },
      { text: "إلهام", country: "SA", expected: "Ilham" },
      { text: "مأمون", country: "SA", expected: "Mamun" },
      { text: "ربيع", country: "SA", expected: "Rabi" },
      { text: "حياة", country: "SA", expected: "Hayat" },
      { text: "رائد", country: "SA", expected: "Raed" },
      { text: "رضا", country: "IR", expected: "Reza" },
      { text: "پروین", country: "IR", expected: "Parvin" },
      { text: "ویدا", country: "IR", expected: "Vida" },
      { text: "ٹیپو", country: "PK", expected: "Tipu" },
      { text: "محمد", country: "PK", expected: "Muhammad" },
      { text: "فاطمہ", country: "PK", expected: "Fatima" },
      { text: "ملک", country: "PK", surname: true, expected: "Malik" },
      { text: "عمران", country: "PK", expected: "Imran" },
      { text: "حسین", country: "IR", expected: "Hossein" },
      { text: "احمد", country: "IR", expected: "Ahmad" },
      { text: "مریم", country: "IR", expected: "Maryam" },
      { text: "مصطفی", country: "IR", expected: "Mustafa" },
      { text: "فرشته", country: "IR", expected: "Farshteh" },
      { text: "وجيه", country: "SA", expected: "Wajih" },
      { text: "Ελευθέριος", country: "GR", expected: "Eleftherios" },
      { text: "Παπαδόπουλος", country: "GR", surname: true, expected: "Papadopoulos" },
      { text: "Ευάγγελος", country: "GR", expected: "Evangelos" },
      { text: "Χρήστος", country: "GR", expected: "Christos" },
      { text: "γιώργος", country: "GR", expected: "Giorgos" },
      { text: "Μαΐστρος", country: "GR", surname: true, expected: "Maistros" },
      { text: "Προϋπολογισμός", country: "GR", expected: "Proypologismos" },
      { text: "Μπάμπης", country: "GR", expected: "Mpampis" },
      { text: "राहुल", country: "IN", expected: "Rahul" },
      { text: "शर्मा", country: "IN", surname: true, expected: "Sharma" },
      { text: "कृष्ण", country: "IN", expected: "Krishna" },
      { text: "चन्द्र", country: "IN", expected: "Chandra" },
      { text: "आनंद", country: "IN", expected: "Anand" },
      { text: "क", country: "IN", expected: "Ka" },
      { text: "कमल्", country: "IN", expected: "Kamal" },
      { text: "अमरनाथ", country: "IN", expected: "Amarnath" },
      { text: "রহিম", country: "BD", expected: "Rahim" },
      { text: "అనిల్", country: "IN", expected: "Anil" },
      { text: "రాజు", country: "IN", expected: "Raju" },
      { text: "සුනිල්", country: "LK", expected: "Sunil" },
      { text: "குமார்", country: "IN", expected: "Kumar" },
      { text: "राहुल-राहुल", country: "IN", expected: "Rahul-Rahul" },
      { text: "สมชาย", country: "TH", expected: "Somchai" },
      { text: "ธนกฤต", country: "TH", expected: "Thanakrit" },
      { text: "陳", country: "HK", surname: true, expected: "Chan" },
      { text: "大文", country: "HK", expected: "Tai Man" },
      { text: "李", country: "HK", surname: true, expected: "Lee" },
      { text: "歐陽", country: "HK", surname: true, expected: "Au Yeung" },
      { text: "司徒", country: "HK", surname: true, expected: "Szeto" },
      { text: "張", country: "MO", surname: true, expected: "Cheung" },
      { text: "謝", country: "HK", surname: true, expected: "Tse" },
      { text: "徐", country: "HK", surname: true, expected: "Tsui" },
      { text: "潘", country: "HK", surname: true, expected: "Poon" },
      { text: "孫", country: "HK", surname: true, expected: "Suen" },
      { text: "郭", country: "HK", surname: true, expected: "Kwok" },
      { text: "高", country: "HK", surname: true, expected: "Ko" },
      { text: "吳", country: "HK", surname: true, expected: "Ng" },
      { text: "嘉欣", country: "HK", expected: "Ka Yan" },
      { text: "詩兒", country: "HK", expected: "Sze Yee" },
      { text: "子月", country: "HK", expected: "Tsz Yuet" },
      { text: "書信", country: "HK", expected: "Shu Shun" },
      { text: "李𠀀", country: "HK", surname: true, expected: "Lee" },
      { text: "張", country: "TW", surname: true, expected: "Chang" },
      { text: "家豪", country: "TW", expected: "Chia-Hao" },
      { text: "怡君", country: "TW", expected: "Yi-Chun" },
      { text: "謝", country: "TW", surname: true, expected: "Hsieh" },
      { text: "何", country: "TW", surname: true, expected: "Ho" },
      { text: "郭", country: "TW", surname: true, expected: "Kuo" },
      { text: "多", country: "TW", expected: "To" },
      { text: "說", country: "TW", expected: "Shuo" },
      { text: "貴", country: "TW", expected: "Kuei" },
      { text: "瑞", country: "TW", expected: "Jui" },
      { text: "雄", country: "TW", expected: "Hsiung" },
      { text: "燕", country: "TW", expected: "Yen" },
      { text: "學", country: "TW", expected: "Hsueh" },
      { text: "呂", country: "TW", surname: true, expected: "Lu" },
      { text: "子軒", country: "TW", expected: "Tzu-Hsuan" },
      { text: "しんいち", country: "JP", expected: "Shinichi" },
      { text: "ほんま", country: "JP", expected: "Homma" },
      { text: "ゆうこ", country: "JP", expected: "Yuko" },
      { text: "おおの", country: "JP", expected: "Ono" },
      { text: "いのうえ", country: "JP", expected: "Inoue" },
      { text: "דוד", country: "IL", expected: "David" },
      { text: "דָּן", country: "IL", expected: "Dan" },
      { text: "רון", country: "IL", expected: "Ron" },
      { text: "ברק", country: "IL", surname: true, expected: "Barak" },
      { text: "נועה", country: "IL", expected: "Noa" },
      { text: "מיכל", country: "IL", expected: "Michal" },
      { text: "כץ", country: "IL", surname: true, expected: "Katz" },
      { text: "שירה", country: "IL", expected: "Shira" },
      { text: "פז", country: "IL", expected: "Paz" },
      { text: "אריה", country: "IL", expected: "Aria" },
      { text: "ג׳ורג׳", country: "IL", expected: "Joraj" },
      { text: "עידו", country: "IL", expected: "Ido" },
      { text: "יוסי", country: "IL", expected: "Yosi" },
      { text: "אוריה", country: "IL", expected: "Oria" },
      { text: "ה", country: "IL", expected: "H" },
      { text: "יי", country: "IL", expected: "Y" },
      { text: "אורי", country: "IL", expected: "Ori" },
      { text: "אא", country: "IL", expected: "A" },
      { text: "အောင်ဆန်းစုကြည်", country: "MM", expected: "Aung San Su Kyi" },
      { text: "ကျော်ဇော်", country: "MM", expected: "Kyaw Zaw" },
      { text: "ထက်လင်း", country: "MM", expected: "Htet Lin" },
      { text: "မြင့်ဦး", country: "MM", expected: "Myint U" },
      { text: "ဝင်းသိန်း", country: "MM", expected: "Win Thein" },
      { text: "လှမြ", country: "MM", expected: "Hla Mya" },
      { text: "ဖြိုးသူ", country: "MM", expected: "Phyo Thu" },
      { text: "ခင်နွယ်", country: "MM", expected: "Khin Nwe" },
      { text: "ရှိန်", country: "MM", expected: "Shein" },
      { text: "အေးအေး", country: "MM", expected: "Aye Aye" },
      { text: "ကျွန်း", country: "MM", expected: "Kyun" },
      { text: "သန္တာ", country: "MM", expected: "Than Ta" },
      { text: "သန့်", country: "MM", expected: "Thant" },
      { text: "ဗုဒ္ဓ", country: "MM", expected: "Bok Da" },
      { text: "安", country: "TW", expected: "An" },
      { text: "אביב", country: "IL", expected: "Aviv" },
      { text: "יפה", country: "IL", expected: "Yafa" },
      { text: "ויקי", country: "IL", expected: "Viki" },
      { text: "ײ", country: "IL", expected: "Ey" },
      { text: "ၐ", country: "MM", expected: "S" },
      { text: "သုံး", country: "MM", expected: "Thon" },
      { text: "ချစ်", country: "MM", expected: "Chit" },
      { text: "ကွမ်း", country: "MM", expected: "Kun" },
      { text: "ကွပ်", country: "MM", expected: "Kut" },
      { text: "မာန်", country: "MM", expected: "Man" },
      { text: "ကိုယ်", country: "MM", expected: "Ko" },
      { text: "\u200B", country: "US", expected: undefined },
    ])("romanizes $text from $country", ({ text, country, surname, expected }) => {
      expect(transliterateName(text, country, { surname })).toBe(expected);
    });

    it("prefers the latin name from the document", () => {
      expect(transliterateName("محمد", "EG", { document: " MOHAMED " })).toBe("MOHAMED");
    });

    it("ignores a non-latin name from the document", () => {
      expect(transliterateName("محمد", "EG", { document: "محمد" })).toBe("Mohamed");
    });

    it("ignores a missing name from the document", () => {
      expect(transliterateName("محمد", "EG", { document: null })).toBe("Mohamed");
    });

    it("keeps a latin name when the document has another", () => {
      expect(transliterateName("John", "US", { document: "JOHN" })).toBeUndefined();
    });

    it.each([
      { text: "Jose\u0301", expected: "José" },
      { text: "Ｊｏｈｎ", expected: "John" },
    ])("sends the normalized latin name for $text", ({ text, expected }) => {
      expect(transliterateName(text, "ES", { document: "JOSE" })).toBe(expected);
    });
  });

  describe("address", () => {
    it.each([
      { text: "Rua São João, 12", country: "BR", expected: "Rua São João, 12" },
      { text: "上海市浦东新区世纪大道100号", country: "CN", expected: "ShangHaiShiPuDongXinQuShiJiDaDao100Hao" },
      { text: "ул. Тверская, д. 7", country: "RU", expected: "ul. Tverskaia, d. 7" },
      { text: "вул. Хрещатик, 22", country: "UA", expected: "vul. Khreshchatyk, 22" },
      { text: "شارع التحرير ١٢", country: "EG", expected: "Shar El-Tahrir 12" },
      { text: "١٢ب شارع النيل", country: "EG", expected: "12b Shar El-Nil" },
      { text: "12ب-Block", country: "EG", expected: "12b-Block" },
      { text: "ঢাকা মিরপুর রোড ১২", country: "BD", expected: "Dhaka Mirpur Rod 12" },
      { text: "Οδός Ερμού 15", country: "GR", expected: "Odos Ermou 15" },
      { text: "मुंबई", country: "IN", expected: "Mumbai" },
      { text: "சென்னை", country: "IN", expected: "Cennai" },
      { text: "राहुल,", country: "IN", expected: "Rahul," },
      { text: "Sector-१२", country: "IN", expected: "Sector-12" },
      { text: "Block-C१२", country: "IN", expected: "Block-C12" },
      { text: "서울특별시 강남구", country: "KR", expected: "SeoUlTeugByeolSi GangNamGu" },
      { text: "กรุงเทพมหานคร 10110", country: "TH", expected: "Krung Thep Maha Nakhon 10110" },
      { text: "רחוב הרצל 12", country: "IL", expected: "Rehov Herzl 12" },
      { text: "ရန်ကုန် ၁၂", country: "MM", expected: "Yan Kon 12" },
      { text: "とうきょう", country: "JP", expected: "Tokyo" },
    ])("romanizes $text from $country", ({ text, country, expected }) => {
      expect(transliterateAddress(text, country)).toBe(expected);
    });
  });
});

// cspell:ignoreRegExp /[\u0600-\u06FF\uAC00-\uD7AF]+/g
// cspell:ignoreRegExp /"[A-Z][a-z]+(-[A-Z][a-z]+)?"/g
// cspell:ignore aāeiīoōuūṛ bcdgjkpt brahmic gurmukhi iast αβγδεζηιλμνορυω
import Sanscript from "@indic-transliteration/sanscript";
import anyAscii from "any-ascii";
import cyrillicToTranslit from "cyrillic-to-translit-js";
import { ICAO_DOC_9303, translate } from "iuliia";
import { pinyin } from "pinyin-pro";

export function latin(text: string) {
  return /^[\u0020-\u007E\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]*$/u.test(text);
}

export function transliterateName(
  text: string,
  country: string,
  { document, surname = false }: { document?: null | string; surname?: boolean } = {},
) {
  if (latin(text)) return;
  const input = clean(text);
  if (latin(input)) return input || undefined;
  const documentName = document && clean(document);
  if (documentName && latin(documentName)) return documentName;
  return (
    romanize(
      input.replaceAll(/(^|\s)(عبد|[اأ]بو)\s+(?=ال)/gu, "$1$2"),
      country,
      surname ? "surname" : "name",
    ).replaceAll(/(^|[\s-])(\p{L})(\p{L}*)/gu, (_, start: string, first: string, rest: string) => {
      return `${start}${first.toUpperCase()}${rest.toLowerCase()}`;
    }) || undefined
  );
}

export function transliterateAddress(text: string, country: string) {
  const input = clean(text);
  if (latin(input)) return input;
  return input
    .split(" ")
    .map((word) => {
      const out = romanize(word, country, "address");
      return /[\p{Ll}\p{Lu}]/u.test(word)
        ? out
        : out.replaceAll(/(^|-)(\p{Ll})/gu, (_, start: string, first: string) => `${start}${first.toUpperCase()}`);
    })
    .filter(Boolean)
    .join(" ");
}

function clean(text: string) {
  return text
    .normalize("NFKC")
    .replaceAll(/\p{Extended_Pictographic}/gu, "")
    .replaceAll(/[\s·・‧•]+/gu, " ")
    .trim();
}

function romanize(text: string, country: string, kind: "address" | "name" | "surname") {
  return text
    .split(/([^\p{L}\p{M}\u200C\u200D]+|\p{Script=Latin}+)/u)
    .map((word) => {
      if (!/\p{L}/u.test(word) || /\p{Script=Latin}/u.test(word)) return anyAscii(word);
      if (
        kind !== "address" &&
        /\p{Script=Han}/u.test(word) &&
        !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)
      ) {
        return anyAscii(
          pinyin(word, {
            toneType: "none",
            type: "array",
            surname: kind === "surname" ? "all" : "off",
            v: "yu",
          }).join(""),
        );
      }
      if (kind === "surname" && korean[word]) return korean[word];
      if (/\p{Script=Cyrillic}/u.test(word)) {
        return anyAscii(country === "UA" ? ukrainian.transform(word) : translate(word, ICAO_DOC_9303));
      }
      if (/\p{Script=Arabic}/u.test(word)) return arabic(word, region(country));
      if (/\p{Script=Greek}/u.test(word)) return greek(word);
      const indic = /[\u0900-\u0DFF]/u.exec(word)?.[0].codePointAt(0);
      if (indic !== undefined) return brahmic(word, indic - (indic % 0x80));
      return anyAscii(word);
    })
    .join("")
    .replaceAll(/[`´]/gu, "")
    .replaceAll(/(^|\s)'+|'+(?=\s|$)/gu, "$1")
    .replaceAll(/[^\u0020-\u007E\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

const ukrainian = cyrillicToTranslit({ preset: "uk" });

function greek(word: string) {
  const out = word
    .normalize("NFD")
    .toLowerCase()
    .replaceAll(/[\u0301\u0342]/gu, "")
    .replaceAll(/([αεη])υ(?=[αβγδεζηιλμνορυω])/gu, (_, vowel: string) => `${greekLetters[vowel]}v`)
    .replaceAll(/([αεη])υ(?!\u0308)/gu, (_, vowel: string) => `${greekLetters[vowel]}f`)
    .replaceAll(/ου(?!\u0308)/gu, "ou")
    .replaceAll(/γ(?=[γξχ])/gu, "n")
    .replaceAll("\u0308", "")
    .replaceAll(/[\u03B1-\u03C9]/gu, (char) => `${greekLetters[char]}`);
  return /^\p{Lu}/u.test(word) ? `${out.charAt(0).toUpperCase()}${out.slice(1)}` : out;
}

function brahmic(word: string, block: number) {
  const script = brahmicScripts[block];
  if (!script) return anyAscii(word);
  const tokens = [...Sanscript.t(word, script, "iast").matchAll(/[bcdgjkpt]h|[ḍṭ]h|[aāeiīoōuūṛ][iu]?[ḥṁṃ]?|./gu)].map(
    ([token]) => token,
  );
  if (syncope.has(block)) {
    for (let index = tokens.length - 1; index > 1; index--) {
      if (
        tokens[index] === "a" &&
        !vowel(tokens[index - 1]) &&
        vowel(tokens[index - 2]) &&
        (index === tokens.length - 1 || (!vowel(tokens[index + 1]) && vowel(tokens[index + 2])))
      ) {
        tokens[index] = "";
      }
    }
  }
  return anyAscii(
    tokens
      .join("")
      .replaceAll(/[śṣ]/gu, "sh")
      .replaceAll("c", "ch")
      .replaceAll("ṛ", "ri")
      .replaceAll(/[ṁṃ](?=[bmp])/gu, "m")
      .replaceAll(/[ṁṃ]/gu, "n"),
  );
}

const brahmicScripts: Record<number, string> = {
  0x09_00: "devanagari",
  0x09_80: "bengali",
  0x0a_00: "gurmukhi",
  0x0a_80: "gujarati",
  0x0b_00: "oriya",
  0x0c_00: "telugu",
  0x0c_80: "kannada",
  0x0d_00: "malayalam",
};

const vowel = (token?: string) => /^[aāeiīoōuūṛ]/u.test(token ?? "");

const syncope = new Set([0x09_00, 0x09_80, 0x0a_00, 0x0a_80]);

const greekLetters: Record<string, string> = {
  α: "a",
  β: "v",
  γ: "g",
  δ: "d",
  ε: "e",
  ζ: "z",
  η: "i",
  θ: "th",
  ι: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
};

type Region = "egypt" | "gulf" | "levant" | "maghreb" | "persian" | "urdu";

function region(country: string): Region {
  if (["EG", "LY", "SD"].includes(country)) return "egypt";
  if (["DZ", "MA", "MR", "TN"].includes(country)) return "maghreb";
  if (["JO", "LB", "PS", "SY"].includes(country)) return "levant";
  if (["AF", "IR"].includes(country)) return "persian";
  if (country === "PK") return "urdu";
  return "gulf";
}

function arabic(word: string, from: Region): string {
  const text = word
    .replaceAll(/[\u0610-\u061A\u064B-\u065F\u0670\u0640]/gu, "")
    .replaceAll("ک", "ك")
    .replaceAll("ی", "ي")
    .replaceAll("ہ", "ه")
    .replaceAll("ۃ", "ة");
  const known = name(text, from);
  if (known) return known;
  if (text.startsWith("عبد") && text.length > 4) {
    const rest = text.slice(3).replace(/^ال/u, "");
    const attribute = names.get(`ال${rest}`);
    if (attribute === "Lah") return from === "gulf" ? "Abdullah" : "Abdallah";
    return `${from === "gulf" ? "Abdul" : "Abdel"}${typeof attribute === "string" ? attribute : letters(rest, from)}`;
  }
  if (/^[اأ]بو./u.test(text)) return `${name("ابو", from)} ${arabic(text.slice(3), from)}`;
  if (text.startsWith("ال") && text.length > 3) {
    return `${from === "egypt" || from === "maghreb" ? "El" : "Al"}-${arabic(text.slice(2), from)}`;
  }
  return letters(text, from);
}

function name(text: string, from: Region) {
  const key = text.replace(/^[أإآٱ]/u, "ا");
  const entry = names.get(key) ?? names.get(key.replace(/ي$/u, "ى").replace(/ه$/u, "ة"));
  return typeof entry === "object"
    ? (entry[from] ?? (from === "persian" ? entry.levant : undefined) ?? entry.gulf)
    : entry;
}

function letters(text: string, from: Region) {
  const chars = [...text]; // eslint-disable-line @typescript-eslint/no-misused-spread -- arabic letters are single code points
  const roles: ("consonant" | "glottal" | "vowel")[] = [];
  for (const [index, char] of chars.entries()) {
    if (long.has(char)) roles.push("vowel");
    else if (char === "و" || char === "ي") {
      roles.push(
        index === 0 ||
          roles[index - 1] === "vowel" ||
          long.has(chars[index + 1]) ||
          (char === "و" && chars[index + 1] === "ي")
          ? "consonant"
          : "vowel",
      );
    } else roles.push(["ء", "ؤ", "ئ"].includes(char) ? "glottal" : "consonant");
  }
  return chars
    .map((char, index) => {
      const role = roles[index];
      const previous = roles[index - 1];
      const next = roles[index + 1];
      let out: string;
      switch (char) {
        case "إ":
          out = "i";
          break;
        case "ة":
          out = previous === "vowel" ? "t" : "a";
          break;
        case "و":
          out =
            role === "consonant"
              ? from === "persian"
                ? "v"
                : "w"
              : from === "egypt" || from === "maghreb"
                ? "ou"
                : "u";
          break;
        case "ي":
          out = role === "consonant" ? "y" : !next && from === "egypt" ? "y" : "i";
          break;
        case "ع":
          out = index === 0 || next === "consonant" ? "a" : "";
          break;
        case "ه":
          out = next ? "h" : (({ persian: "eh", urdu: "a" } as Partial<Record<Region, string>>)[from] ?? "h");
          break;
        default:
          if (role === "vowel") out = "a";
          else if (role === "glottal") out = previous === "vowel" ? "e" : "a";
          else out = (from === "egypt" ? egyptian[char] : undefined) ?? consonants[char] ?? anyAscii(char);
      }
      return role === "consonant" && char !== "ع" && next === "consonant" && (index === 0 || chars.length === 3)
        ? `${out}a`
        : out;
    })
    .join("");
}

const long = new Set<string | undefined>(["ا", "آ", "أ", "إ", "ٱ", "ى", "ة"]);

const korean: Record<string, string> = {
  강: "Kang",
  권: "Kwon",
  김: "Kim",
  류: "Ryu",
  박: "Park",
  서: "Seo",
  송: "Song",
  신: "Shin",
  안: "Ahn",
  오: "Oh",
  윤: "Yoon",
  이: "Lee",
  임: "Lim",
  장: "Jang",
  정: "Jung",
  조: "Cho",
  최: "Choi",
  한: "Han",
  홍: "Hong",
  황: "Hwang",
};

const consonants: Record<string, string> = {
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  پ: "p",
  چ: "ch",
  ژ: "zh",
  گ: "g",
};

const egyptian: Record<string, string> = { ث: "s", ج: "g", ذ: "z", ق: "k" };

const names = new Map<string, Partial<Record<Region, string>> | string>([
  ["محمد", { egypt: "Mohamed", maghreb: "Mohamed", gulf: "Mohammed", levant: "Mohammad", urdu: "Muhammad" }],
  ["احمد", { egypt: "Ahmed", maghreb: "Ahmed", gulf: "Ahmed", levant: "Ahmad" }],
  ["محمود", "Mahmoud"],
  ["رضا", { egypt: "Reda", gulf: "Rida", persian: "Reza", urdu: "Raza" }],
  ["علاء", "Alaa"],
  ["بكر", "Bakr"],
  ["مصطفى", { egypt: "Mostafa", maghreb: "Mustapha", gulf: "Mustafa" }],
  ["علي", "Ali"],
  ["حسن", { egypt: "Hassan", gulf: "Hassan", levant: "Hasan", persian: "Hassan" }],
  ["حسين", { egypt: "Hussein", maghreb: "Hocine", gulf: "Hussain", levant: "Hussein", persian: "Hossein" }],
  ["ابراهيم", "Ibrahim"],
  ["اسماعيل", "Ismail"],
  ["يوسف", { egypt: "Youssef", maghreb: "Youssef", gulf: "Yousef" }],
  ["عمر", "Omar"],
  ["عمرو", "Amr"],
  ["عثمان", { egypt: "Osman", gulf: "Othman", urdu: "Usman" }],
  ["خالد", { egypt: "Khaled", maghreb: "Khaled", gulf: "Khalid", levant: "Khaled" }],
  ["طارق", { egypt: "Tarek", maghreb: "Tarek", gulf: "Tariq", levant: "Tarek" }],
  ["كريم", { egypt: "Karim", maghreb: "Karim", gulf: "Kareem", levant: "Karim" }],
  ["سعيد", { egypt: "Said", maghreb: "Said", gulf: "Saeed", levant: "Saeed" }],
  ["سعد", "Saad"],
  ["صالح", "Saleh"],
  ["سامي", { egypt: "Samy", gulf: "Sami" }],
  ["سمير", { gulf: "Sameer", egypt: "Samir", maghreb: "Samir", levant: "Samir" }],
  ["عادل", "Adel"],
  ["اشرف", "Ashraf"],
  ["ايمن", "Ayman"],
  ["وليد", { egypt: "Walid", maghreb: "Walid", gulf: "Waleed", levant: "Walid" }],
  ["هشام", { egypt: "Hesham", maghreb: "Hicham", gulf: "Hisham", levant: "Hisham" }],
  ["ياسر", { egypt: "Yasser", gulf: "Yasser", levant: "Yaser" }],
  ["جمال", { egypt: "Gamal", maghreb: "Djamel", gulf: "Jamal", levant: "Jamal" }],
  ["ماجد", { egypt: "Maged", gulf: "Majed" }],
  ["مجدي", { egypt: "Magdy", gulf: "Majdi" }],
  ["حمدي", { egypt: "Hamdy", gulf: "Hamdi" }],
  ["فتحي", { egypt: "Fathy", gulf: "Fathi" }],
  ["رمضان", "Ramadan"],
  ["شريف", { egypt: "Sherif", gulf: "Sharif" }],
  ["عماد", { egypt: "Emad", gulf: "Imad", levant: "Imad", maghreb: "Imad" }],
  ["عصام", { egypt: "Essam", gulf: "Issam" }],
  ["اسلام", "Islam"],
  ["زياد", "Ziad"],
  ["فهد", "Fahad"],
  ["فيصل", "Faisal"],
  ["سلطان", "Sultan"],
  ["ناصر", "Nasser"],
  ["منصور", "Mansour"],
  ["بدر", "Badr"],
  ["راشد", { egypt: "Rashed", gulf: "Rashid", levant: "Rashed" }],
  ["سالم", "Salem"],
  ["سليمان", { egypt: "Soliman", maghreb: "Slimane", gulf: "Sulaiman", levant: "Suleiman" }],
  ["سلمان", "Salman"],
  ["نايف", { egypt: "Nayef", gulf: "Naif" }],
  ["تركي", "Turki"],
  ["مشعل", "Mishal"],
  ["بندر", "Bandar"],
  ["حمد", "Hamad"],
  ["حمزة", "Hamza"],
  ["انس", "Anas"],
  ["بلال", { egypt: "Belal", maghreb: "Bilal", gulf: "Bilal" }],
  ["مالك", { egypt: "Malek", gulf: "Malik", levant: "Malek" }],
  ["مراد", { egypt: "Mourad", maghreb: "Mourad", gulf: "Murad" }],
  ["نبيل", { egypt: "Nabil", gulf: "Nabeel", levant: "Nabil" }],
  ["هاني", { egypt: "Hany", gulf: "Hani" }],
  ["رامي", { egypt: "Ramy", gulf: "Rami" }],
  ["شادي", { egypt: "Shady", gulf: "Shadi" }],
  ["فادي", { egypt: "Fady", gulf: "Fadi" }],
  ["باسم", { egypt: "Bassem", gulf: "Basim", levant: "Bassem" }],
  ["حازم", "Hazem"],
  ["تامر", "Tamer"],
  ["وائل", "Wael"],
  ["اسامة", { egypt: "Osama", gulf: "Osama", levant: "Usama" }],
  ["معاذ", { egypt: "Moaz", gulf: "Muath" }],
  ["حسام", { egypt: "Hossam", gulf: "Husam" }],
  ["مازن", "Mazen"],
  ["امين", { egypt: "Amin", gulf: "Ameen" }],
  ["جمعة", { egypt: "Gomaa", gulf: "Juma" }],
  ["رجب", { egypt: "Ragab", gulf: "Rajab" }],
  ["شعبان", "Shaaban"],
  ["عبده", "Abdo"],
  ["مهدي", { gulf: "Mahdi", persian: "Mehdi" }],
  ["زهرا", "Zahra"],
  ["امير", "Amir"],
  ["عليرضا", "Alireza"],
  ["محمدرضا", "Mohammadreza"],
  ["اميرحسين", "Amirhossein"],
  ["ابوالفضل", "Abolfazl"],
  ["نرگس", "Narges"],
  ["پريسا", "Parisa"],
  ["نازنين", "Nazanin"],
  ["شيرين", "Shirin"],
  ["رضايي", "Rezaei"],
  ["حسيني", { gulf: "Husseini", persian: "Hosseini" }],
  ["محمدي", { gulf: "Mohammadi", urdu: "Muhammadi" }],
  ["احمدي", "Ahmadi"],
  ["موسوي", { gulf: "Mousawi", persian: "Mousavi" }],
  ["جعفري", { gulf: "Jafari" }],
  ["عمران", "Imran"],
  ["خان", "Khan"],
  ["شاه", "Shah"],
  ["اقبال", "Iqbal"],
  ["نواز", "Nawaz"],
  ["السيد", { egypt: "El-Sayed", gulf: "Al-Sayed" }],
  ["سيد", "Sayed"],
  ["ابو", { egypt: "Abou", maghreb: "Abou", gulf: "Abu", levant: "Abu" }],
  ["بن", { maghreb: "Ben", gulf: "Bin" }],
  ["بنت", "Bint"],
  ["نور", { egypt: "Nour", gulf: "Noor", levant: "Nour", maghreb: "Nour" }],
  ["مريم", { egypt: "Mariam", maghreb: "Meriem", gulf: "Maryam" }],
  ["فاطمة", { egypt: "Fatma", maghreb: "Fatima", gulf: "Fatima", persian: "Fatemeh" }],
  ["عائشة", "Aisha"],
  ["خديجة", { egypt: "Khadiga", gulf: "Khadija" }],
  ["زينب", { egypt: "Zeinab", gulf: "Zainab" }],
  ["سارة", { egypt: "Sara", gulf: "Sarah", levant: "Sara" }],
  ["هدى", { egypt: "Hoda", gulf: "Huda" }],
  ["منى", { egypt: "Mona", gulf: "Muna", levant: "Mona" }],
  ["اية", "Aya"],
  ["اسراء", { egypt: "Esraa", gulf: "Israa" }],
  ["ياسمين", { egypt: "Yasmin", gulf: "Yasmeen", levant: "Yasmin" }],
  ["سلمى", "Salma"],
  ["ليلى", { egypt: "Laila", gulf: "Layla" }],
  ["رانيا", "Rania"],
  ["دينا", "Dina"],
  ["امل", "Amal"],
  ["هبة", { egypt: "Heba", gulf: "Hiba" }],
  ["ايمان", { egypt: "Eman", gulf: "Iman" }],
  ["نادية", "Nadia"],
  ["سمر", "Samar"],
  ["رحاب", "Rehab"],
  ["شيماء", { egypt: "Shaimaa", gulf: "Shaima" }],
  ["اسماء", { egypt: "Asmaa", gulf: "Asma" }],
  ["ريم", "Reem"],
  ["لينا", "Lina"],
  ["جنى", "Jana"],
  ["ملك", { gulf: "Malak", urdu: "Malik" }],
  ["روان", "Rawan"],
  ["دعاء", { egypt: "Doaa", gulf: "Duaa" }],
  ["نهى", { egypt: "Noha", gulf: "Nuha" }],
  ["عبير", "Abeer"],
  ["سعاد", { egypt: "Soad", maghreb: "Souad", gulf: "Suad" }],
  ["حنان", "Hanan"],
  ["لبنى", { egypt: "Lobna", gulf: "Lubna" }],
  ["غادة", "Ghada"],
  ["وفاء", { egypt: "Wafaa", gulf: "Wafa" }],
  ["نجلاء", { egypt: "Naglaa", gulf: "Najla" }],
  ["الله", "Lah"],
  ["الرحمن", "Rahman"],
  ["الرحيم", "Rahim"],
  ["العزيز", "Aziz"],
  ["الكريم", "Karim"],
  ["الحميد", "Hamid"],
  ["الفتاح", "Fattah"],
  ["المنعم", "Moneim"],
  ["الحليم", "Halim"],
  ["الناصر", "Nasser"],
  ["القادر", "Kader"],
  ["الملك", "Malik"],
  ["الغني", "Ghani"],
  ["اللطيف", "Latif"],
  ["المجيد", "Majid"],
  ["الوهاب", "Wahab"],
  ["السلام", "Salam"],
  ["الحكيم", "Hakim"],
  ["الباسط", "Basset"],
  ["الجليل", "Galil"],
  ["الرزاق", "Razek"],
  ["الستار", "Sattar"],
]);

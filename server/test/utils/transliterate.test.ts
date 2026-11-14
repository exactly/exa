// cspell:ignoreRegExp /[\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF\uAC00-\uD7AF]+/g
// cspell:ignoreRegExp /"[A-Z][a-z]+([- ][A-Z][a-z]+)*"/g
// cspell:ignore José Müller Łukasz
import { describe, expect, it } from "vitest";

import { latin, transliterateName } from "../../utils/transliterate";

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
      { text: "رضا", country: "IR", expected: "Rida" },
      { text: "پروین", country: "IR", expected: "Parvin" },
      { text: "ویدا", country: "IR", expected: "Vida" },
      { text: "ٹیپو", country: "PK", expected: "Tipu" },
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
});

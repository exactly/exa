// cspell:ignoreRegExp /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]+/g
// cspell:ignore Aleksandrovskii ELMASRY João José Kahra Konstantinopolskii Konstantinopolskiialeksandr Masry Müller Petrov Qahtani Shaka Shamri Shar Tahrir Xiaoming Zhang Ｊｏｈｎ
import { describe, expect, it } from "vitest";

import { cardName, latinAddress, latinName, normalizePostalCode } from "../../utils/identity";

describe("identity", () => {
  describe("name", () => {
    it("keeps a latin name", () => {
      expect(latinName({ first: "José", last: "Müller" }, "DE")).toBeUndefined();
    });

    it("prefers the latin name from the document", () => {
      expect(latinName({ first: "محمد", last: "المصري" }, "EG", { first: "MOHAMED", last: "ELMASRY" })).toStrictEqual({
        first: "MOHAMED",
        last: "ELMASRY",
      });
    });

    it("romanizes without a document", () => {
      expect(latinName({ first: "John", last: "张" }, "CN", null)).toStrictEqual({ first: "John", last: "Zhang" });
    });

    it("keeps a latin last name", () => {
      expect(latinName({ first: "小明", last: "Smith" }, "CN")).toStrictEqual({ first: "Xiaoming", last: "Smith" });
    });

    it.each([
      { part: "first", first: "\u{1F642}", last: "Smith" },
      { part: "last", first: "John", last: "\u{1F642}" },
    ])("skips a $part name it cannot romanize", ({ first, last }) => {
      expect(latinName({ first, last }, "US")).toBeUndefined();
    });
  });

  describe("address", () => {
    const address = { street1: "شارع التحرير ١٢", street2: null, city: "القاهرة", postalCode: "١١٥١١", country: "EGY" };

    it("keeps a latin address", () => {
      expect(
        latinAddress({ ...address, street1: "Rua São João, 12", city: "São Paulo", postalCode: "01000" }, "BR"),
      ).toBeUndefined();
    });

    it("romanizes every field and keeps the rest", () => {
      expect(latinAddress(address, "EG")).toStrictEqual({
        street1: "Shar El-Tahrir 12",
        street2: null,
        city: "El-Kahra",
        postalCode: "11511",
        country: "EGY",
      });
    });

    it("romanizes the second street line", () => {
      expect(latinAddress({ ...address, street2: "شقة ٣" }, "EG")?.street2).toBe("Shaka 3");
    });

    it.each([
      { name: "street", street1: "\u{1F3E0}", street2: null, city: "Porto" },
      { name: "second street line", street1: "Rua Augusta", street2: "\u{1F3E0}", city: "Porto" },
      { name: "city", street1: "Rua Augusta", street2: null, city: "\u{1F3E0}" },
    ])("skips an address whose $name cannot be romanized", ({ street1, street2, city }) => {
      expect(latinAddress({ ...address, street1, street2, city, postalCode: "1000-001" }, "PT")).toBeUndefined();
    });

    it("keeps the postal code it cannot romanize", () => {
      expect(latinAddress({ ...address, postalCode: "\u{11DE0}1511" }, "EG")?.postalCode).toBe("\u{11DE0}1511");
    });

    it("skips a latin address with a non-ascii postal code", () => {
      expect(
        latinAddress({ ...address, street1: "12 Tahrir St", city: "Cairo", postalCode: "\u200F١١٥١١" }, "EG"),
      ).toBeUndefined();
    });
  });

  describe("postal code", () => {
    it.each([
      ["١١٥١١", "11511"],
      ["۱۲۳۴۵", "12345"],
      ["１２３４５", "12345"],
      ["115 11", "11511"],
      [" 11511 ", "11511"],
      ["00-950", "00-950"],
      ["SW1A 1AA", "SW1A 1AA"],
      ["\u200F١١٥١١\u200E", "11511"],
      ["00\u2013950", "00-950"],
      ["00 - 950", "00-950"],
      ["1000 \u2013\u00A0001", "1000-001"],
      ["1000\u2011001", "1000-001"],
      ["115\u00A011", "11511"],
      ["SW1A\u00A01AA", "SW1A 1AA"],
      ["\u{11DE0}1511", "\u{11DE0}1511"],
    ])("normalizes %s", (code, expected) => {
      expect(normalizePostalCode(code)).toBe(expected);
    });
  });

  describe("card", () => {
    it.each([
      { first: "John", last: "Doe", country: "US", displayName: undefined },
      { first: "محمد", last: "المصري", country: "EG", displayName: "Mohamed El-Masry" },
      { first: "John", last: "张", country: "CN", displayName: "John Zhang" },
      { first: "小明", last: "Smith", country: "CN", displayName: "Xiaoming Smith" },
      { first: "Ｊｏｈｎ", last: "张", country: "CN", displayName: "John Zhang" },
      { first: "Ｊｏｈｎ", last: "Smith", country: "US", displayName: "John Smith" },
      {
        first: "Александр",
        last: "Александровский-Петров",
        country: "RU",
        displayName: "A. Aleksandrovskii-Petrov",
      },
      {
        first: "عبد الرحمن",
        last: "الشمري القحطاني الدوسري",
        country: "SA",
        displayName: "A. Al-Shamri Al-Qahtani",
      },
      {
        first: "Константин",
        last: "Константинопольский-Александровский",
        country: "RU",
        displayName: "K. Konstantinopolskii",
      },
      {
        first: "Константин",
        last: "Константинопольскийалександровский",
        country: "RU",
        displayName: "K. Konstantinopolskiialeksandr",
      },
    ])("fits $first $last", ({ first, last, country, displayName }) => {
      expect(cardName({ first, last }, country)).toBe(displayName);
    });
  });
});

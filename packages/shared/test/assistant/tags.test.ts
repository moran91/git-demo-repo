import { describe, expect, it } from 'vitest';
import { autoTags, tokenize, wordForms } from '../../src/index.js';

describe('tokenize', () => {
  it('splits digits from Hebrew/Arabic letters, keeps Arabizi, separates ₪, converts Arabic-Indic digits', () => {
    expect(tokenize('ל-4')).toEqual(['ל', '4']);
    expect(tokenize('ל4')).toEqual(['ל', '4']);
    expect(tokenize('لـ٤')).toEqual(['ل', '4']);
    expect(tokenize('150₪')).toEqual(['150', '₪']);
    expect(tokenize('shi 7ar')).toEqual(['shi', '7ar']);
    expect(tokenize('50 ש"ח')).toEqual(['50', 'שח']);
  });
  it('word forms drop one Hebrew or Arabic prefix', () => {
    expect(wordForms('הפיצה')).toContain('פיצה');
    expect(wordForms('לשניימ')).toContain('שניימ');
    expect(wordForms('والبيتزا')).toContain('بيتزا');
    expect(wordForms('pizza')).toEqual(['pizza']);
  });
});

describe('autoTags', () => {
  it('reads type, serves and taste from a Hebrew name', () => {
    const r = autoTags({ name: { he: 'פיצה משפחתית חריפה' } });
    expect(r.dishType).toBe('pizza');
    expect(r.serves).toBe(4);
    expect(r.tags).toEqual(expect.arrayContaining(['spicy', 'vegetarian', 'sharing']));
  });
  it('meat on a pizza removes vegetarian', () => {
    const r = autoTags({ name: { he: 'פיצה פפרוני' } });
    expect(r.tags).toContain('meat');
    expect(r.tags).not.toContain('vegetarian');
    expect(r.serves).toBe(2);
  });
  it('reads Arabic', () => {
    const r = autoTags({ name: { ar: 'شاورما دجاج حارة' } });
    expect(r.dishType).toBe('shawarma');
    expect(r.tags).toEqual(expect.arrayContaining(['chicken', 'spicy']));
    expect(r.tags).not.toContain('vegetarian');
  });
  it('a chicken burger is not meat', () => {
    const r = autoTags({ name: { en: 'Chicken burger' } });
    expect(r.dishType).toBe('burger');
    expect(r.tags).toContain('chicken');
    expect(r.tags).not.toContain('meat');
  });
  it('iced coffee is a cold drink, not a hot one', () => {
    const r = autoTags({ name: { he: 'אייס קפה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
    expect(r.tags).not.toContain('hot_drink');
  });
  it('coffee is a hot drink', () => {
    expect(autoTags({ name: { he: 'קפה הפוך' } }).tags).toContain('hot_drink');
  });
  it('the category names drinks', () => {
    const r = autoTags({ name: { he: 'קוקה קולה' }, categoryName: { he: 'שתייה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
  });
  it('serves: tray 6, pair 2, explicit number, slice 1', () => {
    expect(autoTags({ name: { he: 'מגש סושי 40 יחידות' } })).toMatchObject({ dishType: 'sushi', serves: 6 });
    expect(autoTags({ name: { he: 'ארוחה זוגית' } }).serves).toBe(2);
    expect(autoTags({ name: { en: 'Family meal for 5 people' } }).serves).toBe(5);
    expect(autoTags({ name: { he: 'משולש פיצה' } }).serves).toBe(1);
  });
  it('desserts are sweet; a cold salad is not a drink', () => {
    expect(autoTags({ name: { he: 'כנאפה' } })).toMatchObject({ dishType: 'desserts', tags: expect.arrayContaining(['sweet']) });
    const salad = autoTags({ name: { he: 'סלט קר' } });
    expect(salad.dishType).toBe('salads');
    expect(salad.tags).not.toContain('cold_drink');
    expect(salad.tags).toContain('vegetarian');
  });
  it('breakfast pastries and kids', () => {
    expect(autoTags({ name: { ar: 'منقوشة زعتر' } })).toMatchObject({ dishType: 'pastries', tags: expect.arrayContaining(['breakfast', 'vegetarian']) });
    expect(autoTags({ name: { en: 'Kids meal nuggets' } }).tags).toEqual(expect.arrayContaining(['kids', 'chicken']));
  });
  it('an unknown dish gets no type, serves 1', () => {
    expect(autoTags({ name: { he: 'מנת השף' } })).toEqual({ tags: [], serves: 1 });
  });
  it('a stem of two letters or less keeps its prefix (בקר is beef, not cold)', () => {
    const r = autoTags({ name: { he: 'קציצות בקר ברוטב' } });
    expect(r.tags).toContain('meat');
    expect(r.tags).not.toContain('cold_drink');
    expect(r.tags).not.toContain('hot_drink');
    expect(autoTags({ name: { he: 'מרק בקר' } }).tags).not.toContain('cold_drink');
    expect(autoTags({ name: { he: 'שתה' } }).tags).not.toContain('hot_drink');
    expect(wordForms('בקר')).toEqual(['בקר']);
    expect(wordForms('שתה')).toEqual(['שתה']);
  });
  it('a real drink word on a meat or fish dish does not make it a drink', () => {
    const beef = autoTags({ name: { en: 'Beef cold cuts' } });
    expect(beef.tags).toContain('meat');
    expect(beef.tags).not.toContain('cold_drink');
    const tuna = autoTags({ name: { en: 'Tuna iced plate' } });
    expect(tuna.tags).toContain('fish');
    expect(tuna.tags).not.toContain('cold_drink');
  });
  it('כפול (double) is not hummus via the כ prefix', () => {
    expect(autoTags({ name: { he: 'סלט כפול' } }).dishType).toBe('salads');
    expect(autoTags({ name: { he: 'שניצל כפול' } }).dishType).not.toBe('hummus');
    expect(autoTags({ name: { he: 'המבורגר כפול' } }).dishType).toBe('burger');
  });
  it('I3. common meat dishes are meat: cheeseburger, laffa shawarma, mansaf, meorav, skewers, kebab', () => {
    for (const name of [{ he: 'צ׳יזבורגר' }, { he: 'ציזבורגר' }, { he: "צ'יזבורגר" }, { en: 'Cheeseburger' }, { ar: 'تشيز برغر' }]) {
      const r = autoTags({ name });
      expect(r.dishType, JSON.stringify(name)).toBe('burger');
      expect(r.tags, JSON.stringify(name)).toContain('meat');
      expect(r.tags, JSON.stringify(name)).not.toContain('vegetarian');
    }
    for (const name of [{ he: 'שווארמה בלאפה' }, { he: 'מנסף' }, { ar: 'منسف' }, { en: 'Mansaf' }, { he: 'מעורב ירושלמי' }, { he: 'שיפודים' }, { he: 'שיפוד' }, { ar: 'شيش' }, { ar: 'كباب' }, { he: 'קבב' }, { en: 'Kebab' }, { en: 'Shawarma laffa' }, { ar: 'عرايس' }]) {
      expect(autoTags({ name }).tags, JSON.stringify(name)).toContain('meat');
    }
  });
  it('I3. a skewer or a mixed salad is not meat by that word alone', () => {
    for (const name of [{ he: 'שיפודי פרגית' }, { ar: 'شيش طاووق' }, { ar: 'شقف دجاج' }, { he: 'סלט מעורב' }]) {
      expect(autoTags({ name }).tags, JSON.stringify(name)).not.toContain('meat');
    }
  });
  it('I3. burger and shawarma are meat unless chicken, fish, vegetarian or vegan', () => {
    expect(autoTags({ name: { he: 'שווארמה' } }).tags).toContain('meat');
    expect(autoTags({ name: { he: 'המבורגר' } }).tags).toContain('meat');
    for (const name of [{ he: 'שווארמה עוף' }, { en: 'Chicken burger' }, { he: 'בורגר טבעוני' }, { en: 'Veggie burger' }, { he: 'בורגר צמחוני' }, { en: 'Fish burger' }, { ar: 'شاورما دجاج' }]) {
      expect(autoTags({ name }).tags, JSON.stringify(name)).not.toContain('meat');
    }
  });
  it('I6. a big drink serves more than one: about 0.4 L a person, capped', () => {
    expect(autoTags({ name: { he: 'קולה 1.5 ליטר' } })).toMatchObject({ dishType: 'drinks', serves: 4 });
    expect(autoTags({ name: { en: 'Coca-Cola 1.5L' } }).serves).toBe(4);
    expect(autoTags({ name: { ar: 'كولا 1.5 لتر' } }).serves).toBe(4);
    expect(autoTags({ name: { he: 'ספרייט ליטר וחצי' } }).serves).toBe(4);
    expect(autoTags({ name: { he: 'קולה בקבוק גדול' } }).serves).toBe(4);
    expect(autoTags({ name: { he: 'קולה 2 ליטר' } }).serves).toBe(5);
    expect(autoTags({ name: { en: 'Pepsi family size' } }).serves).toBe(4);
    expect(autoTags({ name: { he: 'פחית קולה 330 מ״ל' } }).serves).toBe(1);
    expect(autoTags({ name: { he: 'מים חצי ליטר' } }).serves).toBe(1);
    expect(autoTags({ name: { he: 'קולה' } }).serves).toBe(1);
    // A litre on a dish that is not a drink says nothing about people; a big bottle is not a sharing platter.
    expect(autoTags({ name: { he: 'קולה 1.5 ליטר' } }).tags).not.toContain('sharing');
  });
  describe('dry-run tagging mistakes (2026-10-04)', () => {
    const tagsOf = (name: object, categoryName?: object) => autoTags({ name, ...(categoryName ? { categoryName } : {}) }).tags;

    it('the dry-run rows, with their live descriptions and menu sections', () => {
      const run = (he: string, description: string, category: string) => autoTags({ name: { he }, description: { he: description }, categoryName: { he: category } });
      const steak = run('סטייק חלומי', "5 יח' סטייק חלומי", 'סלט');
      expect(steak.tags).toEqual(expect.arrayContaining(['vegetarian', 'cheese']));
      expect(steak.tags).not.toContain('meat');
      const wok = run('מוקפץ אסייתי צמחוני', 'נודלס מוקפצים ברוטב אסייתי עשיר, יחד עם ירקות טריים. בחירה קלילה, מושלמת למי שמחפש חוויה אסייתית בלי בשר – ועדיין עם הרבה נשמה', 'מנות עיקריות');
      expect(wok.tags).toContain('vegetarian');
      expect(wok.tags).not.toContain('meat');
      const waffle = run('שיפוד וופל', 'שיפוד וופל', 'קינוחים');
      expect(waffle.dishType).toBe('desserts');
      expect(waffle.tags).toContain('sweet');
      expect(waffle.tags).not.toContain('meat');
      const turkey = run('בגט/לחמניה הודו', 'בגט/לחמניה הודו', 'שווארמה');
      expect(turkey.tags).toContain('chicken');
      expect(turkey.tags).not.toContain('meat');
      for (const he of ["צ'קן טוסט", 'צ׳יקן טוסט']) {
        const toast = run(he, `${he}, עם מיונז וחמוצים`, 'בורגר');
        expect(toast.tags, he).toContain('chicken');
        expect(toast.tags, he).not.toContain('meat');
      }
      const pastrami = run('כריך פסטרמה', 'כריך פסטרמה', 'טוסטים וכריכים');
      expect(pastrami.tags).toContain('meat');
    });
    it('1. vegetarian or vegan beats any meat word', () => {
      for (const name of [{ he: 'מוקפץ אסייתי צמחוני' }, { he: 'סטייק כרובית צמחוני' }, { en: 'Vegan kebab' }, { ar: 'كباب نباتي' }, { he: 'קציצות טבעוניות' }]) {
        const tags = tagsOf(name);
        expect(tags, JSON.stringify(name)).not.toContain('meat');
        expect(tags, JSON.stringify(name)).toContain('vegetarian');
      }
    });
    it('1. halloumi makes a dish vegetarian when nothing meaty is there: סטייק חלומי', () => {
      for (const name of [{ he: 'סטייק חלומי' }, { en: 'Halloumi steak' }, { ar: 'ستيك حلوم' }]) {
        const tags = tagsOf(name);
        expect(tags, JSON.stringify(name)).toEqual(expect.arrayContaining(['vegetarian', 'cheese']));
        expect(tags, JSON.stringify(name)).not.toContain('meat');
      }
    });
    it('1. halloumi does not make meat vegetarian', () => {
      for (const name of [{ he: 'המבורגר בקר עם חלומי' }, { he: 'המבורגר חלומי' }, { en: 'Halloumi and beef skewer' }, { en: 'Chicken halloumi sandwich' }]) {
        expect(tagsOf(name), JSON.stringify(name)).not.toContain('vegetarian');
      }
      expect(tagsOf({ he: 'המבורגר בקר עם חלומי' })).toContain('meat');
      expect(tagsOf({ he: 'המבורגר חלומי' })).toContain('meat');
      expect(tagsOf({ en: 'Halloumi and beef skewer' })).toContain('meat');
    });
    it('2. a dessert is never meat: שיפוד וופל', () => {
      const r = autoTags({ name: { he: 'שיפוד וופל' }, categoryName: { he: 'קינוחים' } });
      expect(r.dishType).toBe('desserts');
      expect(r.tags).toContain('sweet');
      expect(r.tags).not.toContain('meat');
      const bare = tagsOf({ he: 'שיפוד וופל' });
      expect(bare).toContain('sweet');
      expect(bare).not.toContain('meat');
      expect(tagsOf({ en: 'Chocolate steak' })).not.toContain('meat');
    });
    it('3. turkey is poultry: chicken, not meat', () => {
      for (const name of [{ he: 'בגט הודו' }, { he: 'לחמניה הודו' }, { he: 'בגט/לחמניה הודו' }, { en: 'Turkey baguette' }, { ar: 'ساندويش ديك رومي' }, { ar: 'شاورما حبش' }, { he: 'שווארמה הודו' }, { en: 'Turkey shawarma' }, { ar: 'شاورما ديك رومي' }, { he: 'פסטרמה הודו' }]) {
        const tags = tagsOf(name);
        expect(tags, JSON.stringify(name)).toContain('chicken');
        expect(tags, JSON.stringify(name)).not.toContain('meat');
      }
    });
    it('3. turkey with real beef stays meat as well', () => {
      expect(tagsOf({ he: 'סנדוויץ הודו ובקר' })).toEqual(expect.arrayContaining(['chicken', 'meat']));
    });
    it('4. צ׳יקן is chicken', () => {
      for (const name of [{ he: "צ'קן טוסט" }, { he: 'צ׳יקן טוסט' }, { he: "צ'יקן טוסט" }, { he: 'צ׳קן טוסט' }, { he: 'צ׳יקן בורגר' }]) {
        const tags = tagsOf(name);
        expect(tags, JSON.stringify(name)).toContain('chicken');
        expect(tags, JSON.stringify(name)).not.toContain('meat');
      }
    });
    it('4. pastrami is meat', () => {
      for (const name of [{ he: 'כריך פסטרמה' }, { he: 'כריך פסטרמות' }, { he: 'פסטרמה' }, { en: 'Pastrami sandwich' }, { ar: 'ساندويش بسطرمة' }]) {
        expect(tagsOf(name), JSON.stringify(name)).toContain('meat');
      }
    });
    it('5. vegetable or halloumi skewers are not meat', () => {
      for (const name of [{ he: 'שיפודי ירקות' }, { en: 'Vegetable skewers' }, { en: 'Halloumi skewers' }, { he: 'שיפודי חלומי' }, { ar: 'شيش خضار' }, { he: 'שיפוד גבינה' }, { en: 'Cheese skewer' }]) {
        expect(tagsOf(name), JSON.stringify(name)).not.toContain('meat');
      }
      expect(tagsOf({ en: 'Halloumi skewers' })).toEqual(expect.arrayContaining(['vegetarian', 'cheese']));
      expect(tagsOf({ he: 'שיפודי חלומי' })).toContain('vegetarian');
    });
    it('5. a plain skewer, or a skewer with real meat, is still meat', () => {
      for (const name of [{ he: 'שיפוד' }, { he: 'שיפודי בקר' }, { en: 'Skewers' }, { en: 'Lamb skewers with vegetables' }, { he: 'שיפודי כבש עם ירקות' }, { ar: 'شيش لحم' }]) {
        expect(tagsOf(name), JSON.stringify(name)).toContain('meat');
      }
    });
    it('6. a cold or hot drink never gets sharing, typed or not', () => {
      for (const name of [{ en: 'Red Bull 1.5L' }, { en: 'Slush 1.5L' }, { he: 'רד בול 1.5 ליטר' }, { he: 'קולה 1.5 ליטר' }, { en: 'Family coffee 2L' }]) {
        const r = autoTags({ name });
        expect(r.tags, JSON.stringify(name)).not.toContain('sharing');
      }
      const redBull = autoTags({ name: { en: 'Red Bull 1.5L' } });
      expect(redBull.tags).toContain('cold_drink');
      expect(redBull.serves).toBe(4);
      // A real platter still shares.
      expect(autoTags({ name: { he: 'מגש סושי 40 יחידות' } }).tags).toContain('sharing');
    });
  });
});

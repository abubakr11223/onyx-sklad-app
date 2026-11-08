// ТЗ №20 H (§9.3) — язык публичных страниц: русский и узбекский (латиница).
//
// Только публичные страницы: карточка по QR /k/<код>, каталог /katalog и
// подборка /podborka/<код> (часть I). Интерфейс сотрудников НЕ переводится:
// у них всё по-русски, как раньше. Названия камней не переводятся — «как в системе».
//
// Выбор языка: cookie (переключатель вверху страницы) → Accept-Language
// браузера → русский. Модуль чистый: без next/headers, без БД — страница сама
// передаёт сюда заголовок и cookie, а тесты проверяют правила без сервера.

export type PublicLocale = "ru" | "uz";

export const PUBLIC_LOCALES: readonly PublicLocale[] = ["ru", "uz"] as const;
export const DEFAULT_PUBLIC_LOCALE: PublicLocale = "ru";

/** Cookie с выбором языка (год; httpOnly не нужен — секрета нет). */
export const PUBLIC_LOCALE_COOKIE = "onyx_lang";
export const PUBLIC_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Подпись кнопки переключателя — на «своём» языке. */
export const PUBLIC_LOCALE_LABEL: Record<PublicLocale, string> = {
  ru: "Русский",
  uz: "O‘zbekcha",
};

export function isPublicLocale(v: unknown): v is PublicLocale {
  return v === "ru" || v === "uz";
}

/**
 * Язык браузера из Accept-Language. Учитывает q-веса; из списка берётся
 * самый приоритетный ru* или uz* (uz, uz-Latn, uz-UZ — узбекский). Ничего
 * подходящего (en, пустой заголовок) — русский: основная аудитория шоу-рума.
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): PublicLocale {
  if (!header) return DEFAULT_PUBLIC_LOCALE;
  let best: { locale: PublicLocale; q: number; idx: number } | null = null;
  const parts = header.split(",");
  for (let idx = 0; idx < parts.length; idx++) {
    const [tagRaw, ...params] = parts[idx].trim().split(";");
    const tag = tagRaw.trim().toLowerCase();
    let locale: PublicLocale | null = null;
    if (tag === "uz" || tag.startsWith("uz-")) locale = "uz";
    else if (tag === "ru" || tag.startsWith("ru-")) locale = "ru";
    if (!locale) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    // Равный вес — побеждает тот, что раньше в списке (порядок браузера).
    if (!best || q > best.q) best = { locale, q, idx };
  }
  return best?.locale ?? DEFAULT_PUBLIC_LOCALE;
}

/** Итоговый язык страницы: явный выбор (cookie) сильнее браузера. */
export function resolvePublicLocale(args: {
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): PublicLocale {
  if (isPublicLocale(args.cookie)) return args.cookie;
  return localeFromAcceptLanguage(args.acceptLanguage);
}

// ───────────────────────── Словарь ─────────────────────────

const RU = {
  brand: "Onyx · натуральный камень",
  language: "Язык",
  notFoundTitle: "Камень не найден",
  notFoundBody:
    "Проверьте код на этикетке (формат ONX-XXXXX) или спросите менеджера в шоу-руме.",
  rockType: "Порода",
  color: "Цвет",
  slabSize: "Размер плиты",
  thickness: "Толщина",
  code: "Код",
  availability: "Наличие",
  inStock: "В наличии",
  outOfStock: "Нет в наличии",
  inShowroom: "В шоу-руме",
  outOfStockHint:
    "Сейчас этого камня нет на складе. Оставьте заявку — менеджер предложит похожий камень или привезёт под заказ.",
  showroomHint: "Этот камень выставлен в шоу-руме — его можно посмотреть вживую.",
  noPhotos: "Фото камня скоро появятся",
  photoAlt: "Фото камня",
  kindPattern: "Узор",
  kindSlab: "Плита",
  kindBatch: "Партия",
  kindPiece: "Бой / остаток",
  freeNow: "Свободно",
  slabsShort: "пл.",
  m2: "м²",
  leaveRequest: "Оставить заявку",
  leaveRequestHint: "Менеджер перезвонит и расскажет о камне, наличии и цене.",
  volumeRequest: "Заявка на объём",
  volumeRequestHint: "Укажите объём — менеджер подберёт камень под проект.",
  name: "Ваше имя",
  phone: "Телефон",
  comment: "Комментарий",
  commentPlaceholder: "Размер, количество, сроки",
  submit: "Отправить заявку",
  sending: "Отправляем…",
  leadOk: "Заявка отправлена. Менеджер свяжется с вами в ближайшее время.",
  errName: "Укажите имя.",
  errPhone: "Укажите телефон, например +998 90 123 45 67.",
  errPhoneInvalid: "Телефон выглядит неполным — проверьте номер.",
  errDuplicate:
    "Вы уже оставили заявку на этот камень сегодня — менеджер свяжется с вами.",
  errRate: "Слишком много заявок с этого устройства. Попробуйте через час.",
  errFailed: "Не удалось отправить заявку. Попробуйте ещё раз.",
  // ── ТЗ №20 I — каталог, похожие камни, подборка ──
  catalogTitle: "Каталог камня",
  catalogSubtitle: "Натуральный камень на складе Onyx. Нажмите на камень — откроется карточка.",
  catalogLink: "Весь каталог",
  searchLabel: "Название или код",
  searchPlaceholder: "Например, оникс или ONX-7K3QD",
  filterAny: "Все",
  filterSize: "Нужный размер, см",
  lengthPlaceholder: "Длина",
  widthPlaceholder: "Ширина",
  sizeHint: "С запасом на рез 2 см, заготовку можно повернуть.",
  sizeNeedBoth: "Для подбора по размеру укажите и длину, и ширину.",
  applyFilters: "Показать",
  resetFilters: "Сбросить",
  catalogFound: "Найдено камней",
  catalogEmpty: "По этим условиям камня нет. Измените фильтры или оставьте заявку — подберём.",
  catalogTruncated: "Показаны первые камни — уточните фильтры.",
  slabSizes: "Размеры плит, см",
  thicknesses: "Толщина, см",
  cm: "см",
  outOfStockOrder: "Нет в наличии, под заказ",
  openCard: "Подробнее",
  similarTitle: "Похожие камни",
  collectionEyebrow: "Подборка камней",
  collectionHint: "Менеджер подобрал эти камни для вас. Отметьте «Нравится» или оставьте заявку на камень.",
  collectionNotFoundTitle: "Подборка не найдена",
  collectionNotFoundBody: "Проверьте ссылку или спросите менеджера.",
  collectionClosedTitle: "Подборка закрыта",
  collectionClosedBody: "Подборка закрыта, свяжитесь с менеджером.",
  collectionEmpty: "В подборке пока нет камней.",
  managerComment: "Комментарий менеджера",
  like: "Нравится",
  liked: "Вам нравится",
  likeUndo: "Снять отметку",
  requestThis: "Оставить заявку на этот камень",
  copyLink: "Скопировать ссылку",
  linkCopied: "Ссылка скопирована",
  share: "Поделиться",
  // ТЗ №20 J — интерьеры и 3D.
  interiorTitle: "В интерьере",
  show3d: "Показать в интерьере",
  show3dHint: "Камень в 3D: кухня, ванная, холл — в натуральную величину.",
  downloadTexture: "Скачать текстуру для 3D",
  downloadTextureHint: "ZIP: оригинал фото плиты, превью 2048 px и info.txt с размером плиты.",
  scene3dKitchen: "Кухня",
  scene3dBath: "Ванная",
  scene3dHall: "Холл",
  scene3dLoading: "Загружаем 3D…",
  scene3dNoWebgl: "Этот браузер не умеет показывать 3D. Откройте ссылку в Chrome или Safari.",
  scene3dHint: "Вращайте пальцем или мышью, щипок или колесо — приблизить.",
  scene3dStones: "Камни",
  scene3dEmpty: "Для этих камней ещё нет текстуры для 3D.",
  scene3dSlab: "Плита",
  back: "Назад",
  showroom3dTitle: "Шоу-рум в 3D",
  fullscreen: "Во весь экран",
} as const;

export type PublicDict = { [K in keyof typeof RU]: string };

const UZ: PublicDict = {
  brand: "Onyx · tabiiy tosh",
  language: "Til",
  notFoundTitle: "Tosh topilmadi",
  notFoundBody:
    "Yorliqdagi kodni tekshiring (ONX-XXXXX ko‘rinishida) yoki shou-rumdagi menejerdan so‘rang.",
  rockType: "Tosh turi",
  color: "Rangi",
  slabSize: "Plita o‘lchami",
  thickness: "Qalinligi",
  code: "Kod",
  availability: "Mavjudligi",
  inStock: "Mavjud",
  outOfStock: "Mavjud emas",
  inShowroom: "Shou-rumda",
  outOfStockHint:
    "Hozir bu tosh omborda yo‘q. Ariza qoldiring — menejer o‘xshash tosh taklif qiladi yoki buyurtma asosida olib keladi.",
  showroomHint: "Bu tosh shou-rumda turibdi — uni jonli ko‘rish mumkin.",
  noPhotos: "Tosh suratlari tez orada qo‘shiladi",
  photoAlt: "Tosh surati",
  kindPattern: "Naqsh",
  kindSlab: "Plita",
  kindBatch: "Partiya",
  kindPiece: "Singan / qoldiq",
  freeNow: "Bo‘sh",
  slabsShort: "dona",
  m2: "m²",
  leaveRequest: "Ariza qoldirish",
  leaveRequestHint: "Menejer qo‘ng‘iroq qilib, tosh, mavjudligi va narxi haqida aytib beradi.",
  volumeRequest: "Hajmga ariza",
  volumeRequestHint: "Hajmni kiriting — menejer loyihaga mos tosh tanlab beradi.",
  name: "Ismingiz",
  phone: "Telefon",
  comment: "Izoh",
  commentPlaceholder: "O‘lcham, miqdor, muddat",
  submit: "Arizani yuborish",
  sending: "Yuborilmoqda…",
  leadOk: "Ariza yuborildi. Menejer tez orada siz bilan bog‘lanadi.",
  errName: "Ismingizni kiriting.",
  errPhone: "Telefon raqamini kiriting, masalan +998 90 123 45 67.",
  errPhoneInvalid: "Telefon raqami to‘liq emas — tekshirib ko‘ring.",
  errDuplicate:
    "Bugun bu tosh uchun ariza qoldirgansiz — menejer siz bilan bog‘lanadi.",
  errRate: "Bu qurilmadan arizalar juda ko‘p. Bir soatdan keyin urinib ko‘ring.",
  errFailed: "Arizani yuborib bo‘lmadi. Qaytadan urinib ko‘ring.",
  catalogTitle: "Tosh katalogi",
  catalogSubtitle: "Onyx omboridagi tabiiy tosh. Toshni bosing — kartochkasi ochiladi.",
  catalogLink: "Butun katalog",
  searchLabel: "Nomi yoki kodi",
  searchPlaceholder: "Masalan, oniks yoki ONX-7K3QD",
  filterAny: "Barchasi",
  filterSize: "Kerakli o‘lcham, sm",
  lengthPlaceholder: "Uzunligi",
  widthPlaceholder: "Eni",
  sizeHint: "Kesish uchun 2 sm zaxira bilan, zagotovkani burish mumkin.",
  sizeNeedBoth: "O‘lcham bo‘yicha tanlash uchun uzunlik va enini kiriting.",
  applyFilters: "Ko‘rsatish",
  resetFilters: "Tozalash",
  catalogFound: "Topilgan toshlar",
  catalogEmpty: "Bu shartlar bo‘yicha tosh yo‘q. Filtrlarni o‘zgartiring yoki ariza qoldiring — tanlab beramiz.",
  catalogTruncated: "Birinchi toshlar ko‘rsatildi — filtrlarni aniqlashtiring.",
  slabSizes: "Plita o‘lchamlari, sm",
  thicknesses: "Qalinligi, sm",
  cm: "sm",
  outOfStockOrder: "Mavjud emas, buyurtma asosida",
  openCard: "Batafsil",
  similarTitle: "O‘xshash toshlar",
  collectionEyebrow: "Toshlar to‘plami",
  collectionHint: "Menejer bu toshlarni siz uchun tanladi. «Yoqdi» deb belgilang yoki tosh uchun ariza qoldiring.",
  collectionNotFoundTitle: "To‘plam topilmadi",
  collectionNotFoundBody: "Havolani tekshiring yoki menejerdan so‘rang.",
  collectionClosedTitle: "To‘plam yopilgan",
  collectionClosedBody: "To‘plam yopilgan, menejer bilan bog‘laning.",
  collectionEmpty: "To‘plamda hozircha tosh yo‘q.",
  managerComment: "Menejer izohi",
  like: "Yoqdi",
  liked: "Sizga yoqdi",
  likeUndo: "Belgini olib tashlash",
  requestThis: "Shu tosh uchun ariza qoldirish",
  copyLink: "Havolani nusxalash",
  linkCopied: "Havola nusxalandi",
  share: "Ulashish",
  interiorTitle: "Interyerda",
  show3d: "Interyerda ko‘rsatish",
  show3dHint: "Tosh 3D’da: oshxona, vannaxona, xoll — haqiqiy o‘lchamda.",
  downloadTexture: "3D uchun teksturani yuklab olish",
  downloadTextureHint: "ZIP: plita suratining asli, 2048 px nusxasi va plita o‘lchami yozilgan info.txt.",
  scene3dKitchen: "Oshxona",
  scene3dBath: "Vannaxona",
  scene3dHall: "Xoll",
  scene3dLoading: "3D yuklanmoqda…",
  scene3dNoWebgl: "Bu brauzer 3D ko‘rsata olmaydi. Havolani Chrome yoki Safari’da oching.",
  scene3dHint: "Barmoq yoki sichqoncha bilan aylantiring, chimdish yoki g‘ildirak — yaqinlashtirish.",
  scene3dStones: "Toshlar",
  scene3dEmpty: "Bu toshlar uchun hali 3D tekstura yo‘q.",
  scene3dSlab: "Plita",
  back: "Orqaga",
  showroom3dTitle: "Shou-rum 3D’da",
  fullscreen: "To‘liq ekran",
};

const DICTS: Record<PublicLocale, PublicDict> = { ru: RU, uz: UZ };

/** Словарь языка (неизвестный — русский). */
export function publicDict(locale: PublicLocale): PublicDict {
  return DICTS[locale] ?? RU;
}

/** Атрибут <html lang> / hreflang. uz — латиница. */
export function htmlLangOf(locale: PublicLocale): string {
  return locale === "uz" ? "uz-Latn" : "ru";
}

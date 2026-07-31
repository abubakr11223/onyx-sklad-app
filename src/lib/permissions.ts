// R1 — Rol-tizimi: SOF ruxsat-dvigateli (TZ §3 «Роли и права»).
// DB importlari YO'Q, next importlari YO'Q — bu modul faqat toza lookup:
// rol + «закупку видит ли» bayrog'idan Capabilities matritsasini quradi.
// inventory.ts / photos.ts uslubida: eksport tiplar + sof funksiyalar,
// side-effektsiz (new Date() ham yo'q), alohida unit-testlanadi.
//
// MUHIM: bu R1 faqat DVIGATEL. Hech qanday majburlash / UI yashirish YO'Q —
// u R2–R4 da capabilitiesFor() natijasini o'qib qo'llaydi. Shu tufayli R1
// additiv va regresiyasiz.

/**
 * Rolning lokal string-union nusxasi. Prisma'ning `Role` enum'ini ATAYLAB
 * import qilmaymiz — shunda modul DB'siz qoladi va izolyatsiyada testlanadi.
 * A'zolari Prisma `Role` enum a'zolari bilan birebir mos (structural).
 */
export type Role = "OWNER" | "MANAGER" | "WAREHOUSE" | "PARTNER";

/**
 * Bir foydalanuvchining «nima qila oladi / nima ko'ra oladi» to'plami (TZ §3).
 * Har maydon — bitta huquq. R2+ da UI va action'lar shu bayroqlarni o'qiydi.
 */
export interface Capabilities {
  /** Sotuv/baza narxini ko'rish (basePrice). TZ §3: OWNER/MANAGER — ha. */
  canSeePrices: boolean;
  /** Закупка/маржа narxini ko'rish (purchasePrice). OWNER — DOIM; MANAGER — ruxsatga qarab. */
  canSeePurchasePrice: boolean;
  /** Sotuvni rasmiylashtirish (prodazha). TZ §3: OWNER/MANAGER. */
  canSell: boolean;
  /** Bron qo'yish (bron). TZ §3: OWNER/MANAGER. */
  canReserve: boolean;
  /** Fotozapros yuborish (CREATE) va so'rovni «Готово» yopish. TZ §3/§5.3: OWNER/MANAGER. */
  canRequestPhoto: boolean;
  /**
   * Foto-vazifalar ro'yxatini ko'rish (READ). TZ §3 sklad «задачи на фото»,
   * §7 «виден складчику», §5.9 dual site+TG. CREATE bilan aralashmasin:
   * canRequestPhoto WAREHOUSE ga BERILMAYDI (menejer so'raydi; sklad bajaradi).
   * OWNER/MANAGER/WAREHOUSE — true; PARTNER — false.
   */
  canViewPhotoTasks: boolean;
  /** Ombor amallari: приёмка/разбить/перемещение/съёмка. TZ §3: OWNER/WAREHOUSE. */
  canManageWarehouse: boolean;
  /** Aniq qoldiqlarni ko'rish (точные остатки). TZ §3: PARTNER'dan boshqa hammasi. */
  canSeeExactRemainder: boolean;
  /** Barcha bronlarni ko'rish (nafaqat o'ziniki). TZ §3: faqat OWNER. */
  canSeeAllReservations: boolean;
  /** So'rovlari menejerga yo'naltiriladimi (PARTNER oqimi). TZ §3: faqat PARTNER. */
  requestsRouteToManager: boolean;
  /**
   * Harakatlar tarixini (AuditLog: кто/что/когда) ko'rish. TZ §8 + §3 —
   * Владелец «видит … действия сотрудников». FAQAT OWNER; менеджеру журнал
   * всех действий (чужие продажи/клиенты) не даём. Свой скоуп — кандидат в v2.
   */
  canSeeHistory: boolean;
  /**
   * Akkauntlarni boshqarish (OWN-03): xodim akkauntlarini yaratish/o'chirish
   * (soft), rol va parolni o'zgartirish. FAQAT OWNER — root/egasi. Menejer ham,
   * boshqalar ham akkaunt yarata olmaydi (ruxsatlarni oshirib yuborish xavfi).
   */
  canManageAccounts: boolean;
  /**
   * Заявки дизайнера/партнёра (A1, TZ §6.8) — очередь лидов /zayavki. Их
   * обрабатывает менеджер («заявка принята, менеджер свяжется»), поэтому видят
   * OWNER/MANAGER. WAREHOUSE — нет (не продаёт). PARTNER — нет (он их СОЗДАЁТ,
   * но чужих не видит).
   */
  canSeeLeads: boolean;
}

/**
 * Ruxsat matritsasi (TZ §3) — sof lookup, side-effektsiz.
 *
 * | huquq                    | OWNER | MANAGER          | WAREHOUSE | PARTNER |
 * |--------------------------|-------|------------------|-----------|---------|
 * | canSeePrices             | true  | true             | false     | false   |
 * | canSeePurchasePrice      | true* | = opts           | false     | false   |
 * | canSell                  | true  | true             | false     | false   |
 * | canReserve               | true  | true             | false     | false   |
 * | canRequestPhoto          | true  | true             | false     | false   |
 * | canViewPhotoTasks        | true  | true             | true      | false   |
 * | canManageWarehouse       | true  | false            | true      | false   |
 * | canSeeExactRemainder     | true  | true             | true      | false   |
 * | canSeeAllReservations    | true  | false            | false     | false   |
 * | requestsRouteToManager   | false | false            | false     | true    |
 * | canSeeHistory            | true  | false            | false     | false   |
 * | canManageAccounts        | true  | false            | false     | false   |
 * | canSeeLeads              | true  | true             | false     | false   |
 *
 * (*) OWNER.canSeePurchasePrice — `opts` dan QAT'IY NAZAR har doim true
 * (schema: User.canSeePurchasePrice OWNER uchun e'tiborga olinmaydi).
 * MANAGER'niki — aynan `opts.canSeePurchasePrice`. WAREHOUSE/PARTNER — doim false.
 */
/**
 * Deny-by-default to'plami: BARCHA huquqlar false. Union'dan tashqari rol
 * (kelajakdagi 5-chi Role a'zosi yoki noto'g'ri cast) uchun xavfsiz javob —
 * hech qachon undefined qaytmaydi va hech qachon ortiqcha ruxsat bermaydi.
 * Hardcoded (PARTNER'ga bog'liq emas) — PARTNER kelajakda o'zgarsa ham xavfsiz.
 */
const DENY_ALL: Capabilities = {
  canSeePrices: false,
  canSeePurchasePrice: false,
  canSell: false,
  canReserve: false,
  canRequestPhoto: false,
  canViewPhotoTasks: false,
  canManageWarehouse: false,
  canSeeExactRemainder: false,
  canSeeAllReservations: false,
  requestsRouteToManager: false,
  canSeeHistory: false,
  canManageAccounts: false,
  canSeeLeads: false,
};

export function capabilitiesFor(
  role: Role,
  opts: { canSeePurchasePrice: boolean },
): Capabilities {
  switch (role) {
    case "OWNER":
      return {
        canSeePrices: true,
        canSeePurchasePrice: true, // OWNER — doim (opts e'tiborga olinmaydi)
        canSell: true,
        canReserve: true,
        canRequestPhoto: true,
        canViewPhotoTasks: true,
        canManageWarehouse: true,
        canSeeExactRemainder: true,
        canSeeAllReservations: true,
        requestsRouteToManager: false,
        canSeeHistory: true,
        canManageAccounts: true, // OWN-03: только Владелец управляет аккаунтами
        canSeeLeads: true, // A1: владелец видит заявки партнёров
      };
    case "MANAGER":
      return {
        canSeePrices: true,
        canSeePurchasePrice: opts.canSeePurchasePrice, // ruxsatga qarab
        canSell: true,
        canReserve: true,
        canRequestPhoto: true,
        canViewPhotoTasks: true,
        canManageWarehouse: false,
        canSeeExactRemainder: true,
        canSeeAllReservations: false,
        requestsRouteToManager: false,
        // §3: «действия сотрудников» видит только Владелец; менеджеру журнал
        // всех действий не даём (чужие продажи/клиенты). Свой скоуп — кандидат в v2.
        canSeeHistory: false,
        canManageAccounts: false,
        canSeeLeads: true, // A1: менеджер обрабатывает заявки партнёров
      };
    case "WAREHOUSE":
      return {
        canSeePrices: false,
        canSeePurchasePrice: false,
        canSell: false,
        canReserve: false,
        canRequestPhoto: false, // CREATE/close — menejer; bajarish — TG (§5.3)
        canViewPhotoTasks: true, // §3/§7/§5.9: vazifalar saytda ko'rinsin
        canManageWarehouse: true,
        canSeeExactRemainder: true,
        canSeeAllReservations: false,
        requestsRouteToManager: false,
        canSeeHistory: false,
        canManageAccounts: false,
        canSeeLeads: false, // склад не работает с заявками партнёров
      };
    case "PARTNER":
      return {
        canSeePrices: false,
        canSeePurchasePrice: false,
        canSell: false,
        canReserve: false,
        canRequestPhoto: false,
        canViewPhotoTasks: false,
        canManageWarehouse: false,
        canSeeExactRemainder: false,
        canSeeAllReservations: false,
        requestsRouteToManager: true,
        canSeeHistory: false,
        canManageAccounts: false,
        canSeeLeads: false, // партнёр СОЗДАЁТ заявки, но чужих не видит
      };
    default:
      // Union'dan tashqari qiymat (kelajakdagi 5-chi rol / noto'g'ri cast) —
      // deny-by-default: undefined qaytmaydi, ortiqcha ruxsat berilmaydi.
      return DENY_ALL;
  }
}

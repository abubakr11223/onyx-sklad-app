// Аудит ТЗ №7 #24 — раньше validateTelegramInitData вызывался с дефолтом 24 ч,
// а cookie ставилась на 30 дней: замшишь initData → на сутки жди и минтани по
// свежих session'ов. Здесь — ЯВНАЯ политика TTL для короткоживущих кредеciales,
// чтобы обновление шло в одном месте (аудит #24 и последующие).

/** Auth route для Mini App: сколько времени принимается signed initData. */
export const TELEGRAM_INIT_DATA_TTL_SEC = 3600; // 1 час — окно replay'а initData.

// §5.9 — one-time: ставит кнопку меню бота «Открыть склад», открывающую Mini App.
// Запуск: TELEGRAM_BOT_TOKEN=... APP_BASE_URL=https://onyx-sklad-app.vercel.app \
//         npm run tg:menu
// Идемпотентно — можно запускать повторно. Печатает ответ Telegram.
async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const base = process.env.APP_BASE_URL;
  if (!token || !base) {
    console.error("Нужны env TELEGRAM_BOT_TOKEN и APP_BASE_URL.");
    process.exitCode = 1;
    return;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${token}/setChatMenuButton`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menu_button: {
          type: "web_app",
          text: "Открыть склад",
          web_app: { url: `${base}/tg` },
        },
      }),
    },
  );
  const data = await res.json();
  console.log("Telegram ответ:", JSON.stringify(data));
  if (!data.ok) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

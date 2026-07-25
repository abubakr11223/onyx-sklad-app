// БАГ-12: единые хелперы чтения FormData в server actions — раньше каждый
// action держал свою локальную str/all (str где-то с trim, где-то без —
// расхождение было источником багов вроде нетримленного customerName в
// src/app/bron/actions.ts). Контракт теперь один везде:
//   str    — обрезанная строка (текстовые/числовые поля форм — почти всё).
//   rawStr — БЕЗ trim (пароли и другое, где пробелы значимы).
//   all    — массив значений одного имени (параллельные поля: locBlock[] …).
// Фабрики *Of(formData) сохраняют старый эргономичный вызов `str("name")`
// на месте использования — меняется только определение хелпера.

export function strOf(formData: FormData) {
  return (name: string): string => String(formData.get(name) ?? "").trim();
}

export function rawStrOf(formData: FormData) {
  return (name: string): string => String(formData.get(name) ?? "");
}

export function allOf(formData: FormData) {
  return (name: string): string[] => formData.getAll(name).map(String);
}

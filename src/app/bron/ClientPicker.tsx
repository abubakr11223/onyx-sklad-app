"use client";

// ТЗ №19 B2 / ТЗ №11 — клиент брони из справочника, а не свободный текст:
// иначе бронь не попадает в карточку клиента. Тот же поиск, что в продаже
// (searchClientsForSale — имя + телефон), и тот же «мягкий» запрет дубля по
// телефону при создании (createClientForSale → reason=duplicate).
// В списке рядом с именем всегда телефон (E1): два «Тимур» различимы.

import { useEffect, useState } from "react";
import {
  createClientForSale,
  searchClientsForSale,
  type ClientHit,
} from "@/app/prodazha/client-actions";
import { CLIENT_TYPE_LABELS, type ClientType } from "@/lib/clients";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

const TYPES = Object.keys(CLIENT_TYPE_LABELS) as ClientType[];

export default function ClientPicker({
  value,
  onChange,
  error,
}: {
  value: ClientHit | null;
  onChange: (c: ClientHit | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newType, setNewType] = useState<ClientType>(TYPES[0]);
  const [dup, setDup] = useState<ClientHit | null>(null);
  // E1 — тёзки: «есть клиент с таким именем», создать можно подтверждением.
  const [similar, setSimilar] = useState<ClientHit[]>([]);

  // Поиск по мере ввода (debounce), как в форме продажи.
  useEffect(() => {
    if (value) return;
    const q = query.trim();
    if (q.length < 1) {
      /* eslint-disable react-hooks/set-state-in-effect -- сброс результатов внешнего поиска */
      setHits([]);
      setMsg(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const res = await searchClientsForSale(q);
        if (!res.ok) {
          setMsg(res.error);
          setHits([]);
        } else {
          setHits(res.clients);
          setMsg(res.clients.length === 0 ? "Никого не найдено — создайте клиента" : null);
        }
      } finally {
        setBusy(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [query, value]);

  const pick = (c: ClientHit) => {
    onChange(c);
    setHits([]);
    setQuery("");
    setCreating(false);
    setDup(null);
    setMsg(null);
  };

  const submitNew = async () => {
    setBusy(true);
    setMsg(null);
    setDup(null);
    const allowSameName = similar.length > 0;
    setSimilar([]);
    try {
      const res = await createClientForSale({
        name: newName,
        phone: newPhone,
        type: newType,
        allowSameName,
      });
      if (res.ok) pick(res.client);
      else if (res.reason === "duplicate") {
        setDup(res.existing);
        setMsg(res.error);
      } else if (res.reason === "same_name") {
        setSimilar(res.similar);
        setMsg(res.error);
      } else setMsg(res.error);
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <div className="rounded-field border border-gold/40 bg-gold/10 p-3">
        <input type="hidden" name="clientId" value={value.id} />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-ink">{value.name}</p>
            <p className="text-sm text-ink/70">
              {CLIENT_TYPE_LABELS[value.type]} · {value.phone}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Сменить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        id="bron-client-search"
        className={inputClass}
        placeholder="Имя или телефон клиента"
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      {busy && <p className="text-xs text-ink/55">Поиск…</p>}
      {hits.length > 0 && (
        <ul className="flex flex-col gap-1">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full rounded-field border border-line bg-paper-2 px-3 py-2 text-left text-sm transition hover:border-gold"
                onClick={() => pick(c)}
              >
                <span className="font-medium text-ink">{c.name}</span>
                <span className="tnum text-ink/60"> · {c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-sm text-ink/70">{msg}</p>}
      {similar.map((c) => (
        <Button key={c.id} type="button" variant="secondary" size="sm" onClick={() => pick(c)}>
          Выбрать {c.name} · {c.phone}
        </Button>
      ))}
      {dup && (
        <Button type="button" variant="secondary" size="sm" onClick={() => pick(dup)}>
          Выбрать {dup.name} · {dup.phone}
        </Button>
      )}
      {!creating ? (
        <button
          type="button"
          className="self-start text-sm text-gold-deep underline"
          onClick={() => setCreating(true)}
        >
          + Новый клиент
        </button>
      ) : (
        <div className="grid gap-2 rounded-field border border-line p-3">
          <Field
            id="bron-new-client-name"
            label="Имя / компания"
            value={newName}
            onChange={(ev) => {
              setNewName(ev.target.value);
              setSimilar([]);
            }}
          />
          <Field
            id="bron-new-client-phone"
            label="Телефон"
            inputMode="tel"
            placeholder="+998 …"
            value={newPhone}
            onChange={(ev) => setNewPhone(ev.target.value)}
          />
          <select
            className={inputClass}
            value={newType}
            onChange={(ev) => setNewType(ev.target.value as ClientType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CLIENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={busy} onClick={submitNew}>
            {similar.length > 0 ? "Всё равно создать" : "Создать клиента"}
          </Button>
        </div>
      )}
    </div>
  );
}

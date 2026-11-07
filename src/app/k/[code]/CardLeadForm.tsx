"use client";

// ТЗ №20 H (§9.2) — «Оставить заявку» на карточке по QR. Клиент без входа:
// имя *, телефон *, комментарий; камень — из кода. Тексты приходят готовым
// словарём выбранного языка (ru / uz). Ошибка не стирает введённое.
//
// Поле-ловушка `website` спрятано от людей (off-screen + aria-hidden +
// tabIndex -1), автозаполнение браузера его тоже не трогает (autoComplete off).

import { useActionState } from "react";
import { submitCardLead, type CardLeadState } from "../actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";
import type { PublicDict } from "@/lib/public-i18n";

const initial: CardLeadState = {
  status: "idle",
  error: null,
  fields: {},
  values: { name: "", phone: "", comment: "" },
};

type Texts = Pick<
  PublicDict,
  | "name"
  | "phone"
  | "comment"
  | "commentPlaceholder"
  | "submit"
  | "sending"
  | "leadOk"
  | "errName"
  | "errPhone"
  | "errPhoneInvalid"
  | "errDuplicate"
  | "errRate"
  | "errFailed"
>;

export default function CardLeadForm({
  code,
  t,
  collection,
  idPrefix = "k",
}: {
  code: string;
  t: Texts;
  /** ТЗ №20 I — код подборки: заявка со страницы /podborka/<код>. */
  collection?: string;
  /** Префикс id полей — на подборке форм несколько, id не должны совпадать. */
  idPrefix?: string;
}) {
  const [state, action, pending] = useActionState(submitCardLead, initial);

  if (state.status === "ok") {
    return (
      <Alert variant="success" className="mt-3">
        {t.leadOk}
      </Alert>
    );
  }

  const fieldMsg = {
    name: t.errName,
    phone: t.errPhone,
    phoneInvalid: t.errPhoneInvalid,
  } as const;

  return (
    <form action={action} className="mt-3 flex flex-col gap-3" noValidate>
      <input type="hidden" name="code" value={code} />
      {collection && <input type="hidden" name="collection" value={collection} />}
      {/* Ловушка для ботов: человек её не видит и не заполняет. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${idPrefix}-website`}>Website</label>
        <input id={`${idPrefix}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {state.error && (
        <Alert variant={state.error === "errDuplicate" ? "info" : "danger"}>
          {t[state.error]}
        </Alert>
      )}

      <Field
        id={`${idPrefix}-name`}
        name="name"
        label={
          <>
            {t.name} <span className="text-danger">*</span>
          </>
        }
        autoComplete="name"
        maxLength={80}
        defaultValue={state.values.name}
        error={state.fields.name ? fieldMsg[state.fields.name] : undefined}
        required
      />
      <Field
        id={`${idPrefix}-phone`}
        name="phone"
        type="tel"
        inputMode="tel"
        label={
          <>
            {t.phone} <span className="text-danger">*</span>
          </>
        }
        autoComplete="tel"
        placeholder="+998 90 123 45 67"
        maxLength={40}
        defaultValue={state.values.phone}
        error={state.fields.phone ? fieldMsg[state.fields.phone] : undefined}
        required
      />
      <Field id={`${idPrefix}-comment`} label={t.comment}>
        <textarea
          id={`${idPrefix}-comment`}
          name="comment"
          rows={3}
          maxLength={1000}
          placeholder={t.commentPlaceholder}
          defaultValue={state.values.comment}
          className={`${inputClass} py-2`}
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? t.sending : t.submit}
      </Button>
    </form>
  );
}

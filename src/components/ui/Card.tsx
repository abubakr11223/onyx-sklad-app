// Onyx UI — Card. Единая карточка/панель (бумага-2 поверхность, мягкая рамка,
// радиус карточки). Композиционная: любой контент внутрь.

import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export default function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={[
        "rounded-card border border-line bg-paper-2 p-5 shadow-card",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

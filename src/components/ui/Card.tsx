// Onyx UI — Card. ТЗ №20 §7.5: marble, рамка line, радиус 10px, отступ
// 20px, без тени. Композиционная: любой контент внутрь.

import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export default function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={[
        "rounded-card border border-line bg-marble p-5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

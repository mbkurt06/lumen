import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { useShell } from "./Shell";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { openMenu } = useShell();
  return (
    <header className="phead">
      <button className="iconbtn" onClick={openMenu} aria-label="Menüyü aç">
        <Icon name="menu" size={26} />
      </button>
      <div className="ptitle">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

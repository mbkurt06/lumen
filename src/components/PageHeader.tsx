import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { useShell } from "./Shell";

// back: sol üstte geri oku (alt sayfalar); yoksa uygulama menüsü (☰).
export function PageHeader({ title, subtitle, right, back }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean | string }) {
  const { openMenu } = useShell();
  const navigate = useNavigate();
  return (
    <header className="phead">
      {back ? (
        <button className="iconbtn" onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))} aria-label="Geri">
          <Icon name="back" size={26} />
        </button>
      ) : (
        <button className="iconbtn" onClick={openMenu} aria-label="Menüyü aç">
          <Icon name="menu" size={26} />
        </button>
      )}
      <div className="ptitle">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right && <div className="pright">{right}</div>}
    </header>
  );
}

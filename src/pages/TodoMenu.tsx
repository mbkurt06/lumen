import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { inToday, type TGroup, type TList, type Todo } from "../lib/todo";

// Yapılacaklar sağ menüsü (tasarım: Menu.dc) — soldaki uygulama menüsünden ayrı.
export function TodoMenu({ open, onClose, todos, lists, groups, activeListId, onNewList, onNewGroup }: {
  open: boolean; onClose: () => void; todos: Todo[]; lists: TList[]; groups: TGroup[]; activeListId?: string; onNewList: () => void; onNewGroup: () => void;
}) {
  const nav = useNavigate();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const count = (id: string) => todos.filter((t) => t.list_id === id && !t.is_completed && !t.parent_todo_id).length;
  const go = (to: string) => { onClose(); nav(to); };
  const ListRow = ({ l }: { l: TList }) => (
    <button className={"mrow sub" + (activeListId === l.id ? " active" : "")} onClick={() => go(`/yapilacaklar/l/${l.id}`)}>
      <Icon name="lines" size={20} /><span className="mlabel">{l.title}</span><span className="mcount">{count(l.id)}</span>
    </button>
  );
  const loose = lists.filter((l) => !l.group_id);
  return (
    <>
      <div className={"scrim" + (open ? " show" : "")} onClick={onClose} />
      <aside className={"drawer right" + (open ? " open" : "")} aria-hidden={!open}>
        <div className="dname" style={{ padding: "4px 12px 10px" }}>Yapılacaklar</div>
        <div className="dscroll">
          <button className={"mrow" + (!activeListId ? " active" : "")} onClick={() => go("/yapilacaklar")}>
            <Icon name="sun" size={22} /><span className="mlabel">Günüm</span><span className="mcount">{todos.filter(inToday).length}</span>
          </button>
          <button className="mrow" onClick={() => go("/takvim")}><Icon name="calendar" size={22} /><span className="mlabel">Takvim</span></button>
          <button className="mrow" onClick={() => go("/nova")}><Icon name="lines" size={22} /><span className="mlabel">Kelime</span></button>
          <div className="dsep" />
          {groups.map((g) => (
            <div key={g.id}>
              <button className="mgroup" onClick={() => setClosed({ ...closed, [g.id]: !closed[g.id] })}>
                <Icon name={closed[g.id] ? "chevron" : "chevdown"} size={16} /><span>{g.title.toUpperCase()}</span>
              </button>
              {!closed[g.id] && lists.filter((l) => l.group_id === g.id).map((l) => <ListRow key={l.id} l={l} />)}
            </div>
          ))}
          {loose.length > 0 && (
            <div>
              {groups.length > 0 && <div className="mgroup"><span>LİSTELER</span></div>}
              {loose.map((l) => <ListRow key={l.id} l={l} />)}
            </div>
          )}
        </div>
        <div className="dsep" />
        <button className="mrow accent" onClick={onNewList}><Icon name="plus" size={22} /><span className="mlabel">Yeni liste</span></button>
        <button className="mrow accent" onClick={onNewGroup}><Icon name="folder" size={22} /><span className="mlabel">Yeni grup</span></button>
        <button className="mrow" onClick={() => go("/ayarlar")}><Icon name="sun" size={22} /><span className="mlabel">Ayarlar</span></button>
      </aside>
    </>
  );
}

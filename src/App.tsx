import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Collection, LibraryHome, LibraryItem } from "./pages/Library";
import { Namaz } from "./pages/Namaz";
import { Placeholder } from "./pages/Placeholder";
import { Todo } from "./pages/Todo";
import { TodoDetail } from "./pages/TodoDetail";
import { Settings } from "./pages/Settings";
import { Update } from "./pages/Update";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <div className="splash" aria-busy="true" />;
  if (!session) return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="yapilacaklar" element={<Todo />} />
          <Route path="yapilacaklar/l/:listId" element={<Todo />} />
          <Route path="yapilacaklar/g/:id" element={<TodoDetail />} />
          <Route path="kutuphane" element={<LibraryHome />} />
          <Route path="kutuphane/c/:col" element={<Collection />} />
          <Route path="kutuphane/:id" element={<LibraryItem />} />
          <Route path="namaz" element={<Namaz />} />
          <Route path="nova" element={<Placeholder title="Nova" note="Almanca öğrenme bölümü; tasarımı hazır, sıradaki adımlarda geliştirilecek." />} />
          <Route path="takvim" element={<Placeholder title="Takvim" />} />
          <Route path="ara" element={<Placeholder title="Ara" />} />
          <Route path="notlar" element={<Placeholder title="Notlarım" />} />
          <Route path="yer-isaretleri" element={<Placeholder title="Yer işaretlerim" />} />
          <Route path="kelime-defteri" element={<Placeholder title="Kelime defterim" />} />
          <Route path="ayarlar" element={<Settings />} />
          <Route path="cihazlar" element={<Placeholder title="Cihazlarım" />} />
          <Route path="esitleme" element={<Placeholder title="Eşitleme ve yedek" />} />
          <Route path="guncelleme" element={<Update />} />
          <Route path="*" element={<Placeholder title="Sayfa bulunamadı" note="Bu adres yok." />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}

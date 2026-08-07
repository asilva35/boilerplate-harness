import { Route, Routes } from "react-router-dom";
import { ChatPage } from "@/components/ChatPage";
import { DashboardPage } from "@/components/DashboardPage";

// Phase 27 introduced a second page (the sessions dashboard), so this
// stopped being just the chat UI directly - BrowserRouter itself lives in
// main.tsx, App.tsx only owns which page renders for which path. No
// route needs params or nesting yet, so a flat Routes list is enough.
function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  );
}

export default App;

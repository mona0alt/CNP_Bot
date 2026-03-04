import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Chat } from "@/pages/Chat";
import { StreamingMessagesProvider } from "@/contexts/StreamingMessagesContext";

function App() {
  return (
    <BrowserRouter>
      <StreamingMessagesProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="chats" element={<Chat />} />
          </Route>
        </Routes>
      </StreamingMessagesProvider>
    </BrowserRouter>
  );
}

export default App;

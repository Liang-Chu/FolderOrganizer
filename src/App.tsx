import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Folders from "./pages/Folders";
import Rules from "./pages/Rules";
import Activity from "./pages/Activity";
import DataExplorer from "./pages/DataExplorer";
import Settings from "./pages/Settings";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="folders" element={<Folders />} />
        <Route path="rules" element={<Rules />} />
        <Route path="activity" element={<Activity />} />
        <Route path="data" element={<DataExplorer />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;

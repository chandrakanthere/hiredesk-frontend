import { Navigate, Route, Routes } from "react-router";
import HomePage from "./pages/HomePage";
import ProblemsPage from "./pages/ProblemsPage";
import { useUser } from "@clerk/react";
import { Toaster } from "react-hot-toast";

function App() {
  const { isSignedIn } = useUser();

  return (
    <>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/problems"
        element={isSignedIn ? <ProblemsPage /> : <Navigate to="/"  />}
      />
    </Routes>


    <Toaster/>
    </>
  );
}

export default App;

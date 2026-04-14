import { Navigate, Route, Routes } from "react-router";
import HomePage from "./pages/HomePage";
import ProblemsPage from "./pages/ProblemsPage";
import { useUser } from "@clerk/react";
import { Toaster } from "react-hot-toast";

function App() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/problems"
          element={
            !isLoaded ? null : isSignedIn ? <ProblemsPage /> : <Navigate to="/" replace />
          }
        />
      </Routes>


      <Toaster />
    </>
  );
}

export default App;

import { SignInButton, SignOutButton, UserButton, useUser } from "@clerk/react";
import toast from "react-hot-toast";

function HomePage() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      HomePage
      <button className="btn btn-primary" onClick={()=> toast.success("successfully clicked")}>click me</button>
      {!isSignedIn ? (
        <>
          <SignInButton mode="modal">
            <button className="btn btn-primary">Sign In</button>
          </SignInButton>
        </>
      ) : (
        <>
          <SignOutButton />
          <UserButton />
        </>
      )}
    </div>
  );
}


export default HomePage;
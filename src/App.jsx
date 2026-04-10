
import './App.css'
import { SignInButton, SignOutButton, UserButton, useUser } from '@clerk/react'

function App() {
  const { isSignedIn, user } = useUser()

  return (
    <>
      <h1> welcome to the app</h1>

      {!isSignedIn ? (
        <SignInButton mode="modal">
          <button className='btn'>Sign In</button>
        </SignInButton>
      ) : (
        <div>
          <p>Welcome, {user?.firstName || 'User'}!</p>
          <SignOutButton>
            <button className='btn'>Sign Out</button>
          </SignOutButton>
          <UserButton />
        </div>
      )}
    </>
  )
}

export default App

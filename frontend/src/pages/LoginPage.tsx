import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from '../firebase'

export default function LoginPage() {
  async function handleSignIn() {
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        gap: '24px',
      }}
    >
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>corgi</h1>
      <button
        onClick={handleSignIn}
        style={{
          padding: '12px 24px',
          fontSize: '1rem',
          cursor: 'pointer',
          borderRadius: '8px',
          border: '1px solid #ccc',
        }}
      >
        Sign in with Google
      </button>
    </div>
  )
}

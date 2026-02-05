import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import UserProfilePage from './pages/UserProfilePage'

function App() {
  const { isAuthenticated, loadUser } = useAuthStore()

  useEffect(() => {
    loadUser()
  }, [])

  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" />} />
      <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/" />} />
      <Route path="/profile" element={isAuthenticated ? <ProfilePage /> : <Navigate to="/login" />} />
      <Route path="/user/:userId" element={isAuthenticated ? <UserProfilePage /> : <Navigate to="/login" />} />
      <Route path="/chat" element={isAuthenticated ? <ChatPage /> : <Navigate to="/login" />} />
      <Route path="/" element={isAuthenticated ? <Navigate to="/chat" /> : <Navigate to="/login" />} />
    </Routes>
  )
}

export default App

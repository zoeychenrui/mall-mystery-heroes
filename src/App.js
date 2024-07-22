import { ChakraProvider } from '@chakra-ui/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './App.css';
import DashBoard from './pages/DashBoard';
import GameMasterView from './pages/GameMasterView';
import Homepage from './pages/Homepage';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import PasswordReset from './pages/PasswordReset';
import SignUp from './pages/SignUp';
import theme from './theme'; // Import your custom theme

function App() {
  return (
    <ChakraProvider theme={theme}> 
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Homepage />} />
          <Route path="/dashboard" element={<DashBoard />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/password-reset" element={<PasswordReset />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/rooms/:roomID/lobby" element={<Lobby />} />
          <Route path="/rooms/:roomID/GameMasterView" element={<GameMasterView />} />
        </Routes>
      </BrowserRouter>
    </ChakraProvider>
  );
}

export default App;
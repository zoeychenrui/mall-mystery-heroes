import './App.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react';
import HostRoom from './pages/HostRoom';
import PlayerListPage from './pages/PlayerListPage';
import GameMasterView from './pages/GameMasterView';

function App() {
  return (
    <ChakraProvider> 
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HostRoom />} />
          <Route path="/rooms/:roomID/lobby" element={<PlayerListPage />} />
          <Route path="/rooms/:roomID/GameMasterView" element={<GameMasterView />} />
        </Routes>
      </BrowserRouter>
    </ChakraProvider>
  );
}

export default App;